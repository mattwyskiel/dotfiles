import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";
import {
	CURRENT_SESSION_VERSION,
	type ExtensionAPI,
	type ExtensionContext,
	formatSize,
	getMarkdownTheme,
	type SessionHeader,
	SessionManager,
	truncateHead,
} from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

// A child runs at depth + 1. The tool stays registered in children so their tool list (and the
// prompt cache) matches the parent's, but it refuses to run past the maximum depth.
const DEPTH = Number(process.env.PI_SUBAGENT_DEPTH ?? 0) || 0;
const MAX_DEPTH = Number(process.env.PI_SUBAGENT_MAX_DEPTH ?? 1) || 1;
const MAX_CONCURRENT = 4;
const RESULT_MAX_BYTES = 12 * 1024;
const RESULT_MAX_LINES = 400;
const STDERR_MAX_CHARS = 4_000;
const COLLAPSED_PREVIEW_LINES = 6;
// Children are read-only: file changes stay in one agent. Blocking calls (instead of removing the
// tools) keeps the child's tool list, and so the prompt cache, the same as the parent's.
const WRITE_TOOLS = new Set(["edit", "write"]);

const FINAL_MESSAGE_RULE =
	"You are read-only: do not change files, not even with bash. Nobody can answer questions. Your final message is the only thing the parent agent receives. Make it complete and short: the result, the evidence (file paths with line numbers, commands and their outcome), and anything left undone. Do not restate the task or describe your process.";

// Subagent rules go in the task message, not the system prompt: an unchanged system prompt lets
// the child's first request reuse the parent's prompt cache.
const freshTask = (task: string) =>
	`<subagent>\nYou are a subagent. Another agent gave you the task below. Work on your own. ${FINAL_MESSAGE_RULE}\n</subagent>\n\n${task}`;

const forkTask = (task: string) =>
	`<subagent>\nYou are now a forked subagent. The conversation above is context from the parent agent; the subagent call above is you. Do only the task below, not the parent's other work. ${FINAL_MESSAGE_RULE}\n</subagent>\n\n${task}`;

type SubagentDetails = {
	mode: "fresh" | "fork" | "resume";
	model?: string;
	session: string;
	turns: number;
	usage: Usage;
	output: string;
	truncated: boolean;
	lastTool?: string;
};

const Params = Type.Object({
	task: Type.String({
		description: "Fresh: a self-contained brief (goal, known paths, constraints, wanted output). Fork/resume: the instruction only.",
	}),
	model: Type.Optional(
		Type.String({ description: "provider/id, optional :thinking suffix. Default: your model, which reuses your prompt cache." }),
	),
	fork: Type.Optional(Type.Boolean({ description: "Inherit this conversation, model, and tools." })),
	resume: Type.Optional(Type.String({ description: "Session path from an earlier subagent result, to continue it." })),
	tools: Type.Optional(
		Type.Array(Type.String(), {
			description: "Fresh only: tool allowlist. It changes the prompt, so the cache is not reused; use only to restrict risky work.",
		}),
	),
	cwd: Type.Optional(Type.String({ description: "Fresh only: working directory." })),
});

const OutputSchema = Type.Object({
	output: Type.String(),
	session: Type.String(),
	model: Type.Optional(Type.String()),
});

function emptyUsage(): Usage {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function addUsage(total: Usage, usage: Usage | undefined) {
	if (!usage) return;
	total.input += usage.input || 0;
	total.output += usage.output || 0;
	total.cacheRead += usage.cacheRead || 0;
	total.cacheWrite += usage.cacheWrite || 0;
	total.totalTokens += usage.totalTokens || 0;
	for (const key of Object.keys(total.cost) as (keyof Usage["cost"])[]) {
		total.cost[key] += usage.cost?.[key] || 0;
	}
}

function formatTokens(count: number): string {
	if (count < 1_000) return String(count);
	if (count < 100_000) return `${(count / 1_000).toFixed(1)}k`;
	return `${Math.round(count / 1_000)}k`;
}

function usageLine(details: SubagentDetails): string {
	const { usage } = details;
	const parts = [`${details.turns} turn${details.turns === 1 ? "" : "s"}`];
	if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
	if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
	if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
	if (usage.cost.total) parts.push(`$${usage.cost.total.toFixed(4)}`);
	if (details.model) parts.push(details.model);
	return parts.join(" ");
}

function assistantText(message: AssistantMessage): string {
	return message.content
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join("\n")
		.trim();
}

/** Run `pi` the same way the parent was started, so children use the same install. */
function piInvocation(args: string[]): { command: string; args: string[] } {
	const script = process.argv[1];
	if (script && !script.startsWith("/$bunfs/root/") && existsSync(script)) {
		return { command: process.execPath, args: [script, ...args] };
	}
	if (!/^(node|bun)(\.exe)?$/i.test(basename(process.execPath))) return { command: process.execPath, args };
	return { command: "pi", args };
}

/** Child sessions sit next to the parent session, in a subdirectory that `pi -c` does not scan. */
function childSessionDir(ctx: ExtensionContext): string {
	const parent = ctx.sessionManager.getSessionFile();
	const dir = parent
		? join(dirname(parent), basename(parent, ".jsonl"), "subagents")
		: join(tmpdir(), "pi-subagents");
	mkdirSync(dir, { recursive: true });
	return dir;
}

/**
 * Child sessions take the parent's session id. Providers such as OpenAI Codex route their prompt
 * cache by session id, so a new id misses the cache even when the request prefix is identical.
 */
function setSessionId(file: string, id: string) {
	const [first, ...rest] = readFileSync(file, "utf8").split("\n");
	const header = JSON.parse(first) as SessionHeader;
	header.id = id;
	writeFileSync(file, [JSON.stringify(header), ...rest].join("\n"));
}

function forkSession(ctx: ExtensionContext, dir: string): string {
	const parent = ctx.sessionManager.getSessionFile();
	const leafId = ctx.sessionManager.getLeafId();
	if (!parent || !leafId || !existsSync(parent)) {
		throw new Error("fork needs a saved parent session. Run without fork and give a self-contained task.");
	}
	const file = SessionManager.open(parent, dir).createBranchedSession(leafId);
	if (!file || !existsSync(file)) throw new Error("Could not create the forked session file.");
	setSessionId(file, ctx.sessionManager.getSessionId());
	return file;
}

function freshSession(ctx: ExtensionContext, dir: string, cwd: string): string {
	const timestamp = new Date().toISOString();
	const file = join(dir, `${timestamp.replace(/[:.]/g, "-")}_${randomUUID()}.jsonl`);
	const header: SessionHeader = {
		type: "session",
		version: CURRENT_SESSION_VERSION,
		id: ctx.sessionManager.getSessionId(),
		timestamp,
		cwd,
		parentSession: ctx.sessionManager.getSessionFile(),
	};
	writeFileSync(file, `${JSON.stringify(header)}\n`);
	return file;
}

function createLimiter(limit: number) {
	let active = 0;
	const waiting: (() => void)[] = [];
	return async <T>(fn: () => Promise<T>): Promise<T> => {
		if (active >= limit) await new Promise<void>((resolveSlot) => waiting.push(resolveSlot));
		active++;
		try {
			return await fn();
		} finally {
			active--;
			waiting.shift()?.();
		}
	};
}

function describe(models: string[]): string {
	return [
		"Run a task in a separate, read-only Pi agent and get back only its final message.",
		"Use it only when separate context helps: (1) noisy exploration (many searches, logs, or file reads) where only a short summary matters; (2) independent investigations in parallel (several calls in one turn); (3) a fresh-eyes review or a second opinion, optionally from another model.",
		"Do routine work and all file changes yourself.",
		"Fresh (default): the subagent sees only `task` plus project instructions. Use fresh for reviews: give the requirements and the diff or paths, not your reasoning.",
		"fork: true: it inherits this conversation; use it for side investigations that need the discussion so far.",
		"resume: ask an earlier subagent a follow-up.",
		"Subagents cannot start subagents.",
		models.length ? `Models: ${models.join(", ")}.` : "",
	]
		.filter(Boolean)
		.join(" ");
}

export default function subagentExtension(pi: ExtensionAPI) {
	const limit = createLimiter(MAX_CONCURRENT);

	const register = (models: string[]) =>
		pi.registerTool({
			name: "subagent",
			label: "Subagent",
			description: describe(models),
			parameters: Params,
			outputSchema: OutputSchema,
			executionMode: "parallel",

			async execute(_toolCallId, params, signal, onUpdate, ctx) {
				if (DEPTH >= MAX_DEPTH) {
					throw new Error("Subagents cannot start subagents. Do the work yourself.");
				}
				const mode: SubagentDetails["mode"] = params.resume ? "resume" : params.fork ? "fork" : "fresh";
				if (params.fork && params.resume) throw new Error("Use fork or resume, not both.");
				if (mode !== "fresh" && (params.tools || params.cwd)) {
					throw new Error("tools and cwd apply only to fresh subagents.");
				}

				const cwd = params.cwd ? resolve(ctx.cwd, params.cwd) : ctx.cwd;
				let session: string;
				let task = params.task;
				if (mode === "resume") {
					session = isAbsolute(params.resume!) ? params.resume! : resolve(ctx.cwd, params.resume!);
					if (!existsSync(session)) throw new Error(`No subagent session at ${session}.`);
				} else if (mode === "fork") {
					session = forkSession(ctx, childSessionDir(ctx));
					task = forkTask(task);
				} else {
					session = freshSession(ctx, childSessionDir(ctx), cwd);
					task = freshTask(task);
				}

				const args = ["--mode", "json", "-p", "--session", session];
				if (params.tools) args.push("--tools", params.tools.join(","));
				// Fork and fresh default to the parent's model and thinking level; resume keeps the child's.
				const parentModel = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
				const model = params.model ?? (mode === "resume" ? undefined : parentModel);
				if (model) args.push("--model", model);
				if (!params.model && mode !== "resume" && ctx.thinkingLevel) args.push("--thinking", ctx.thinkingLevel);
				args.push(task);

				const details: SubagentDetails = {
					mode,
					model,
					session,
					turns: 0,
					usage: emptyUsage(),
					output: "",
					truncated: false,
				};
				let finalMessage: AssistantMessage | undefined;
				let stderr = "";

				const update = () =>
					onUpdate?.({
						content: [{ type: "text", text: details.lastTool ? `${usageLine(details)} · ${details.lastTool}` : usageLine(details) }],
						details: { ...details },
					});

				const env: NodeJS.ProcessEnv = { ...process.env, PI_SUBAGENT_DEPTH: String(DEPTH + 1) };
				// The parent owns its worktree launch config; a child must not delete it on shutdown.
				delete env.PI_WORKTREE_CONFIG;

				const exitCode = await limit(
					() =>
						new Promise<number>((resolveExit) => {
							const invocation = piInvocation(args);
							const child = spawn(invocation.command, invocation.args, {
								cwd,
								env,
								stdio: ["ignore", "pipe", "pipe"],
							});
							let buffer = "";

							const handleLine = (line: string) => {
								// Streaming deltas are large and not needed; skip them before parsing.
								if (!line || line.startsWith('{"type":"message_update"')) return;
								let event: any;
								try {
									event = JSON.parse(line);
								} catch {
									return;
								}
								if (event.type === "tool_execution_start") {
									details.lastTool = event.toolName;
									update();
								} else if (event.type === "message_end" && event.message?.role === "assistant") {
									const message = event.message as AssistantMessage;
									details.turns++;
									addUsage(details.usage, message.usage);
									details.model = `${message.provider}/${message.model}`;
									finalMessage = message;
									update();
								}
							};

							child.stdout.on("data", (chunk: Buffer) => {
								buffer += chunk.toString();
								const lines = buffer.split("\n");
								buffer = lines.pop() ?? "";
								for (const line of lines) handleLine(line);
							});
							child.stderr.on("data", (chunk: Buffer) => {
								stderr = (stderr + chunk.toString()).slice(-STDERR_MAX_CHARS);
							});
							child.on("error", (error) => {
								stderr += `\n${error.message}`;
								resolveExit(1);
							});
							child.on("close", (code) => {
								handleLine(buffer.trim());
								resolveExit(code ?? 1);
							});

							const kill = () => {
								child.kill("SIGTERM");
								setTimeout(() => child.exitCode === null && child.kill("SIGKILL"), 5_000).unref();
							};
							if (signal?.aborted) kill();
							else signal?.addEventListener("abort", kill, { once: true });
						}),
				);

				if (signal?.aborted) throw new Error(`Subagent aborted. Session: ${session}`);
				const failed = exitCode !== 0 || !finalMessage || ["error", "aborted", "length"].includes(finalMessage.stopReason);
				if (failed) {
					const reason = finalMessage?.errorMessage || stderr.trim() || `pi exited with code ${exitCode}`;
					throw new Error(`Subagent failed (${finalMessage?.stopReason ?? `exit ${exitCode}`}): ${reason}\nSession: ${session}`);
				}

				const output = assistantText(finalMessage!) || "(no output)";
				const truncation = truncateHead(output, { maxBytes: RESULT_MAX_BYTES, maxLines: RESULT_MAX_LINES });
				let text = truncation.content;
				if (truncation.truncated) {
					const full = join(mkdtempSync(join(tmpdir(), "pi-subagent-")), "output.md");
					writeFileSync(full, output);
					text += `\n\n[Truncated: showed ${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}. Full answer: ${full}]`;
				}
				text += `\n\n[subagent session: ${session}]`;

				details.output = output;
				details.truncated = truncation.truncated;
				return {
					content: [{ type: "text", text }],
					structuredContent: { output, session, ...(details.model && { model: details.model }) },
					details,
					usage: details.usage,
				};
			},

			renderCall(args, theme) {
				const mode = args.resume ? "resume" : args.fork ? "fork" : "fresh";
				const firstLine = (args.task ?? "").split("\n")[0];
				const preview = firstLine.length > 80 ? `${firstLine.slice(0, 80)}…` : firstLine;
				let text = theme.fg("toolTitle", theme.bold("subagent ")) + theme.fg("muted", mode);
				if (args.model) text += ` ${theme.fg("accent", args.model)}`;
				return new Text(`${text} ${theme.fg("dim", preview)}`, 0, 0);
			},

			renderResult(result, { expanded, isPartial }, theme) {
				const details = result.details as SubagentDetails | undefined;
				const first = result.content[0];
				if (!details || isPartial) {
					return new Text(theme.fg("dim", first?.type === "text" ? first.text : "running…"), 0, 0);
				}
				const container = new Container();
				container.addChild(new Text(theme.fg("dim", usageLine(details)), 0, 0));
				if (expanded) {
					container.addChild(new Markdown(details.output, 0, 0, getMarkdownTheme()));
					container.addChild(new Text(theme.fg("dim", details.session), 0, 0));
				} else {
					const lines = details.output.split("\n");
					const preview = lines.slice(0, COLLAPSED_PREVIEW_LINES).join("\n");
					const more = lines.length > COLLAPSED_PREVIEW_LINES ? `\n… ${lines.length - COLLAPSED_PREVIEW_LINES} more lines` : "";
					container.addChild(new Text(theme.fg("toolOutput", preview) + theme.fg("dim", more), 0, 0));
				}
				return container;
			},
		});

	register([]);

	// Nested calls from codemode scripts also pass through tool_call, so this covers them too.
	if (DEPTH > 0) {
		pi.on("tool_call", (event) => {
			if (!WRITE_TOOLS.has(event.toolName)) return undefined;
			return { block: true, reason: "Subagents are read-only. Report the change you would make instead." };
		});
	}

	// List the session's scoped models in the description. Children compute the same list, so
	// their tool declarations still match the parent's.
	pi.on("session_start", (_event, ctx) => {
		const models = ctx.scopedModels.map(
			({ model, thinkingLevel }) => `${model.provider}/${model.id}${thinkingLevel ? `:${thinkingLevel}` : ""}`,
		);
		if (models.length) register(models);
	});
}
