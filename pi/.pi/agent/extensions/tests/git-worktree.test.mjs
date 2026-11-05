import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { runInNewContext } from "node:vm";

// Exercise the actual registered commands without Pi credentials, GitHub access,
// real worktrees, or Herdr workspaces. Imports are injected into an isolated VM.
const source = await readFile(new URL("../git-worktree.ts", import.meta.url), "utf8");
const code = stripTypeScriptTypes(source
	.replace(/^import .*;\n/gm, "")
	.replace("export default function gitWorktreeExtension", "function gitWorktreeExtension"));
const issueUrl = "https://github.com/example/project/issues/42";
const issue = {
	number: 42,
	title: "Fix auth cookie refresh",
	body: "Refresh the cookie before it expires; retain the public API.",
	state: "OPEN",
	url: issueUrl,
	labels: [{ name: "bug" }],
	comments: [{ author: { login: "reviewer" }, body: "Add a regression test for expired cookies." }],
};

const activeModel = { provider: "current-provider", id: "current-model" };
const otherModel = { provider: "other-provider", id: "org/other-model" };

function harness({ model = false, messages = [], herdr = false, ghError, ghOutput, cleanup,
	argv = [], availableModels = [activeModel, otherModel], modelAuth = true,
	modelResponse, modelError, refs = [], entries = [], branchEntries = entries, pathAliases = {}, missingPaths = [] } = {}) {
	const calls = [];
	const files = new Map();
	const notifications = [];
	const commands = new Map();
	const events = new Map();
	const dialogs = [];
	let sessionName;
	let gitRoot = cleanup?.metadata?.worktreePath ?? (cleanup ? "/repo-worktrees/task" : "/repo");
	const processState = {
		pid: 123,
		argv: ["node", "pi", ...argv],
		env: herdr ? { HERDR_ENV: "1", HERDR_WORKSPACE_ID: "source-workspace" } : {},
	};
	let shutdown = false;
	const metadata = cleanup && {
		repoRoot: "/repo",
		worktreePath: "/repo-worktrees/task",
		branch: "pi/task",
		baseRef: "main",
		...cleanup.metadata,
	};
	let modelContext;
	const sessionFile = "/sessions/source.jsonl";
	if (herdr) files.set(sessionFile, '{"type":"session","id":"source"}\n');

	function execFileCallback(command, args, options, callback) {
		calls.push({ command, args, options });
		let stdout = "";
		let error;
		if (command === "gh") {
			error = ghError;
			stdout = ghOutput ?? JSON.stringify({ ...issue, url: args[2] });
		} else if (command === "git") {
			if (args[0] === "status") stdout = cleanup?.status ?? "";
			else if (args[0] === "merge-base" && cleanup?.merged === false) error = new Error("not merged");
			else if (args[0] === "rev-parse" && args.includes("--show-toplevel")) stdout = gitRoot;
			else if (args[0] === "for-each-ref") stdout = refs.join("\n");
			else if (args[0] === "worktree" && args[1] === "list") stdout = `worktree /repo\nbranch refs/heads/main\n\nworktree ${gitRoot}\nbranch refs/heads/pi/task\n`;
			else if (args[0] === "branch") stdout = "main";
			else if (args.includes("--verify")) error = new Error("branch does not exist");
			else if (args.includes("--git-path")) stdout = "/git/worktree/pi-worktree-launch.json";
		} else if (command === "herdr") {
			if (args[0] === "worktree") stdout = JSON.stringify({ result: {
				workspace: { workspace_id: "new-workspace" }, root_pane: { pane_id: "editor" },
			} });
			else if (args[1] === "split") stdout = JSON.stringify({ result: { pane: { pane_id: "new-pane" } } });
		}
		callback(error, stdout, "");
	}
	// Match promisify(execFile)'s named stdout/stderr result.
	execFileCallback[promisify.custom] = (command, args, options) => new Promise((resolve, reject) => {
		execFileCallback(command, args, options, (error, stdout, stderr) => {
			if (error) reject(error);
			else resolve({ stdout, stderr });
		});
	});

	const extension = runInNewContext(`${code}\ngitWorktreeExtension`, {
		buildSessionContext: () => ({ messages }),
		spawn: (command, args, options) => {
			calls.push({ command, args, options });
			return { unref() {} };
		},
		execFileCallback,
		promisify,
		existsSync: (path) => files.has(path),
		mkdir: async () => {},
		chmod: async () => {},
		readFile: async (path) => {
			if (!files.has(path)) throw new Error("File not found");
			return files.get(path);
		},
		realpath: async (path) => {
			if (missingPaths.includes(path)) throw Object.assign(new Error(`Missing path: ${path}`), { code: "ENOENT" });
			return pathAliases[path] ?? resolve(path);
		},
		writeFile: async (path, content) => { files.set(path, content); },
		unlink: async (path) => { files.delete(path); },
		tmpdir: () => "/tmp",
		basename, dirname, join, resolve,
		process: processState,
		AbortSignal,
	});
	extension({
		on: (name, handler) => events.set(name, handler),
		registerCommand: (name, command) => commands.set(name, command),
		getSessionName: () => sessionName,
		setSessionName: (name) => { sessionName = name; },
		setModel: async (model) => {
			calls.push({ command: "setModel", model });
			if (modelAuth) ctx.model = model;
			return modelAuth;
		},
		appendEntry: (customType, data) => calls.push({ command: "appendEntry", customType, data }),
		sendUserMessage: (prompt) => calls.push({ command: "prompt", prompt, model: ctx.model }),
	});
	const ctx = {
		cwd: "/repo",
		model: model === true ? activeModel : model || undefined,
		modelRegistry: {
			getApiKeyAndHeaders: async () => { throw new Error("Naming must not require an API key"); },
			streamSimple: (model, context, options) => ({ result: async () => {
				calls.push({ command: "model", model, context, options });
				modelContext = context.messages[0].content[0].text;
				if (modelError) throw modelError;
				return modelResponse ?? { stopReason: "stop", content: [{ type: "text", text: '{"slug":"refresh-auth-cookie","title":"Refresh Auth Cookie"}' }] };
			} }),
			getAll: () => availableModels,
			find: (provider, id) => availableModels.find((model) => model.provider === provider && model.id === id),
		},
		sessionManager: {
			getEntries: () => metadata ? [{ type: "custom", customType: "git-worktree", data: metadata }] : entries,
			getBranch: () => metadata ? [{ type: "custom", customType: "git-worktree", data: metadata }] : branchEntries,
			getLeafId: () => null,
			getSessionFile: () => herdr ? sessionFile : undefined,
		},
		shutdown: () => { shutdown = true; },
		ui: {
			notify: (message, level) => notifications.push({ message, level }),
			select: async (title, options) => {
				dialogs.push({ type: "select", title, options: Array.from(options) });
				return cleanup?.choice === null ? undefined : options[cleanup?.choice ?? 0];
			},
			confirm: async (title, message) => {
				dialogs.push({ type: "confirm", title, message });
				return cleanup?.confirm !== false;
			},
		},
	};
	return {
		calls, files, notifications, dialogs, ctx, env: processState.env,
		start: (reason = "startup", root) => {
			const config = [...files.entries()].find(([path]) => path.endsWith(".json"));
			gitRoot = root ?? (config ? JSON.parse(config[1]).metadata.worktreePath : gitRoot);
			ctx.cwd = gitRoot;
			return events.get("session_start")({ reason }, ctx);
		},
		stop: () => events.get("session_shutdown")?.({}, ctx),
		rename: (name) => { sessionName = name; },
		get sessionName() { return sessionName; },
		get shutdown() { return shutdown; },
		get modelContext() { return modelContext; },
		run: (args, command = "wt") => commands.get(command).handler(args, ctx),
		config: () => JSON.parse([...files.entries()].find(([path]) => path.endsWith(".json"))[1]),
	};
}

for (const provider of ["claude-bridge", "anthropic", "openai-codex", "google-vertex", "amazon-bedrock", "local", "custom-native", "virtual-router"]) {
	test(`naming uses the configured provider runtime without an API-key gate: ${provider}`, async () => {
		const model = { provider, id: "org/model", api: provider === "virtual-router" ? "pi-virtual" : provider, reasoning: provider !== "local" };
		const app = harness({ model });
		const controller = new AbortController();
		app.ctx.signal = controller.signal;
		await app.run("fix auth refresh");
		const call = app.calls.find((call) => call.command === "model");
		assert.deepEqual(call.model, model);
		assert.equal(call.options.reasoning, "minimal");
		assert.equal(call.options.cacheRetention, provider === "claude-bridge" || provider === "virtual-router" ? "none" : undefined,
			"Bridge and potentially bridge-routed requests must be isolated; other providers retain default caching");
		assert.equal(call.options.reasoningEffort, undefined);
		assert.equal(call.options.apiKey, undefined, "Registry resolves auth, including keyless auth");
		assert.equal(call.options.sessionId, undefined, "Naming must not reuse the coding conversation's provider session");
		assert.ok(call.options.signal instanceof AbortSignal);
		controller.abort();
		assert.equal(call.options.signal.aborted, true);
		assert.equal(app.calls.filter((call) => call.command === "model").length, 1);
		const config = app.config();
		assert.equal(config.metadata.branch, "pi/refresh-auth-cookie");
		assert.equal(config.sessionName, "Refresh Auth Cookie");
		assert.deepEqual(config.model, model && { provider, id: "org/model" });
		assert.ok(!app.notifications.some(({ level }) => level === "warning"));
	});
}

for (const text of [
	'{"slug":"refresh-auth-cookie","title":"Refresh Auth Cookie"}',
	'```json\n{"slug":"refresh-auth-cookie","title":"Refresh Auth Cookie"}\n```',
	'Here is the name: {"slug":"refresh-auth-cookie","title":"Refresh Auth Cookie"}\n{"explanation":"done"}',
	'{not json}\n{"slug":"refresh-auth-cookie","title":"Refresh Auth Cookie"}',
]) {
	test(`naming accepts common JSON response wrappers: ${text.slice(0, 30)}`, async () => {
		const app = harness({ model: true, modelResponse: { stopReason: "stop", content: [
			{ type: "thinking", thinking: "Private thinking is not naming output" },
			{ type: "text", text },
		] } });
		await app.run("fix auth refresh");
		assert.equal(app.config().metadata.branch, "pi/refresh-auth-cookie");
		assert.equal(app.config().sessionName, "Refresh Auth Cookie");
	});
}

test("JSON split across text blocks and braces in quoted titles are supported", async () => {
	const app = harness({ model: true, modelResponse: { stopReason: "stop", content: [
		{ type: "text", text: '{"slug":"refresh-auth-cookie",' },
		{ type: "text", text: '"title":"Refresh {Auth} Cookie"}' },
	] } });
	await app.run("fix auth refresh");
	assert.equal(app.config().sessionName, "Refresh {Auth} Cookie");
});

for (const response of [
	{ stopReason: "error", content: [{ type: "text", text: '{"slug":"wrong","title":"Wrong"}' }] },
	{ stopReason: "aborted", content: [] },
	{ stopReason: "length", content: [{ type: "text", text: '{"slug":"wrong","title":"Wrong"}' }] },
	{ content: [] },
	{ content: [{ type: "thinking", thinking: '{"slug":"wrong","title":"Wrong"}' }] },
	...['not JSON', 'null', '{"slug":"wrong"}', '{"title":"Wrong"}', '{"slug":123,"title":"Wrong"}',
		'{"slug":"!!!","title":"Wrong"}', '{"slug":"wrong","title":"  "}',
		JSON.stringify({ slug: "wrong", title: "\u0000\u0001" }), JSON.stringify({ slug: "wrong", title: '""' })]
		.map((text) => ({ content: [{ type: "text", text }] })),
]) {
	test(`invalid or unfinished naming falls back as one identity: ${JSON.stringify(response)}`, async () => {
		const app = harness({ model: true, modelResponse: response });
		await app.run("fix auth refresh");
		assert.equal(app.config().metadata.branch, "pi/fix-auth-refresh");
		assert.equal(app.config().sessionName, "Fix Auth Refresh");
		assert.equal(app.notifications.filter(({ level }) => level === "warning").length, 1);
	});
}

test("provider exceptions use local naming without leaking error details or retrying", async () => {
	const app = harness({ model: true, modelError: new Error("secret-provider-token") });
	await app.run("fix auth refresh");
	assert.equal(app.config().metadata.branch, "pi/fix-auth-refresh");
	assert.equal(app.calls.filter((call) => call.command === "model").length, 1);
	assert.ok(app.notifications.some(({ level }) => level === "warning"));
	assert.ok(!JSON.stringify(app.notifications).includes("secret-provider-token"));
});

for (const refs of [["pi/refresh-auth-cookie"], ["pi/refresh-auth-cookie/subtask"], ["pi/refresh-auth-cookie", "pi/refresh-auth-cookie-2"]]) {
	test(`branch names avoid exact and ref-prefix conflicts: ${refs.join(", ")}`, async () => {
		const app = harness({ model: true, refs });
		await app.run("fix auth refresh");
		assert.equal(app.config().metadata.branch, `pi/refresh-auth-cookie-${refs.length + 1}`);
		assert.equal(app.config().sessionName, "Refresh Auth Cookie");
	});
}

test("a branch blocking the entire pi namespace produces an actionable error", async () => {
	const app = harness({ refs: ["pi"] });
	await app.run("fix auth refresh");
	assert.equal(app.files.size, 0);
	assert.ok(app.notifications.some(({ message, level }) => level === "error" && message.includes("Rename it")));
});

for (const herdr of [false, true]) {
	for (const noPrompt of [false, true]) {
		test(`active model is carried into worktree startup: Herdr=${herdr}, idle=${noPrompt}`, async () => {
			const app = harness({ model: true, herdr });
			await app.run(`${noPrompt ? "--no-prompt " : ""}fix auth refresh`);
			assert.deepEqual(app.config().model, activeModel);
			if (herdr) {
				const launch = app.calls.find((call) => call.command === "herdr" && call.args[1] === "run" && call.args[3]?.includes("PI_WORKTREE_CONFIG="));
				assert.ok(!launch.args[3].includes("'@"), "Kickoff must wait for exact model selection in session_start");
				app.env.PI_WORKTREE_CONFIG = [...app.files.keys()].find((path) => path.endsWith(".json"));
			}
			app.ctx.model = otherModel; // New process would otherwise use its configured default.
			await app.start();
			assert.deepEqual(app.ctx.model, activeModel);
			assert.equal(app.calls.filter((call) => call.command === "setModel").length, 1);
			if (!noPrompt) {
				const kickoff = app.calls.find((call) => call.command === "prompt");
				assert.deepEqual(kickoff.model, activeModel);
			}
			if (noPrompt) assert.ok(!app.calls.some((call) => call.command === "prompt"));
			app.ctx.model = otherModel;
			await app.start("reload");
			assert.deepEqual(app.ctx.model, otherModel, "Reload must not reset a later model selection");
		});
	}
}

for (const herdr of [false, true]) {
	for (const flag of ["--model other-provider/org/other-model", "--model=other-provider/org/other-model", '--model "other-provider/org/other-model"']) {
		test(`explicit worktree model overrides active model: Herdr=${herdr}, ${flag}`, async () => {
			const app = harness({ model: true, herdr });
			await app.run(`${flag} fix auth refresh`);
			assert.deepEqual(app.config().model, otherModel);
			assert.equal(app.config().metadata.task, "fix auth refresh");
			if (herdr) {
				const launch = app.calls.find((call) => call.command === "herdr" && call.args[1] === "run" && call.args[3]?.includes("PI_WORKTREE_CONFIG="));
				assert.ok(!launch.args[3].includes("--model"), "Exact model selection uses the handoff, not fuzzy CLI lookup");
				app.env.PI_WORKTREE_CONFIG = [...app.files.keys()].find((path) => path.endsWith(".json"));
			}
			await app.start();
			assert.deepEqual(app.ctx.model, otherModel);
		});
	}
}

for (const herdr of [false, true]) {
	test(`handoff naming and kickoff apply once, without resetting later sessions: Herdr=${herdr}`, async () => {
		const app = harness({ model: true, herdr });
		await app.run("fix auth refresh");
		const configPath = [...app.files.keys()].find((path) => path.endsWith(".json"));
		const config = app.config();
		if (herdr) app.env.PI_WORKTREE_CONFIG = configPath;
		await app.start();
		assert.equal(app.sessionName, "Refresh Auth Cookie");
		assert.equal(app.env.PI_WORKTREE_CONFIG, undefined, "Child processes must not inherit the launch config pointer");
		assert.equal(app.files.has(configPath), false, "Successful handoffs are consumed immediately");
		for (const reason of ["reload", "new", "resume", "fork"]) {
			app.rename(`User title after ${reason}`);
			// Even an accidentally retained file must never replay on replacement.
			app.files.set(configPath, JSON.stringify(config));
			app.env.PI_WORKTREE_CONFIG = configPath;
			await app.start(reason);
			assert.equal(app.sessionName, `User title after ${reason}`);
		}
		assert.equal(app.calls.filter((call) => call.command === "prompt").length, 1);
		assert.equal(app.calls.filter((call) => call.command === "appendEntry").length, 1);
	});

	test(`a handoff for another worktree cannot change this session: Herdr=${herdr}`, async () => {
		const app = harness({ model: true, herdr });
		await app.run("fix auth refresh");
		const configPath = [...app.files.keys()].find((path) => path.endsWith(".json"));
		if (herdr) app.env.PI_WORKTREE_CONFIG = configPath;
		app.ctx.model = otherModel;
		app.rename("Existing session name");
		await app.start("startup", "/different-worktree");
		assert.equal(app.sessionName, "Existing session name");
		assert.deepEqual(app.ctx.model, otherModel);
		assert.ok(!app.calls.some((call) => ["prompt", "setModel", "appendEntry"].includes(call.command)));
		assert.ok(app.notifications.some(({ message, level }) => level === "error" && message.includes("does not belong")));
		await app.stop();
		assert.equal(app.files.has(configPath), true, "A foreign handoff must not be deleted");
	});

	test(`failed model selection retains the handoff with an exact retry command: Herdr=${herdr}`, async () => {
		const app = harness({ model: true, herdr });
		await app.run("fix auth refresh");
		const configPath = [...app.files.keys()].find((path) => path.endsWith(".json"));
		if (herdr) app.env.PI_WORKTREE_CONFIG = configPath;
		app.ctx.model = otherModel;
		app.ctx.modelRegistry.find = () => undefined;
		await app.start();
		await app.stop();
		assert.equal(app.files.has(configPath), true);
		const error = app.notifications.find(({ level }) => level === "error").message;
		assert.ok(error.includes(`PI_WORKTREE_CONFIG='${configPath}' pi`));
		if (herdr) assert.ok(error.includes("--fork '/sessions/source.jsonl'"), "Retry must retain the source conversation");
		assert.ok(!app.calls.some((call) => ["prompt", "appendEntry"].includes(call.command)));
		assert.equal(app.sessionName, undefined);
	});
}

test("a handoff started through a symlink still names the correct worktree", async () => {
	const app = harness({ model: true, pathAliases: { "/symlink": "/repo-worktrees/refresh-auth-cookie" } });
	await app.run("fix auth refresh");
	await app.start("startup", "/symlink");
	assert.equal(app.sessionName, "Refresh Auth Cookie");
	assert.ok(app.calls.some((call) => call.command === "prompt"));
});

for (const argv of [["--model", "other-provider/org/other-model"], ["--model=other-provider/org/other-model"], ["--models", "other-provider/*"], ["--provider", "other-provider"]]) {
	test(`native CLI model selection wins over handoff: ${argv.join(" ")}`, async () => {
		const app = harness({ model: true, argv });
		await app.run("fix auth refresh");
		app.ctx.model = otherModel;
		await app.start();
		assert.deepEqual(app.ctx.model, otherModel);
		assert.ok(!app.calls.some((call) => call.command === "setModel"));
	});
}

test("qualified overrides support provider IDs that also contain slashes", async () => {
	const model = { provider: "llama.cpp/http://localhost:8080", id: "org/model" };
	const app = harness({ availableModels: [model] });
	await app.run(`--model ${model.provider}/${model.id} fix auth refresh`);
	assert.deepEqual(app.config().model, model);
	await app.start();
	assert.deepEqual(app.ctx.model, model);
});

test("model-like text after the CLI option terminator does not override inheritance", async () => {
	const app = harness({ model: true, argv: ["--", "--model", "other"] });
	await app.run("fix auth refresh");
	app.ctx.model = otherModel;
	await app.start();
	assert.deepEqual(app.ctx.model, activeModel);
});

for (const args of ["--model", "--model=", "--model --no-prompt fix auth refresh", "--model missing/model fix auth refresh"]) {
	test(`invalid model selection stops worktree creation: ${args}`, async () => {
		const app = harness({ model: true });
		await app.run(args);
		assert.equal(app.files.size, 0);
		assert.ok(!app.calls.some((call) => call.command === "git" || call.command === "model"));
		assert.ok(app.notifications.some(({ message, level }) => level === "error" && message.includes("model")));
	});
}

test("startup with no source model or an older handoff keeps the default model", async () => {
	const app = harness();
	await app.run("fix auth refresh");
	assert.equal(app.config().model, undefined);
	app.ctx.model = otherModel;
	await app.start();
	assert.deepEqual(app.ctx.model, otherModel);
	assert.ok(!app.calls.some((call) => call.command === "setModel"));
});

test("startup does not reselect a model that is already active", async () => {
	const app = harness({ model: true });
	await app.run("fix auth refresh");
	await app.start();
	assert.ok(!app.calls.some((call) => call.command === "setModel"));
});

for (const herdr of [false, true]) {
	for (const options of [{ availableModels: [] }, { availableModels: [{ ...activeModel, id: "current-model-v2" }] }, { modelAuth: false }]) {
		test(`failed exact model selection blocks kickoff: Herdr=${herdr}, ${JSON.stringify(options)}`, async () => {
			const app = harness({ model: true, herdr, ...options });
			await app.run("fix auth refresh");
			if (herdr) app.env.PI_WORKTREE_CONFIG = [...app.files.keys()].find((path) => path.endsWith(".json"));
			app.ctx.model = otherModel;
			await app.start();
			assert.ok(app.notifications.some(({ message, level }) => level === "error" && message.includes("Check model availability and authentication")));
			assert.ok(!app.calls.some((call) => call.command === "prompt"));
		});
	}
}

for (const model of [null, {}, { provider: "test", id: "" }, { provider: 1, id: "test" }]) {
	test(`invalid handoff model is rejected: ${JSON.stringify(model)}`, async () => {
		const app = harness();
		await app.run("fix auth refresh");
		const config = app.config();
		config.model = model;
		app.files.set("/git/worktree/pi-worktree-launch.json", JSON.stringify(config));
		await app.start();
		assert.ok(app.notifications.some(({ message, level }) => level === "error" && message.includes("model must contain")));
		assert.ok(!app.calls.some((call) => call.command === "prompt"));
	});
}

function assertIssueContext(text) {
	for (const value of [issue.title, issue.body, issue.state, "bug", issue.comments[0].body, issueUrl]) {
		assert.ok(text.includes(value), `Missing issue context: ${value}`);
	}
}

test("fetch completes before model naming and all issue data reaches manual handoff", async () => {
	const app = harness({ model: true });
	await app.run(`--no-pr fix ${issueUrl} but do not change the public API`);
	assert.ok(app.calls.findIndex((call) => call.command === "gh") < app.calls.findIndex((call) => call.command === "model"));
	assertIssueContext(app.modelContext);
	assert.ok(app.modelContext.includes("but do not change the public API"));
	const config = app.config();
	assert.equal(config.metadata.branch, "pi/refresh-auth-cookie");
	assertIssueContext(config.metadata.task);
	assertIssueContext(config.prompt);
	assert.ok(config.prompt.includes("but do not change the public API"));
	assert.ok(!config.prompt.includes("open a pull request"));
	assert.deepEqual(Array.from(app.calls.find((call) => call.command === "gh").args),
		["issue", "view", issueUrl, "--json", "number,title,body,state,url,labels,comments"]);
});

test("local fallback uses issue title instead of URL; default PR behavior remains", async () => {
	const app = harness();
	await app.run(issueUrl);
	const config = app.config();
	assert.equal(config.metadata.branch, "pi/fix-auth-cookie-refresh");
	assert.equal(config.sessionName, "Fix Auth Cookie Refresh");
	assertIssueContext(config.prompt);
	assert.ok(config.prompt.includes("open a pull request"));
});

test("--no-prompt still fetches and retains enriched task metadata, but opens idle", async () => {
	const app = harness();
	await app.run(`--no-prompt ${issueUrl}`, "worktree");
	assert.equal(app.calls.filter((call) => call.command === "gh").length, 1);
	const config = app.config();
	assert.equal(config.sessionName, "Fix Auth Cookie Refresh");
	assert.equal(config.prompt, undefined);
	assertIssueContext(config.metadata.task);
});

test("inferred task links are fetched", async () => {
	const app = harness({ messages: [{ role: "user", content: `Please fix ${issueUrl}` }] });
	await app.run("");
	assert.equal(app.calls.filter((call) => call.command === "gh").length, 1);
	assertIssueContext(app.config().prompt);
});

test("Markdown links, query strings, fragments, and duplicates are normalized", async () => {
	const app = harness();
	await app.run(`[issue](${issueUrl}?source=pi#issuecomment-123), also <${issueUrl}>.`);
	const fetches = app.calls.filter((call) => call.command === "gh");
	assert.equal(fetches.length, 1);
	assert.equal(fetches[0].args[2], issueUrl);
});

test("multiple linked issues are all fetched before naming", async () => {
	const app = harness({ model: true });
	const otherUrl = "https://github.com/another/repo/issues/7";
	await app.run(`Fix ${issueUrl} and ${otherUrl}`);
	assert.deepEqual(app.calls.filter((call) => call.command === "gh").map((call) => call.args[2]), [issueUrl, otherUrl]);
	assert.equal(app.calls.filter((call) => call.command === "model").length, 1);
	assert.ok(app.modelContext.includes(otherUrl));
	assert.ok(app.config().prompt.includes(otherUrl));
});

test("forked Herdr kickoff includes fetched data even though conversation is inherited", async () => {
	const app = harness({ herdr: true });
	await app.run(issueUrl);
	const config = app.config();
	assert.equal(config.sourceSession, "/sessions/source.jsonl");
	assertIssueContext(config.prompt);
	assert.ok(config.prompt.includes("has been inherited"));
	assert.equal(config.metadata.herdrWorkspaceId, "new-workspace");
	assert.ok(app.calls.findIndex((call) => call.command === "gh") < app.calls.findIndex((call) => call.command === "herdr"));
});

for (const [name, options] of [
	["CLI failure", { ghError: new Error("gh auth login required") }],
	["invalid JSON", { ghOutput: "not json" }],
	["missing title", { ghOutput: "{}" }],
]) {
	test(`${name} stops creation and naming with an actionable error`, async () => {
		const app = harness({ model: true, ...options });
		await app.run(issueUrl);
		assert.ok(!app.calls.some((call) => call.command === "model" || call.command === "herdr" || call.args?.[0] === "worktree"));
		assert.equal(app.files.size, 0);
		const error = app.notifications.find((notification) => notification.level === "error");
		assert.ok(error.message.includes(`Could not fetch ${issueUrl}`));
		assert.ok(error.message.includes("installed and authenticated"));
	});
}

test("plain tasks, PR URLs, and non-GitHub URLs do not invoke gh", async () => {
	for (const task of ["fix auth cookie refresh", "https://github.com/example/project/pull/42", "https://example.com/example/project/issues/42", "https://github.com.evil.com/example/project/issues/42"]) {
		const app = harness();
		await app.run(task);
		assert.ok(!app.calls.some((call) => call.command === "gh"));
		assert.equal(app.config().metadata.task, task);
	}
});

function cleanupScript(app) {
	assert.equal(app.shutdown, true);
	const spawned = app.calls.find((call) => call.command === "bash");
	assert.ok(spawned, "Cleanup must be scheduled before shutdown");
	return app.files.get(spawned.args[0]);
}

for (const merged of [true, false]) {
	for (const choice of [0, 1]) {
		test(`cleanup uses one menu: merged=${merged}, delete branch=${choice === 1}`, async () => {
			const app = harness({ cleanup: { merged, choice } });
			await app.run("", "wtdone");
			assert.equal(app.dialogs.length, 1);
			const dialog = app.dialogs[0];
			assert.equal(dialog.type, "select");
			assert.ok(dialog.title.includes("/repo-worktrees/task"));
			assert.ok(dialog.title.includes(`pi/task (${merged ? "merged" : "not merged"} into main)`));
			assert.equal(dialog.title.includes("does not look like"), false);
			assert.equal(dialog.options[1].includes("commits may be lost"), !merged);
			const script = cleanupScript(app);
			assert.ok(script.includes("worktree remove '/repo-worktrees/task'"));
			assert.equal(script.includes("branch -"), choice === 1);
			if (choice === 1) assert.ok(script.includes(`branch ${merged ? "-d" : "-D"} 'pi/task'`));
			assert.ok(!script.includes("worktree remove --force"));
		});
	}
}

for (const choice of [2, null]) {
	test(`cancel or dismiss cleanup (${choice}) does not schedule or shut down`, async () => {
		const app = harness({ cleanup: { choice } });
		await app.run("", "wtdone");
		assert.equal(app.dialogs.length, 1);
		assert.equal(app.files.size, 0);
		assert.equal(app.shutdown, false);
		assert.ok(!app.calls.some((call) => call.command === "bash"));
	});
}

for (const flag of ["--keep-branch", "--delete-branch"]) {
	for (const confirm of [true, false]) {
		test(`${flag} uses one confirmation with unmerged warning; accepted=${confirm}`, async () => {
			const app = harness({ cleanup: { merged: false, confirm } });
			await app.run(flag, "worktree-done");
			assert.equal(app.dialogs.length, 1);
			assert.equal(app.dialogs[0].type, "confirm");
			assert.equal(app.dialogs[0].message.includes("may lose commits"), flag === "--delete-branch");
			assert.equal(app.shutdown, confirm);
			if (confirm) {
				const script = cleanupScript(app);
				assert.equal(script.includes("branch -D 'pi/task'"), flag === "--delete-branch");
				assert.ok(!script.includes("worktree remove --force"));
			} else assert.equal(app.files.size, 0);
		});
	}
}

test("dirty worktrees require --force before any dialog", async () => {
	const app = harness({ cleanup: { status: "?? notes.txt" } });
	await app.run("", "wtdone");
	assert.equal(app.dialogs.length, 0);
	assert.equal(app.shutdown, false);
	assert.equal(app.files.size, 0);
	assert.ok(app.notifications.some(({ message, level }) => level === "error" && message.includes("--force")));
});

for (const flag of ["--force", "-f --delete-branch"]) {
	test(`${flag} warns about lost files in its only dialog`, async () => {
		const app = harness({ cleanup: { status: "?? notes.txt", choice: 1 } });
		await app.run(flag, "wtdone");
		assert.equal(app.dialogs.length, 1);
		const dialog = app.dialogs[0];
		assert.ok((dialog.message ?? dialog.title).includes("uncommitted and untracked files will be lost"));
		const script = cleanupScript(app);
		assert.ok(script.includes("worktree remove --force"));
		assert.ok(script.includes("branch -D 'pi/task'"));
	});
}

test("non-Pi worktree warning is included in the only menu", async () => {
	const app = harness({ cleanup: { metadata: { worktreePath: "/other/task" } } });
	await app.run("", "wtdone");
	assert.equal(app.dialogs.length, 1);
	assert.ok(app.dialogs[0].title.includes("does not look like a Pi task worktree"));
	assert.ok(cleanupScript(app).includes("worktree remove '/other/task'"));
});

for (const { branchEntries, missingPaths = [] } of [{}, { branchEntries: [] }, { missingPaths: ["/parent-repo-worktrees/task"] }]) {
	test(`cleanup ignores inherited, removed, or abandoned metadata: abandoned=${Boolean(branchEntries)}, removed=${missingPaths.length > 0}`, async () => {
		const entries = [{ type: "custom", customType: "git-worktree", data: {
			repoRoot: "/parent-repo", worktreePath: "/parent-repo-worktrees/task",
			branch: "pi/parent", baseRef: "main", herdrWorkspaceId: "parent-workspace",
		} }];
		const app = harness({ entries, branchEntries, missingPaths });
		await app.run("--delete-branch", "wtdone");
		assert.equal(app.shutdown, false);
		assert.equal(app.dialogs.length, 0);
		assert.ok(app.notifications.some(({ message, level }) => level === "error" && message.includes("main repository")));
	});
}

test("canonical paths prevent cleanup of the main worktree through a symlink", async () => {
	const app = harness({
		cleanup: { metadata: { repoRoot: "/repo-link", worktreePath: "/repo" } },
		pathAliases: { "/repo-link": "/repo" },
	});
	await app.run("--force", "wtdone");
	assert.equal(app.shutdown, false);
	assert.equal(app.dialogs.length, 0);
	assert.ok(app.notifications.some(({ message }) => message.includes("main repository")));
});

test("Herdr cleanup still removes its workspace without forcing unmerged worktree removal", async () => {
	const app = harness({ herdr: true, cleanup: {
		merged: false, choice: 1,
		metadata: { worktreePath: "/other/task", herdrWorkspaceId: "source-workspace" },
	} });
	await app.run("", "wtdone");
	assert.equal(app.dialogs.length, 1);
	assert.ok(!app.dialogs[0].title.includes("does not look like"));
	const script = cleanupScript(app);
	assert.ok(script.includes("herdr worktree remove --workspace 'source-workspace'; then"));
	assert.ok(script.includes("branch -D 'pi/task'"));
	assert.ok(!script.includes("--force"));
});

for (const args of ["", "--force"]) {
	test(`main repository cannot be removed (${args || "no flags"})`, async () => {
		const app = harness({ cleanup: { metadata: { worktreePath: "/repo" } } });
		await app.run(args, "wtdone");
		assert.equal(app.dialogs.length, 0);
		assert.equal(app.shutdown, false);
		assert.equal(app.files.size, 0);
		assert.ok(app.notifications.some(({ message, level }) => level === "error" && message.includes("main repository")));
	});
}
