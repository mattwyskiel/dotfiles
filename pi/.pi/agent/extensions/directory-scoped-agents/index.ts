import { basename, dirname, relative, resolve } from "node:path";
import {
	isToolCallEventType,
	type ExtensionAPI,
	type ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import {
	findScopedInstructions,
	formatScopedInstructions,
	INSTRUCTION_FILE_NAMES,
	isSkillFilePath,
	readInstructionInDirectory,
	resolveTargetPath,
	type ScopedInstruction,
	type TargetKind,
} from "./scoping.js";

type ToolTarget = {
	path: string;
	kind: TargetKind;
};

const EXTENSION_HEADING = "## Directory-scoped project instructions";

/** Extract the filesystem target from Pi's built-in path-oriented tools. */
function getToolTarget(event: ToolCallEvent, cwd: string): ToolTarget | undefined {
	if (isToolCallEventType("read", event)) {
		// Skills have their own explicit loading workflow; reading one must not
		// activate unrelated directory-scoped project instructions.
		if (isSkillFilePath(event.input.path)) return undefined;
		return { path: event.input.path, kind: "file" };
	}

	if (isToolCallEventType("edit", event) || isToolCallEventType("write", event)) {
		return { path: event.input.path, kind: "file" };
	}

	if (isToolCallEventType("grep", event)) {
		return { path: event.input.path ?? cwd, kind: "auto" };
	}

	if (isToolCallEventType("find", event) || isToolCallEventType("ls", event)) {
		return { path: event.input.path ?? cwd, kind: "directory" };
	}

	return undefined;
}

/** Return whether an activated instruction is still the current file and content for its scope. */
function isCurrent(active: ScopedInstruction | undefined, current: ScopedInstruction): boolean {
	return active?.path === current.path && active.fingerprint === current.fingerprint;
}

/**
 * Load nested AGENTS.md/CLAUDE.md files when Pi first crosses into their directory scopes.
 *
 * Pi's native loader handles the session root and its ancestors. This extension gates the
 * first built-in path operation under each nested scope, returns the applicable instructions
 * as the blocked tool result, and permits the retry after the model has seen those instructions.
 */
export default function directoryScopedAgents(pi: ExtensionAPI): void {
	let root = process.cwd();
	const activeByScope = new Map<string, ScopedInstruction>();
	const pendingByScope = new Map<string, ScopedInstruction>();

	const reset = (cwd: string): void => {
		root = resolve(cwd);
		activeByScope.clear();
		pendingByScope.clear();
	};

	const activatePending = (): void => {
		for (const [scope, instruction] of pendingByScope) {
			activeByScope.set(scope, instruction);
		}
		pendingByScope.clear();
	};

	const refreshActive = (): void => {
		for (const [scope, active] of activeByScope) {
			const current = readInstructionInDirectory(scope);
			if (!current || !isCurrent(active, current)) {
				activeByScope.delete(scope);
			}
		}
	};

	pi.on("session_start", (_event, ctx) => {
		reset(ctx.cwd);
	});

	pi.on("before_agent_start", (event, ctx) => {
		if (resolve(ctx.cwd) !== root) reset(ctx.cwd);
		refreshActive();

		const active = [...activeByScope.values()].sort((left, right) =>
			left.scope.localeCompare(right.scope),
		);
		const activeContext = active.length > 0
			? `\n\nCurrently activated nested instructions:\n\n${formatScopedInstructions(root, root, active)}`
			: "";

		return {
			systemPrompt: `${event.systemPrompt}\n\n${EXTENSION_HEADING}

Nested AGENTS.md (or CLAUDE.md) files below the current working directory are directory-scoped. Before a built-in read, edit, write, ls, find, or grep crosses into a nested scope, this extension pauses that operation once and returns the applicable instructions. Read those instructions, apply them only within their declared scopes, then retry the operation. More deeply nested instructions are more specific when scoped instructions conflict.

Prefer Pi's built-in path tools for filesystem access so this check can run. Bash commands and custom tools cannot be scoped reliably; before using them on a nested path, first access that path with a built-in path tool so its instructions are activated.${activeContext}`,
		};
	});

	pi.on("tool_call", (event, ctx) => {
		const target = getToolTarget(event, ctx.cwd);
		if (!target) return undefined;

		if (resolve(ctx.cwd) !== root) reset(ctx.cwd);
		refreshActive();

		const instructions = findScopedInstructions(root, target.path, target.kind);
		const missing = instructions.filter((instruction) =>
			!isCurrent(activeByScope.get(instruction.scope), instruction),
		);

		if (missing.length > 0) {
			for (const instruction of missing) {
				pendingByScope.set(instruction.scope, instruction);
			}

			const absoluteTarget = resolveTargetPath(root, target.path);
			return {
				block: true,
				reason: [
					"This operation was paused before filesystem access so nested project instructions could be loaded.",
					formatScopedInstructions(root, absoluteTarget, missing),
					`Apply these instructions and retry the same ${event.toolName} operation.`,
				].join("\n\n"),
			};
		}

		// If this operation changes an instruction file, force later sibling calls and turns
		// to reload that scope instead of continuing with stale content.
		if (
			(isToolCallEventType("edit", event) || isToolCallEventType("write", event)) &&
			INSTRUCTION_FILE_NAMES.includes(basename(resolveTargetPath(root, event.input.path)) as (typeof INSTRUCTION_FILE_NAMES)[number])
		) {
			activeByScope.delete(dirname(resolveTargetPath(root, event.input.path)));
		}

		return undefined;
	});

	// Parallel tool calls are all preflighted before turn_end. Activating here ensures every
	// sibling call made without seeing the new instructions is paused, while retries can proceed.
	pi.on("turn_end", () => {
		activatePending();
	});

	// Defensive fallback for aborted or provider-specific flows that end without a normal turn_end.
	pi.on("agent_end", () => {
		activatePending();
	});

	pi.registerCommand("scoped-agents", {
		description: "Show directory-scoped instruction files applicable to a path",
		handler: async (args, ctx) => {
			const target = args.trim() || ".";
			const instructions = findScopedInstructions(ctx.cwd, target, "auto");
			if (instructions.length === 0) {
				ctx.ui.notify(`No nested instruction files apply to ${target}`, "info");
				return;
			}

			const lines = instructions.map((instruction) => {
				const path = relative(ctx.cwd, instruction.path) || basename(instruction.path);
				const status = isCurrent(activeByScope.get(instruction.scope), instruction) ? "active" : "not active";
				return `${path} (${status})`;
			});
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
