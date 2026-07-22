import { complete } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

type ExecResult = { stdout: string; stderr: string };

type CmuxTree = {
	caller?: { workspace_ref?: string; pane_ref?: string };
	windows?: Array<{
		workspaces?: Array<{
			ref: string;
			panes?: Array<{
				ref: string;
				focused?: boolean;
				surfaces?: Array<{ type?: string; url?: string | null }>;
			}>;
		}>;
	}>;
};

type CmuxLayout =
	| { pane: { surfaces: Array<{ type: "terminal" | "browser"; command?: string; url?: string }> } }
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
	panes: Array<{ focused: boolean; surfaces: Array<{ type?: string; url?: string | null }> }>;
};

type WorktreeMetadata = {
	repoRoot: string;
	worktreePath: string;
	branch: string;
	baseRef: string;
	task?: string;
};

/**
 * One-file handoff from the creating Pi process to the Pi process launched in
 * the worktree. The file is also passed as Pi's sole positional CLI argument,
 * so its prompt starts the task without shell-quoting the task or metadata.
 */
type WorktreeLaunchConfig = {
	version: 1;
	sessionName: string;
	prompt: string;
	metadata: WorktreeMetadata;
};

type WorktreeListEntry = {
	worktree: string;
	branch?: string;
};

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
		"a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "into", "is", "it", "make", "of", "on", "or", "the", "this", "to", "up", "use", "with",
	]);
	const words = task
		.toLowerCase()
		.replace(/['"]/g, "")
		.split(/[^a-z0-9]+/)
		.filter((word) => word.length > 1 && !stopWords.has(word));

	return slugify(words.slice(0, 4).join("-"));
}

async function summarizeTaskSlug(task: string, ctx: ExtensionCommandContext): Promise<string> {
	if (!ctx.model) return summarizeTaskSlugFallback(task);

	try {
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
		if (!auth.ok || !auth.apiKey) return summarizeTaskSlugFallback(task);

		const response = await complete(
			ctx.model,
			{
				messages: [{
					role: "user" as const,
					content: [{ type: "text" as const, text: [
						"Create a short git branch/worktree slug summarizing this task.",
						"Rules: 2-4 words, lowercase kebab-case, <= 32 chars, no punctuation except hyphens, no quotes, do not copy the prompt verbatim.",
						"Return only the slug.",
						"",
						`Task: ${task}`,
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
		return slugify(text) || summarizeTaskSlugFallback(task);
	} catch {
		return summarizeTaskSlugFallback(task);
	}
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

function parseArgs(args: string): { base?: string; task: string } {
	const trimmed = args.trim();
	const baseMatch = trimmed.match(/^--base\s+(\S+)\s+(.+)$/s);
	if (baseMatch) {
		return { base: baseMatch[1], task: baseMatch[2].trim().replace(/^['"]|['"]$/g, "") };
	}
	return { task: trimmed.replace(/^['"]|['"]$/g, "") };
}

async function createLaunchConfig(metadata: WorktreeMetadata): Promise<string> {
	const configPath = join(tmpdir(), `pi-worktree-${process.pid}-${Date.now()}.json`);
	const task = metadata.task ?? metadata.branch;
	const config: WorktreeLaunchConfig = {
		version: 1,
		sessionName: task,
		prompt: task,
		metadata,
	};

	await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
	return configPath;
}

function parseLaunchConfig(value: unknown): WorktreeLaunchConfig {
	if (!value || typeof value !== "object") throw new Error("config must be a JSON object");
	const config = value as Partial<WorktreeLaunchConfig>;
	const metadata = config.metadata as Partial<WorktreeMetadata> | undefined;
	if (config.version !== 1) throw new Error(`unsupported config version: ${String(config.version)}`);
	if (typeof config.sessionName !== "string" || !config.sessionName) throw new Error("sessionName must be a non-empty string");
	if (typeof config.prompt !== "string" || !config.prompt) throw new Error("prompt must be a non-empty string");
	if (!metadata || typeof metadata !== "object") throw new Error("metadata must be an object");

	for (const key of ["repoRoot", "worktreePath", "branch", "baseRef"] as const) {
		if (typeof metadata[key] !== "string" || !metadata[key]) throw new Error(`metadata.${key} must be a non-empty string`);
	}
	if (metadata.task !== undefined && typeof metadata.task !== "string") throw new Error("metadata.task must be a string");

	return config as WorktreeLaunchConfig;
}

async function loadLaunchConfig(configPath: string): Promise<WorktreeLaunchConfig> {
	const contents = await readFile(configPath, "utf8");
	return parseLaunchConfig(JSON.parse(contents) as unknown);
}

function piCommand(metadata: WorktreeMetadata, configPath: string): string {
	const configArgument = `@${configPath}`;
	return `cd ${shellQuote(metadata.worktreePath)} && PI_WORKTREE_CONFIG=${shellQuote(configPath)} pi ${shellQuote(configArgument)}`;
}

function shellCommand(worktreePath: string): string {
	return `cd ${shellQuote(worktreePath)}`;
}

async function currentCmuxWorkspace(): Promise<CurrentCmuxWorkspace> {
	const { stdout } = await run("cmux", ["--json", "tree"]);
	const tree = JSON.parse(stdout) as CmuxTree;
	const callerWorkspace = tree.caller?.workspace_ref;
	const workspace = tree.windows
		?.flatMap((window) => window.workspaces ?? [])
		.find((candidate) => candidate.ref === callerWorkspace)
		?? tree.windows?.[0]?.workspaces?.[0];
	const panes = workspace?.panes ?? [];

	let groupRef: string | undefined;
	if (callerWorkspace) {
		const { stdout: groupsStdout } = await run("cmux", ["workspace-group", "list", "--json"]);
		const groupList = JSON.parse(groupsStdout) as CmuxWorkspaceGroupList;
		groupRef = groupList.groups?.find((group) => group.member_workspace_refs?.includes(callerWorkspace))?.ref;
	}

	return {
		ref: callerWorkspace,
		groupRef,
		panes: panes.length > 0
			? panes.map((pane) => ({ focused: pane.focused === true, surfaces: pane.surfaces ?? [] }))
			: [{ focused: true, surfaces: [] }],
	};
}

function buildLayout(
	panes: Array<{ focused: boolean; surfaces: Array<{ type?: string; url?: string | null }> }>,
	metadata: WorktreeMetadata,
	configPath: string,
): CmuxLayout {
	const focusedPaneIndex = Math.max(0, panes.findIndex((pane) => pane.focused));
	const leaves = panes.map((pane, paneIndex): CmuxLayout => {
		const sourceSurfaces = pane.surfaces.length > 0 ? pane.surfaces : [{ type: "terminal" }];
		return {
			pane: {
				surfaces: sourceSurfaces.map((surface, surfaceIndex) => {
					if (surface.type === "browser") return { type: "browser", url: surface.url ?? "about:blank" };
					return {
						type: "terminal",
						command: paneIndex === focusedPaneIndex && surfaceIndex === 0 ? piCommand(metadata, configPath) : shellCommand(metadata.worktreePath),
					};
				}),
			},
		};
	});

	const combine = (items: CmuxLayout[], depth = 0): CmuxLayout => {
		if (items.length === 1) return items[0];
		const midpoint = Math.ceil(items.length / 2);
		return {
			direction: depth % 2 === 0 ? "horizontal" : "vertical",
			split: 0.5,
			children: [combine(items.slice(0, midpoint), depth + 1), combine(items.slice(midpoint), depth + 1)],
		};
	};

	return combine(leaves);
}

async function openCmuxWorkspace(metadata: WorktreeMetadata): Promise<string> {
	const configPath = await createLaunchConfig(metadata);
	try {
		const currentWorkspace = await currentCmuxWorkspace();
		const layout = buildLayout(currentWorkspace.panes, metadata, configPath);
		const args = [
			"new-workspace",
			"--name",
			metadata.branch,
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

	pi.on("session_start", async (_event, ctx) => {
		launchConfigPath = process.env.PI_WORKTREE_CONFIG;
		let metadata = metadataFromEnv();

		if (launchConfigPath && existsSync(launchConfigPath)) {
			try {
				const config = await loadLaunchConfig(launchConfigPath);
				metadata = config.metadata;
				if (pi.getSessionName() !== config.sessionName) pi.setSessionName(config.sessionName);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Could not load worktree config ${launchConfigPath}: ${message}`, "error");
			}
		}

		if (!metadata) return;
		const alreadyPersisted = ctx.sessionManager.getEntries().some((entry) => {
			if (entry.type !== "custom" || entry.customType !== "git-worktree") return false;
			const data = entry.data as Partial<WorktreeMetadata> | undefined;
			return data?.worktreePath === metadata.worktreePath && data.branch === metadata.branch;
		});

		if (!alreadyPersisted) pi.appendEntry("git-worktree", metadata);
	});

	pi.on("session_shutdown", async () => {
		if (!launchConfigPath) return;
		await unlink(launchConfigPath).catch(() => undefined);
		launchConfigPath = undefined;
	});

	async function handler(args: string, ctx: ExtensionCommandContext) {
		const { base, task } = parseArgs(args);
		if (!task) {
			ctx.ui.notify("Usage: /wt [--base <ref>] <task>", "error");
			return;
		}

		try {
			const repoRoot = await git(["rev-parse", "--show-toplevel"], ctx.cwd);
			const currentBranch = await git(["branch", "--show-current"], repoRoot);
			const baseRef = (base ?? currentBranch) || "HEAD";
			const slug = await summarizeTaskSlug(task, ctx);
			const worktreePath = await uniqueWorktreePath(repoRoot, slug);
			const branch = await uniqueBranchName(repoRoot, slug);
			const metadata: WorktreeMetadata = { repoRoot, worktreePath, branch, baseRef, task };

			ctx.ui.notify(`Creating worktree ${branch} from ${baseRef}...`, "info");
			await git(["worktree", "add", "-b", branch, worktreePath, baseRef], repoRoot);

			const workspace = await openCmuxWorkspace(metadata);
			ctx.ui.notify(`Opened ${workspace}: ${worktreePath}`, "info");
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
		description: "Create a git worktree and open a branch-named cmux workspace beside the current grouped workspace",
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
