import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

/** File names recognized by Pi as project instruction files, in precedence order. */
export const INSTRUCTION_FILE_NAMES = ["AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"] as const;

/** How to interpret a target path that does not exist yet. */
export type TargetKind = "auto" | "file" | "directory";

/** A project instruction file and the directory tree to which it applies. */
export interface ScopedInstruction {
	/** Absolute path to the instruction file. */
	path: string;
	/** Absolute directory governed by the instruction file. */
	scope: string;
	/** UTF-8 file contents. */
	content: string;
	/** Content fingerprint used to detect changes during a session. */
	fingerprint: string;
}

/** Remove Pi's optional @ file-reference prefix and resolve a path from the session root. */
export function resolveTargetPath(root: string, inputPath: string): string {
	const normalized = inputPath.startsWith("@") ? inputPath.slice(1) : inputPath;
	return resolve(root, normalized || ".");
}

/** Return whether a path names a skill definition, which Pi loads under separate skill rules. */
export function isSkillFilePath(inputPath: string): boolean {
	const normalized = inputPath.startsWith("@") ? inputPath.slice(1) : inputPath;
	return basename(normalized) === "SKILL.md";
}

/** Return whether target is root itself or a lexical descendant of root. */
export function isWithinRoot(root: string, target: string): boolean {
	const relation = relative(resolve(root), resolve(target));
	return relation === "" || (!isAbsolute(relation) && relation !== ".." && !relation.startsWith(`..${sep}`));
}

/** Read the highest-precedence instruction file in one directory. */
export function readInstructionInDirectory(directory: string): ScopedInstruction | undefined {
	for (const fileName of INSTRUCTION_FILE_NAMES) {
		const filePath = resolve(directory, fileName);
		if (!existsSync(filePath)) continue;

		try {
			if (!statSync(filePath).isFile()) continue;
			const content = readFileSync(filePath, "utf8");
			return {
				path: filePath,
				scope: resolve(directory),
				content,
				fingerprint: createHash("sha256").update(content).digest("hex"),
			};
		} catch {
			// Match Pi's context loader: try the next supported name when a file cannot be read.
		}
	}

	return undefined;
}

/**
 * Find nested instructions applicable to a target, ordered from broadest to most specific.
 *
 * The session root is intentionally excluded because Pi's native context loader already
 * loads instructions from the root and its ancestors.
 */
export function findScopedInstructions(
	root: string,
	inputPath: string,
	kind: TargetKind = "auto",
): ScopedInstruction[] {
	const resolvedRoot = resolve(root);
	const target = resolveTargetPath(resolvedRoot, inputPath);
	if (!isWithinRoot(resolvedRoot, target)) return [];

	let targetDirectory: string;
	if (kind === "directory") {
		targetDirectory = target;
	} else if (kind === "file") {
		targetDirectory = dirname(target);
	} else {
		try {
			targetDirectory = statSync(target).isDirectory() ? target : dirname(target);
		} catch {
			// A missing auto target is most commonly a file that is about to be created.
			targetDirectory = dirname(target);
		}
	}

	if (!isWithinRoot(resolvedRoot, targetDirectory)) return [];

	const directories: string[] = [];
	let current = resolve(targetDirectory);
	while (current !== resolvedRoot) {
		if (!isWithinRoot(resolvedRoot, current)) return [];
		directories.unshift(current);
		const parent = dirname(current);
		if (parent === current) return [];
		current = parent;
	}

	return directories.flatMap((directory) => {
		const instruction = readInstructionInDirectory(directory);
		return instruction ? [instruction] : [];
	});
}

/** Render instructions with explicit scopes so unrelated rules do not leak across directories. */
export function formatScopedInstructions(root: string, target: string, instructions: ScopedInstruction[]): string {
	const escapeAttribute = (value: string): string =>
		value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
	const displayPath = (value: string): string => relative(root, value).replaceAll(sep, "/") || ".";

	const sections = instructions.map(
		(instruction) =>
			`<directory_instruction scope="${escapeAttribute(displayPath(instruction.scope))}" path="${escapeAttribute(displayPath(instruction.path))}">\n${instruction.content}\n</directory_instruction>`,
	);

	return [
		`<directory_scoped_instructions target="${escapeAttribute(displayPath(target))}">`,
		"Apply each instruction only to files within its scope. When instructions conflict, the more deeply nested scope is more specific.",
		...sections,
		"</directory_scoped_instructions>",
	].join("\n\n");
}
