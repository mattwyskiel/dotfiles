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

function harness({ model = false, messages = [], herdr = false, ghError, ghOutput, cleanup } = {}) {
	const calls = [];
	const files = new Map();
	const notifications = [];
	const commands = new Map();
	const dialogs = [];
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
			else if (args[0] === "rev-parse" && args.includes("--show-toplevel")) stdout = "/repo";
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
		complete: async (_model, context) => {
			calls.push({ command: "model" });
			modelContext = context.messages[0].content[0].text;
			return { content: [{ type: "text", text: '{"slug":"refresh-auth-cookie","title":"Refresh Auth Cookie"}' }] };
		},
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
		readFile: async (path) => files.get(path),
		writeFile: async (path, content) => { files.set(path, content); },
		unlink: async (path) => { files.delete(path); },
		tmpdir: () => "/tmp",
		basename, dirname, join, resolve,
		process: { pid: 123, env: herdr ? { HERDR_ENV: "1", HERDR_WORKSPACE_ID: "source-workspace" } : {} },
	});
	extension({ on: () => {}, registerCommand: (name, command) => commands.set(name, command) });
	const ctx = {
		cwd: "/repo",
		model: model ? {} : undefined,
		modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "test-only" }) },
		sessionManager: {
			getEntries: () => metadata ? [{ type: "custom", customType: "git-worktree", data: metadata }] : [],
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
		calls, files, notifications, dialogs,
		get shutdown() { return shutdown; },
		get modelContext() { return modelContext; },
		run: (args, command = "wt") => commands.get(command).handler(args, ctx),
		config: () => JSON.parse([...files.entries()].find(([path]) => path.endsWith(".json"))[1]),
	};
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
