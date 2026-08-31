import { complete } from "@earendil-works/pi-ai/compat";
import { buildSessionContext, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

type ExecResult = { stdout: string; stderr: string };

type CmuxTree = {
	caller?: { workspace_ref?: string };
	windows?: Array<{
		workspaces?: Array<{ ref: string }>;
	}>;
};

type CmuxSurface = {
	type: "terminal" | "browser";
	name?: string;
	command?: string;
	url?: string;
	focus?: boolean;
};

type CmuxLayout =
	| { pane: { surfaces: CmuxSurface[] } }
	| { direction: "horizontal" | "vertical"; split: number; children: [CmuxLayout, CmuxLayout] };

type CmuxWorkspaceGroupList = {
	groups?: Array<{
		ref: string;
		member_workspace_refs?: string[];
	}>;
};

type CurrentCmuxWorkspace = {
	ref?: string;
	groupRef?: string;
};

type WorktreeMetadata = {
	repoRoot: string;
	worktreePath: string;
	branch: string;
	baseRef: string;
	task?: string;
	title?: string;
};

type TaskIdentity = {
	slug: string;
	title: string;
};

type ConversationContext = {
	transcript: string;
	inferredTask?: string;
};

/**
 * One-file handoff from the creating Pi process to the Pi process opened in the
 * worktree. cmux launches pass the file through `PI_WORKTREE_CONFIG` and, when
 * prompted, as Pi's sole positional CLI argument (`@config`). Manual launches
 * discover a one-shot copy in the worktree's private Git directory, restore its
 * metadata, and submit its prompt from `session_start`.
 */
type WorktreeLaunchConfig = {
	version: 1;
	sessionName: string;
	prompt?: string;
	sourceSession?: string;
	metadata: WorktreeMetadata;
};

type WorktreeListEntry = {
	worktree: string;
	branch?: string;
};

const PENDING_LAUNCH_CONFIG_NAME = "pi-worktree-launch.json";

async function run(command: string, args: string[], cwd?: string): Promise<ExecResult> {
	return execFile(command, args, { cwd, maxBuffer: 1024 * 1024 });
}

async function git(args: string[], cwd: string): Promise<string> {
	const { stdout } = await run("git", args, cwd);
	return stdout.trim();
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function slugify(value: string, maxLength = 32): string {
	const slug = value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, maxLength)
		.replace(/-+$/g, "");

	return slug || `task-${Date.now()}`;
}

function summarizeTaskSlugFallback(task: string): string {
	const stopWords = new Set([
		"a", "an", "and", "are", "as", "at", "be", "by", "can", "could", "for", "from", "i", "in", "into", "is", "it", "make", "of", "on", "or", "please", "the", "this", "to", "up", "use", "want", "with", "would", "you",
	]);
	const words = task
		.toLowerCase()
		.replace(/['"]/g, "")
		.split(/[^a-z0-9]+/)
		.filter((word) => word.length > 1 && !stopWords.has(word));

	return slugify(words.slice(0, 4).join("-"));
}

const HUMAN_TITLE_WORDS: Record<string, string> = {
	api: "API",
	aws: "AWS",
	bash: "Bash",
	bun: "Bun",
	cli: "CLI",
	css: "CSS",
	html: "HTML",
	javascript: "JavaScript",
	json: "JSON",
	pi: "Pi",
	sdk: "SDK",
	typescript: "TypeScript",
	ui: "UI",
	url: "URL",
};

function humanTitleFallback(task: string): string {
	const words = task
		.replace(/['"]/g, "")
		.split(/[^A-Za-z0-9]+/)
		.filter(Boolean);
	const leadingFillers = new Set(["can", "could", "i", "please", "want", "would", "you"]);
	while (words.length > 1 && leadingFillers.has(words[0].toLowerCase())) words.shift();

	const minorWords = new Set(["a", "an", "and", "as", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with"]);
	const title = words.slice(0, 8).map((word, index) => {
		const lower = word.toLowerCase();
		if (HUMAN_TITLE_WORDS[lower]) return HUMAN_TITLE_WORDS[lower];
		if (index > 0 && minorWords.has(lower)) return lower;
		return `${word[0].toUpperCase()}${word.slice(1).toLowerCase()}`;
	});
	return title.join(" ").slice(0, 72).trim() || "Pi Worktree Task";
}

function sanitizeHumanTitle(value: unknown, fallbackTask: string): string {
	if (typeof value !== "string") return humanTitleFallback(fallbackTask);
	const title = value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").replace(/^['"]|['"]$/g, "").trim();
	return title.slice(0, 72).trim() || humanTitleFallback(fallbackTask);
}

/**
 * Infer both machine- and human-readable task names from the available request
 * context. One model call keeps the branch, workspace, and session names aligned.
 */
async function summarizeTaskIdentity(
	context: string,
	fallbackTask: string,
	ctx: ExtensionCommandContext,
): Promise<TaskIdentity> {
	const fallbackTitle = humanTitleFallback(fallbackTask);
	const fallback = { slug: summarizeTaskSlugFallback(fallbackTask), title: fallbackTitle };
	if (!ctx.model) return fallback;

	try {
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
		if (!auth.ok || !auth.apiKey) return fallback;

		const response = await complete(
			ctx.model,
			{
				messages: [{
					role: "user" as const,
					content: [{ type: "text" as const, text: [
						"Infer the single coding task that should continue in a new git worktree from the context below.",
						"Return JSON only: {\"slug\":\"...\",\"title\":\"...\"}",
						"slug rules: 2-4 descriptive words, lowercase kebab-case, <= 32 chars.",
						"title rules: concise Human Title Case, typically 3-7 words, <= 72 chars; preserve names such as Bash, Bun, TypeScript, and API.",
						"Prioritize the latest user request and any explicit /wt task. Do not describe the act of creating a worktree.",
						"",
						context,
					].join("\n") }],
					timestamp: Date.now(),
				}],
			},
			{ apiKey: auth.apiKey, headers: auth.headers, reasoningEffort: "minimal" },
		);
		const content = response.content as Array<{ type: string; text?: string }>;
		const text = content
			.filter((block) => block.type === "text" && typeof block.text === "string")
			.map((block) => block.text)
			.join(" ");
		const json = text.match(/\{[\s\S]*\}/)?.[0];
		if (!json) return fallback;
		const parsed = JSON.parse(json) as { slug?: unknown; title?: unknown };
		const title = sanitizeHumanTitle(parsed.title, fallbackTask);
		const slugSource = typeof parsed.slug === "string" && parsed.slug.trim() ? parsed.slug : title;
		return { slug: slugify(slugSource), title };
	} catch {
		return fallback;
	}
}

function contentText(content: unknown): string {
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";
	return content
		.flatMap((block) => {
			if (!block || typeof block !== "object") return [];
			const value = block as { type?: string; text?: unknown };
			if (value.type === "text" && typeof value.text === "string") return [value.text];
			if (value.type === "image") return ["[image]"];
			return [];
		})
		.join("\n")
		.trim();
}

/**
 * Serialize conversational messages for task naming and ephemeral-session
 * handoff. Tool output and private thinking are intentionally omitted; persisted
 * sessions are forked so the launched Pi still receives the complete context.
 */
function conversationContext(ctx: ExtensionCommandContext): ConversationContext {
	const messages = buildSessionContext(
		ctx.sessionManager.getEntries(),
		ctx.sessionManager.getLeafId(),
	).messages as Array<{
		role: string;
		content?: unknown;
		summary?: unknown;
	}>;
	const parts: string[] = [];
	const userMessages: string[] = [];

	for (const message of messages) {
		if (message.role === "user" || message.role === "assistant" || message.role === "custom") {
			const text = contentText(message.content);
			if (!text) continue;
			parts.push(`${message.role.toUpperCase()}: ${text}`);
			if (message.role === "user") userMessages.push(text);
		} else if ((message.role === "branchSummary" || message.role === "compactionSummary") && typeof message.summary === "string") {
			parts.push(`CONTEXT SUMMARY: ${message.summary}`);
		}
	}

	const fullTranscript = parts.join("\n\n");
	const maxCharacters = 30_000;
	const transcript = fullTranscript.length > maxCharacters
		? `[Earlier conversation omitted for task naming]\n${fullTranscript.slice(-maxCharacters)}`
		: fullTranscript;
	const inferredTask = userMessages
		.slice()
		.reverse()
		.find((message) => message.length >= 24 && message.trim().split(/\s+/).length >= 4)
		?? userMessages.at(-1);
	return { transcript, inferredTask };
}

async function uniqueWorktreePath(repoRoot: string, slug: string): Promise<string> {
	const rootName = basename(repoRoot);
	const worktreesRoot = join(dirname(repoRoot), `${rootName}-worktrees`);
	await mkdir(worktreesRoot, { recursive: true });

	let candidate = join(worktreesRoot, slug);
	let index = 2;
	while (existsSync(candidate)) {
		candidate = join(worktreesRoot, `${slug}-${index}`);
		index += 1;
	}
	return candidate;
}

async function uniqueBranchName(repoRoot: string, slug: string): Promise<string> {
	const base = `pi/${slug}`;
	let branch = base;
	let index = 2;
	while (true) {
		try {
			await git(["rev-parse", "--verify", "--quiet", branch], repoRoot);
			branch = `${base}-${index}`;
			index += 1;
		} catch {
			return branch;
		}
	}
}

function parseArgs(args: string): { base?: string; noPrompt: boolean; noPr: boolean; task: string } {
	const tokens = args.trim().match(/(?:[^"\s]+|"[^"]*"|'[^']*')+/g) ?? [];
	let base: string | undefined;
	let noPrompt = false;
	let noPr = false;
	const taskParts: string[] = [];

	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (token === "--no-prompt") {
			noPrompt = true;
			continue;
		}
		if (token === "--no-pr") {
			noPr = true;
			continue;
		}
		if (token === "--base") {
			base = tokens[index + 1];
			if (base) index += 1;
			continue;
		}
		const baseEquals = token.match(/^--base=(.+)$/);
		if (baseEquals) {
			base = baseEquals[1];
			continue;
		}
		taskParts.push(token);
	}

	return {
		base,
		noPrompt,
		noPr,
		task: taskParts.join(" ").trim().replace(/^['"]|['"]$/g, ""),
	};
}

function kickoffPrompt(
	task: string,
	conversation: ConversationContext,
	sourceSession?: string,
	openPr = true,
): string {
	const lines = [
		"Continue this coding task in the new git worktree.",
		sourceSession
			? "The complete preceding Pi conversation has been inherited from the source session. Treat it as authoritative context for the task, requirements, decisions, and progress."
			: "Use the preceding conversation included below as authoritative context for the task, requirements, decisions, and progress.",
		`Task to continue: ${task}`,
		"Inspect the worktree state, then continue the requested implementation without asking the user to repeat context.",
	];

	if (openPr) {
		lines.push("When the implementation is ready, commit and push the changes, open a pull request, then watch the pull request for review comments and address actionable feedback.");
	}

	if (!sourceSession && conversation.transcript) {
		lines.push("", "Preceding conversation:", conversation.transcript);
	}
	return lines.join("\n");
}

async function writeLaunchConfig(
	configPath: string,
	metadata: WorktreeMetadata,
	prompt?: string,
	sourceSession?: string,
): Promise<void> {
	const config: WorktreeLaunchConfig = {
		version: 1,
		sessionName: metadata.title ?? metadata.task ?? metadata.branch,
		...(prompt ? { prompt } : {}),
		sourceSession,
		metadata,
	};

	await mkdir(dirname(configPath), { recursive: true });
	await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
	await chmod(configPath, 0o600);
}

async function createLaunchConfig(
	metadata: WorktreeMetadata,
	prompt?: string,
	sourceSession?: string,
): Promise<string> {
	const configPath = join(tmpdir(), `pi-worktree-${process.pid}-${Date.now()}.json`);
	await writeLaunchConfig(configPath, metadata, prompt, sourceSession);
	return configPath;
}

async function pendingLaunchConfigPath(cwd: string): Promise<string> {
	const worktreeRoot = await git(["rev-parse", "--show-toplevel"], cwd);
	const gitPath = await git(["rev-parse", "--git-path", PENDING_LAUNCH_CONFIG_NAME], worktreeRoot);
	return resolve(worktreeRoot, gitPath);
}

async function createPendingLaunchConfig(metadata: WorktreeMetadata, prompt?: string): Promise<string> {
	const configPath = await pendingLaunchConfigPath(metadata.worktreePath);
	await writeLaunchConfig(configPath, metadata, prompt);
	return configPath;
}

function parseLaunchConfig(value: unknown): WorktreeLaunchConfig {
	if (!value || typeof value !== "object") throw new Error("config must be a JSON object");
	const config = value as Partial<WorktreeLaunchConfig>;
	const metadata = config.metadata as Partial<WorktreeMetadata> | undefined;
	if (config.version !== 1) throw new Error(`unsupported config version: ${String(config.version)}`);
	if (typeof config.sessionName !== "string" || !config.sessionName) throw new Error("sessionName must be a non-empty string");
	if (config.prompt !== undefined && (typeof config.prompt !== "string" || !config.prompt)) {
		throw new Error("prompt must be a non-empty string when provided");
	}
	if (!metadata || typeof metadata !== "object") throw new Error("metadata must be an object");

	for (const key of ["repoRoot", "worktreePath", "branch", "baseRef"] as const) {
		if (typeof metadata[key] !== "string" || !metadata[key]) throw new Error(`metadata.${key} must be a non-empty string`);
	}
	if (metadata.task !== undefined && typeof metadata.task !== "string") throw new Error("metadata.task must be a string");
	if (metadata.title !== undefined && typeof metadata.title !== "string") throw new Error("metadata.title must be a string");
	if (config.sourceSession !== undefined && typeof config.sourceSession !== "string") throw new Error("sourceSession must be a string");

	return config as WorktreeLaunchConfig;
}

async function loadLaunchConfig(configPath: string): Promise<WorktreeLaunchConfig> {
	const contents = await readFile(configPath, "utf8");
	return parseLaunchConfig(JSON.parse(contents) as unknown);
}

/**
 * Pi's `--fork` loads the source session from disk and rejects empty/invalid
 * files. Brand-new sessions often have a path before the header is flushed, so
 * only return a path when the on-disk file is actually forkable.
 */
async function resolveForkableSourceSession(sessionFile: string | undefined): Promise<string | undefined> {
	if (!sessionFile || !existsSync(sessionFile)) return undefined;

	try {
		const contents = await readFile(sessionFile, "utf8");
		const firstLine = contents
			.split("\n")
			.map((line) => line.trim())
			.find(Boolean);
		if (!firstLine) return undefined;

		const header = JSON.parse(firstLine) as { type?: unknown; id?: unknown };
		if (header.type !== "session" || typeof header.id !== "string") return undefined;
		return sessionFile;
	} catch {
		return undefined;
	}
}

function piCommand(metadata: WorktreeMetadata, configPath: string, sourceSession?: string, prompt?: string): string {
	// Only pass `@config` when there is a kickoff prompt. Session naming and
	// worktree metadata still load from PI_WORKTREE_CONFIG on session_start.
	const promptArgument = prompt ? ` ${shellQuote(`@${configPath}`)}` : "";
	const forkArgument = sourceSession ? ` --fork ${shellQuote(sourceSession)}` : "";
	return `cd ${shellQuote(metadata.worktreePath)} && PI_WORKTREE_CONFIG=${shellQuote(configPath)} pi${forkArgument}${promptArgument}`;
}

function isCmuxEnvironment(): boolean {
	return Boolean(process.env.CMUX_WORKSPACE_ID || process.env.CMUX_SURFACE_ID);
}

async function currentCmuxWorkspace(): Promise<CurrentCmuxWorkspace> {
	const { stdout } = await run("cmux", ["--json", "tree"]);
	const tree = JSON.parse(stdout) as CmuxTree;
	const callerWorkspace = tree.caller?.workspace_ref;
	const workspace = tree.windows
		?.flatMap((window) => window.workspaces ?? [])
		.find((candidate) => candidate.ref === callerWorkspace)
		?? tree.windows?.[0]?.workspaces?.[0];
	const workspaceRef = callerWorkspace ?? workspace?.ref;
	let groupRef: string | undefined;
	if (workspaceRef) {
		const { stdout: groupsStdout } = await run("cmux", ["workspace-group", "list", "--json"]);
		const groupList = JSON.parse(groupsStdout) as CmuxWorkspaceGroupList;
		groupRef = groupList.groups?.find((group) => group.member_workspace_refs?.includes(workspaceRef))?.ref;
	}

	return { ref: workspaceRef, groupRef };
}

/**
 * Build the fixed worktree workspace: equal-width editor/shell and Pi columns,
 * with the editor occupying 70% of the left column.
 */
function buildLayout(metadata: WorktreeMetadata, configPath: string, sourceSession?: string, prompt?: string): CmuxLayout {
	return {
		direction: "horizontal",
		split: 0.5,
		children: [
			{
				direction: "vertical",
				split: 0.7,
				children: [
					{ pane: { surfaces: [{ type: "terminal", name: "Editor", command: "nvim ." }] } },
					{ pane: { surfaces: [{ type: "terminal", name: "Terminal" }] } },
				],
			},
			{
				pane: {
					surfaces: [{
						type: "terminal",
						name: "Pi",
						command: piCommand(metadata, configPath, sourceSession, prompt),
						focus: true,
					}],
				},
			},
		],
	};
}

async function openCmuxWorkspace(metadata: WorktreeMetadata, prompt?: string, sourceSession?: string): Promise<string> {
	const configPath = await createLaunchConfig(metadata, prompt, sourceSession);
	try {
		const currentWorkspace = await currentCmuxWorkspace();
		const layout = buildLayout(metadata, configPath, sourceSession, prompt);
		const args = [
			"new-workspace",
			"--name",
			metadata.title ?? metadata.task ?? metadata.branch,
			"--cwd",
			metadata.worktreePath,
			"--layout",
			JSON.stringify(layout),
			"--focus",
			"true",
		];

		if (currentWorkspace.groupRef && currentWorkspace.ref) {
			args.push(
				"--group",
				currentWorkspace.groupRef,
				"--group-placement",
				"afterCurrent",
				"--group-reference",
				currentWorkspace.ref,
			);
		}

		const { stdout } = await run("cmux", args);
		return stdout.trim() || `workspace for ${metadata.worktreePath}`;
	} catch (error) {
		await unlink(configPath).catch(() => undefined);
		throw error;
	}
}

function metadataFromEnv(): WorktreeMetadata | undefined {
	const repoRoot = process.env.PI_WORKTREE_REPO_ROOT;
	const worktreePath = process.env.PI_WORKTREE_PATH;
	const branch = process.env.PI_WORKTREE_BRANCH;
	const baseRef = process.env.PI_WORKTREE_BASE;
	if (!repoRoot || !worktreePath || !branch || !baseRef) return undefined;
	return { repoRoot, worktreePath, branch, baseRef, task: process.env.PI_WORKTREE_TASK || undefined };
}

function parseWorktreeList(stdout: string): WorktreeListEntry[] {
	const entries: WorktreeListEntry[] = [];
	let current: WorktreeListEntry | undefined;

	for (const line of stdout.split("\n")) {
		if (line.startsWith("worktree ")) {
			if (current) entries.push(current);
			current = { worktree: line.slice("worktree ".length) };
		} else if (current && line.startsWith("branch ")) {
			current.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
		}
	}

	if (current) entries.push(current);
	return entries;
}

async function defaultBaseRef(cwd: string, branch: string, worktrees: WorktreeListEntry[]): Promise<string> {
	const mainBranch = worktrees[0]?.branch;
	if (mainBranch && mainBranch !== branch) return mainBranch;

	try {
		return await git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], cwd);
	} catch {
		try {
			return await git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], cwd);
		} catch {
			return "HEAD";
		}
	}
}

async function detectWorktreeMetadata(ctx: ExtensionCommandContext): Promise<WorktreeMetadata> {
	const entries = ctx.sessionManager.getEntries();
	for (const entry of entries.slice().reverse()) {
		if (entry.type !== "custom" || entry.customType !== "git-worktree") continue;
		const data = entry.data as Partial<WorktreeMetadata> | undefined;
		if (data?.repoRoot && data.worktreePath && data.branch && data.baseRef) return data as WorktreeMetadata;
	}

	const worktreePath = await git(["rev-parse", "--show-toplevel"], ctx.cwd);
	const branch = await git(["branch", "--show-current"], worktreePath);
	const { stdout } = await run("git", ["worktree", "list", "--porcelain"], worktreePath);
	const worktrees = parseWorktreeList(stdout);
	const listEntry = worktrees.find((entry) => entry.worktree === worktreePath);
	const detectedBranch = listEntry?.branch ?? branch;

	return {
		repoRoot: worktrees[0]?.worktree ?? worktreePath,
		worktreePath,
		branch: detectedBranch,
		baseRef: await defaultBaseRef(worktreePath, detectedBranch, worktrees),
	};
}

async function isBranchMerged(repoRoot: string, branch: string, baseRef: string): Promise<boolean> {
	try {
		await git(["merge-base", "--is-ancestor", branch, baseRef], repoRoot);
		return true;
	} catch {
		return false;
	}
}

function parseDoneArgs(args: string): { force: boolean; keepBranch: boolean; deleteBranch: boolean } {
	const flags = new Set(args.trim().split(/\s+/).filter(Boolean));
	return {
		force: flags.has("--force") || flags.has("-f"),
		keepBranch: flags.has("--keep-branch"),
		deleteBranch: flags.has("--delete-branch"),
	};
}

async function scheduleCleanup(metadata: WorktreeMetadata, deleteBranch: boolean, force: boolean): Promise<string> {
	const scriptPath = join(tmpdir(), `pi-worktree-cleanup-${process.pid}-${Date.now()}.sh`);
	const branchDeleteFlag = force ? "-D" : "-d";
	const script = [
		"#!/usr/bin/env bash",
		"set -euo pipefail",
		`while kill -0 ${process.pid} 2>/dev/null; do sleep 0.2; done`,
		`git -C ${shellQuote(metadata.repoRoot)} worktree remove ${force ? "--force " : ""}${shellQuote(metadata.worktreePath)}`,
		deleteBranch ? `git -C ${shellQuote(metadata.repoRoot)} branch ${branchDeleteFlag} ${shellQuote(metadata.branch)}` : "true",
		`git -C ${shellQuote(metadata.repoRoot)} worktree prune`,
	].join("\n");

	await writeFile(scriptPath, `${script}\n`, { mode: 0o700 });
	await chmod(scriptPath, 0o700);

	const child = spawn("bash", [scriptPath], { detached: true, stdio: "ignore" });
	child.unref();
	return scriptPath;
}

export default function gitWorktreeExtension(pi: ExtensionAPI) {
	let launchConfigPath: string | undefined;

	pi.on("session_start", async (event, ctx) => {
		launchConfigPath = process.env.PI_WORKTREE_CONFIG;
		let metadata = metadataFromEnv();
		let kickoff: string | undefined;
		let configPath = launchConfigPath;
		let consumeConfig = false;

		if (!configPath && event.reason === "startup") {
			try {
				const candidate = await pendingLaunchConfigPath(ctx.cwd);
				if (existsSync(candidate)) {
					configPath = candidate;
					consumeConfig = true;
				}
			} catch {
				// Starting Pi outside a Git worktree is unrelated to this extension.
			}
		}

		if (configPath && existsSync(configPath)) {
			try {
				const config = await loadLaunchConfig(configPath);
				metadata = config.metadata;
				if (pi.getSessionName() !== config.sessionName) pi.setSessionName(config.sessionName);
				if (consumeConfig) {
					await unlink(configPath);
					kickoff = config.prompt;
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Could not load worktree config ${configPath}: ${message}`, "error");
			}
		}

		if (!metadata) return;
		const alreadyPersisted = ctx.sessionManager.getEntries().some((entry) => {
			if (entry.type !== "custom" || entry.customType !== "git-worktree") return false;
			const data = entry.data as Partial<WorktreeMetadata> | undefined;
			return data?.worktreePath === metadata.worktreePath && data.branch === metadata.branch;
		});

		if (!alreadyPersisted) pi.appendEntry("git-worktree", metadata);
		if (kickoff) pi.sendUserMessage(kickoff);
	});

	pi.on("session_shutdown", async () => {
		if (!launchConfigPath) return;
		await unlink(launchConfigPath).catch(() => undefined);
		launchConfigPath = undefined;
	});

	async function handler(args: string, ctx: ExtensionCommandContext) {
		const { base, noPrompt, noPr, task: explicitTask } = parseArgs(args);
		const conversation = conversationContext(ctx);
		const taskSeed = explicitTask || conversation.inferredTask;
		if (!taskSeed) {
			ctx.ui.notify("Usage: /wt [--base <ref>] [--no-prompt] [--no-pr] [task] (task may be inferred from the preceding conversation)", "error");
			return;
		}

		try {
			const repoRoot = await git(["rev-parse", "--show-toplevel"], ctx.cwd);
			const currentBranch = await git(["branch", "--show-current"], repoRoot);
			const baseRef = (base ?? currentBranch) || "HEAD";
			const identityContext = [
				conversation.transcript && `Preceding conversation:\n${conversation.transcript}`,
				explicitTask && `Explicit /wt task:\n${explicitTask}`,
			].filter(Boolean).join("\n\n") || taskSeed;
			const identity = await summarizeTaskIdentity(identityContext, taskSeed, ctx);
			const task = explicitTask || identity.title;
			const worktreePath = await uniqueWorktreePath(repoRoot, identity.slug);
			const branch = await uniqueBranchName(repoRoot, identity.slug);
			const metadata: WorktreeMetadata = {
				repoRoot,
				worktreePath,
				branch,
				baseRef,
				task,
				title: identity.title,
			};
			const inCmux = isCmuxEnvironment();
			const sourceSession = inCmux
				? await resolveForkableSourceSession(ctx.sessionManager.getSessionFile())
				: undefined;
			const prompt = noPrompt ? undefined : kickoffPrompt(task, conversation, sourceSession, !noPr);

			ctx.ui.notify(`Creating ${identity.title} (${branch}) from ${baseRef}${noPrompt ? " without kickoff prompt" : ""}...`, "info");
			await git(["worktree", "add", "-b", branch, worktreePath, baseRef], repoRoot);

			if (inCmux) {
				const workspace = await openCmuxWorkspace(metadata, prompt, sourceSession);
				ctx.ui.notify(`Opened ${workspace}: ${worktreePath}`, "info");
			} else {
				await createPendingLaunchConfig(metadata, prompt);
				ctx.ui.notify([
					`Created worktree: ${worktreePath}`,
					`Open it with: cd ${shellQuote(worktreePath)} && pi`,
					noPrompt
						? "Pi will restore the worktree metadata and open idle."
						: "Pi will restore the worktree context and start the kickoff prompt automatically.",
				].join("\n"), "info");
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			ctx.ui.notify(`Worktree failed: ${message}`, "error");
		}
	}

	async function doneHandler(args: string, ctx: ExtensionCommandContext) {
		const flags = parseDoneArgs(args);

		try {
			const metadata = await detectWorktreeMetadata(ctx);
			if (!metadata.branch) {
				ctx.ui.notify("Cannot clean up a detached worktree without a branch name.", "error");
				return;
			}
			const status = await git(["status", "--porcelain"], metadata.worktreePath);
			const dirty = status.length > 0;
			const merged = await isBranchMerged(metadata.repoRoot, metadata.branch, metadata.baseRef);
			const looksLikeTaskWorktree = metadataFromEnv()?.worktreePath === metadata.worktreePath
				|| metadata.worktreePath.includes(`${basename(metadata.repoRoot)}-worktrees`);

			if (!looksLikeTaskWorktree && !flags.force) {
				const ok = await ctx.ui.confirm(
					"This does not look like a Pi task worktree",
					`Refusing to remove ${metadata.worktreePath} unless you confirm. Continue?`,
				);
				if (!ok) return;
			}

			if (dirty && !flags.force) {
				ctx.ui.notify(`Worktree is dirty; commit/stash changes or rerun /wtdone --force.\n${status}`, "error");
				return;
			}

			let deleteBranch = flags.deleteBranch;
			if (!flags.keepBranch && !flags.deleteBranch) {
				ctx.ui.notify([
					`Path: ${metadata.worktreePath}`,
					`Branch: ${metadata.branch}`,
					`Base: ${metadata.baseRef}`,
					`Status: ${dirty ? "dirty" : "clean"}`,
					`Merged into base: ${merged ? "yes" : "no"}`,
				].join("\n"), "info");
				const choices = ["Remove worktree only", "Remove worktree and delete branch", "Cancel"];
				const choice = await ctx.ui.select("Worktree cleanup", choices);
				if (!choice || choice === "Cancel") return;
				deleteBranch = choice === "Remove worktree and delete branch";
			}

			if (deleteBranch && !merged && !flags.force) {
				const ok = await ctx.ui.confirm(
					"Branch may not be merged",
					`${metadata.branch} does not appear to be an ancestor of ${metadata.baseRef}. Delete with git branch -D after removing the worktree?`,
				);
				if (!ok) return;
				flags.force = true;
			}

			const ok = await ctx.ui.confirm(
				"Remove worktree?",
				[
					`This will remove: ${metadata.worktreePath}`,
					deleteBranch ? `This will also delete branch: ${metadata.branch}` : `Branch will be kept: ${metadata.branch}`,
					"Pi will shut down first, then cleanup will run outside the worktree.",
				].join("\n"),
			);
			if (!ok) return;

			const scriptPath = await scheduleCleanup(metadata, deleteBranch, flags.force);
			ctx.ui.notify(`Scheduled worktree cleanup via ${scriptPath}; shutting down Pi...`, "info");
			ctx.shutdown();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			ctx.ui.notify(`Worktree cleanup failed: ${message}`, "error");
		}
	}

	pi.registerCommand("wt", {
		description: "Continue a task in a conversation-aware git worktree. Opens a three-pane workspace in cmux; elsewhere, the next Pi launched in the worktree starts automatically. Use --no-pr to skip PR follow-up or --no-prompt to open idle Pi.",
		handler,
	});

	pi.registerCommand("worktree", {
		description: "Alias for /wt",
		handler,
	});

	pi.registerCommand("wtdone", {
		description: "Safely remove the current Pi task worktree after shutting down this session",
		handler: doneHandler,
	});

	pi.registerCommand("worktree-done", {
		description: "Alias for /wtdone",
		handler: doneHandler,
	});
}
