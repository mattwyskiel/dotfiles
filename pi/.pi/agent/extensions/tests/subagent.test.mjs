import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";

// Run the real extension in a VM with the installed Pi modules and a fake child process.
// PI_TEST_NODE_MODULES points to the node_modules directory of a Pi installation.
const modules = process.env.PI_TEST_NODE_MODULES;
const skip = !modules && "Set PI_TEST_NODE_MODULES to run the subagent tests";

const source = await readFile(new URL("../subagent.ts", import.meta.url), "utf8");
const code = stripTypeScriptTypes(source
	.replace(/^import [\s\S]*?;\n/gm, "")
	.replace("export default function subagentExtension", "function subagentExtension"));

async function piModules() {
	const url = (file) => pathToFileURL(path.join(modules, file)).href;
	return {
		pi: await import(url("@earendil-works/pi-coding-agent/dist/index.js")),
		tui: await import(url("@earendil-works/pi-tui/dist/index.js")),
		typebox: await import(url("typebox/build/index.mjs")),
	};
}

function write(file, text) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, text);
}

async function setup({ env = {}, trusted = true } = {}) {
	const { pi, tui, typebox } = await piModules();
	const root = fs.mkdtempSync(path.join(tmpdir(), "subagent-test-"));
	const agentDir = path.join(root, "agent");
	const project = path.join(root, "project");
	const cwd = path.join(project, "src");
	fs.mkdirSync(cwd, { recursive: true });
	write(path.join(agentDir, "agents", "reviewer.md"), "---\ndescription: User reviewer\n---\nUser prompt.\n");
	write(path.join(agentDir, "agents", "scout.md"), "---\ndescription: Finds code\ntools: read, grep\n---\nScout prompt.\n");
	write(path.join(agentDir, "agents", "broken.md"), "---\ntools: read\n---\nNo description.\n");
	write(path.join(project, ".pi", "agents", "review.md"), [
		"---",
		"name: reviewer",
		"description: Project reviewer",
		"model: other/model:high",
		"tools: [read, bash, edit]",
		"write: true",
		"---",
		"Project prompt.",
		"",
	].join("\n"));

	const spawns = [];
	const spawn = (command, args, options) => {
		spawns.push({ command, args, options });
		const child = new EventEmitter();
		child.stdout = new PassThrough();
		child.stderr = new PassThrough();
		child.exitCode = null;
		child.kill = () => {};
		setImmediate(() => {
			const message = {
				role: "assistant",
				content: [{ type: "text", text: "child answer" }],
				provider: "test",
				model: "child",
				stopReason: "stop",
				usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			};
			child.stdout.end(`${JSON.stringify({ type: "message_end", message })}\n`);
			child.exitCode = 0;
			setImmediate(() => child.emit("close", 0));
		});
		return child;
	};

	const tools = [];
	const handlers = new Map();
	const piApi = {
		registerTool: (tool) => tools.push(tool),
		on: (name, handler) => handlers.set(name, handler),
	};
	const extension = runInNewContext(`${code}\nsubagentExtension`, {
		spawn,
		randomUUID,
		...fs,
		tmpdir,
		...path,
		...pi,
		getAgentDir: () => agentDir,
		CONFIG_DIR_NAME: ".pi",
		Container: tui.Container,
		Markdown: tui.Markdown,
		Text: tui.Text,
		Type: typebox.Type,
		process: { env: { ...env }, argv: ["node", "/missing/pi"], execPath: "/usr/bin/node" },
		setTimeout,
		Number,
		String,
		JSON,
		Error,
		Map,
		Set,
		Object,
		Promise,
	});
	extension(piApi);

	const sessionFile = path.join(root, "sessions", "parent.jsonl");
	write(sessionFile, "{}\n");
	const notifications = [];
	const ctx = {
		cwd,
		model: { provider: "parent", id: "model" },
		thinkingLevel: "high",
		scopedModels: [],
		hasUI: true,
		ui: { notify: (...args) => notifications.push(args) },
		isProjectTrusted: () => trusted,
		sessionManager: {
			getSessionFile: () => sessionFile,
			getSessionId: () => "parent-id",
			getLeafId: () => undefined,
		},
	};
	await handlers.get("session_start")?.({}, ctx);
	const tool = () => tools.at(-1);
	const run = (params) => tool().execute("call", params, undefined, undefined, ctx);
	return { tool, run, spawns, handlers, notifications, ctx, root, project };
}

const flag = (args, name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const header = (file) => JSON.parse(fs.readFileSync(file, "utf8").split("\n")[0]);

test("discovers user and project agents and lists them", { skip }, async () => {
	const { tool, notifications } = await setup();
	const description = tool().description;
	assert.match(description, /reviewer \(model other\/model:high; tools read,bash,edit; can write\): Project reviewer/);
	assert.match(description, /scout \(tools read,grep\): Finds code/);
	assert.doesNotMatch(description, /User reviewer/);
	assert.match(description, /read-only unless their agent can write/);
	assert.equal(notifications.length, 1);
	assert.match(notifications[0][0], /broken\.md: description is required/);
});

test("ignores project agents in an untrusted project", { skip }, async () => {
	const { tool, run } = await setup({ trusted: false });
	assert.match(tool().description, /reviewer: User reviewer/);
	assert.doesNotMatch(tool().description, /Project reviewer/);
	await assert.rejects(run({ task: "x", agent: "missing" }), /No agent named "missing"\. Available: reviewer, scout\./);
});

test("a fresh agent call applies the agent settings", { skip }, async () => {
	const { run, spawns, ctx } = await setup();
	const result = await run({ task: "Review the diff.", agent: "reviewer" });
	assert.equal(result.structuredContent.output, "child answer");
	const { args, options } = spawns[0];
	assert.equal(flag(args, "--tools"), "read,bash,edit");
	assert.equal(flag(args, "--model"), "other/model:high");
	assert.ok(!args.includes("--thinking"), "an agent model keeps its own thinking level");
	assert.ok(args.includes("--approve"));
	assert.equal(options.cwd, ctx.cwd);
	assert.equal(options.env.PI_SUBAGENT_WRITE, "1");
	assert.equal(options.env.PI_SUBAGENT_DEPTH, "1");
	const task = args.at(-1);
	assert.match(task, /You can change files\./);
	assert.match(task, /<agent name="reviewer">\nProject prompt\.\n<\/agent>\n\nReview the diff\.$/);
	assert.deepEqual(header(flag(args, "--session")).subagent, { agent: "reviewer", tools: ["read", "bash", "edit"], write: true });
	assert.equal(result.details.agent, "reviewer");
});

test("call parameters override agent settings", { skip }, async () => {
	const { run, spawns } = await setup();
	await run({ task: "x", agent: "scout", model: "picked/model", tools: ["read"] });
	const { args, options } = spawns[0];
	assert.equal(flag(args, "--tools"), "read");
	assert.equal(flag(args, "--model"), "picked/model");
	assert.equal(options.env.PI_SUBAGENT_WRITE, undefined);
	assert.match(args.at(-1), /You are read-only/);
});

test("a plain fresh call keeps the parent model and no metadata", { skip }, async () => {
	const { run, spawns } = await setup({ env: { PI_SUBAGENT_WRITE: "1" } });
	await run({ task: "x" });
	const { args, options } = spawns[0];
	assert.equal(flag(args, "--model"), "parent/model");
	assert.equal(flag(args, "--thinking"), "high");
	assert.ok(!args.includes("--tools"));
	assert.equal(options.env.PI_SUBAGENT_WRITE, undefined, "write access is not inherited from the environment");
	assert.equal(header(flag(args, "--session")).subagent, undefined);
	assert.doesNotMatch(args.at(-1), /<agent/);
});

test("resume restores tools and write access from the session header", { skip }, async () => {
	const { run, spawns } = await setup();
	await run({ task: "x", agent: "reviewer" });
	const session = flag(spawns[0].args, "--session");
	await run({ task: "follow-up", resume: session });
	const { args, options } = spawns[1];
	assert.equal(flag(args, "--tools"), "read,bash,edit");
	assert.equal(flag(args, "--model"), undefined);
	assert.equal(options.env.PI_SUBAGENT_WRITE, "1");
	assert.equal(args.at(-1), "follow-up");
	await assert.rejects(run({ task: "x", resume: session, agent: "scout" }), /apply only to fresh subagents/);
});

test("children block file changes unless their agent can write", { skip }, async () => {
	const readOnly = await setup({ env: { PI_SUBAGENT_DEPTH: "1" } });
	const blockToolCall = readOnly.handlers.get("tool_call");
	assert.equal(blockToolCall({ toolName: "edit" })?.block, true);
	assert.equal(blockToolCall({ toolName: "read" }), undefined);
	await assert.rejects(readOnly.run({ task: "x" }), /cannot start subagents/);
	const writer = await setup({ env: { PI_SUBAGENT_DEPTH: "1", PI_SUBAGENT_WRITE: "1" } });
	assert.equal(writer.handlers.get("tool_call"), undefined);
});
