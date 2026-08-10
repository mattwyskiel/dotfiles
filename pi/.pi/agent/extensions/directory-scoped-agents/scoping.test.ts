import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	EXCLUDED_DIRECTORY_NAMES,
	findScopedInstructions,
	formatScopedInstructions,
	isSkillFilePath,
	isWithinRoot,
	resolveTargetPath,
} from "./scoping.js";

const fixtures: string[] = [];

function fixture(): string {
	const root = mkdtempSync(join(tmpdir(), "pi-scoped-agents-"));
	fixtures.push(root);
	return root;
}

afterEach(() => {
	for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("findScopedInstructions", () => {
	test("loads nested files broadest-first and omits the root file", () => {
		const root = fixture();
		mkdirSync(join(root, "packages", "web", "src"), { recursive: true });
		writeFileSync(join(root, "AGENTS.md"), "root");
		writeFileSync(join(root, "packages", "AGENTS.md"), "packages");
		writeFileSync(join(root, "packages", "web", "AGENTS.md"), "web");

		const instructions = findScopedInstructions(root, "packages/web/src/app.ts", "file");

		expect(instructions.map((instruction) => instruction.content)).toEqual(["packages", "web"]);
	});

	test("uses Pi's filename precedence within one directory", () => {
		const root = fixture();
		mkdirSync(join(root, "src"));
		writeFileSync(join(root, "src", "CLAUDE.md"), "claude");
		writeFileSync(join(root, "src", "AGENTS.md"), "agents");

		const instructions = findScopedInstructions(root, "src/index.ts", "file");

		expect(instructions).toHaveLength(1);
		expect(instructions[0]?.content).toBe("agents");
	});

	test("treats a missing file target as belonging to its parent directory", () => {
		const root = fixture();
		mkdirSync(join(root, "src"));
		writeFileSync(join(root, "src", "AGENTS.md"), "source rules");

		const instructions = findScopedInstructions(root, "src/new-file.ts");

		expect(instructions[0]?.content).toBe("source rules");
	});

	test("does not load instructions for paths outside the session root", () => {
		const root = fixture();
		const outside = fixture();
		writeFileSync(join(outside, "AGENTS.md"), "outside");

		expect(findScopedInstructions(root, outside, "directory")).toEqual([]);
		expect(isWithinRoot(root, outside)).toBe(false);
	});

	test("excludes dependency, generated-output, cache, and VCS subtrees", () => {
		const root = fixture();
		for (const directory of EXCLUDED_DIRECTORY_NAMES) {
			const subtree = join(root, "packages", directory, "dependency");
			mkdirSync(subtree, { recursive: true });
			writeFileSync(join(subtree, "AGENTS.md"), `${directory} rules`);
		}
		writeFileSync(join(root, "packages", "AGENTS.md"), "package rules");

		for (const directory of EXCLUDED_DIRECTORY_NAMES) {
			expect(
				findScopedInstructions(root, `packages/${directory}/dependency/index.ts`, "file"),
			).toEqual([]);
		}
	});

	test("matches excluded directory names by complete path segment", () => {
		const root = fixture();
		mkdirSync(join(root, "node_modules-source"), { recursive: true });
		writeFileSync(join(root, "node_modules-source", "AGENTS.md"), "source rules");

		const instructions = findScopedInstructions(root, "node_modules-source/index.ts", "file");

		expect(instructions.map((instruction) => instruction.content)).toEqual(["source rules"]);
	});
});

describe("isSkillFilePath", () => {
	test("recognizes only SKILL.md definitions, including Pi's @ path prefix", () => {
		expect(isSkillFilePath("skills/example/SKILL.md")).toBe(true);
		expect(isSkillFilePath("@skills/example/SKILL.md")).toBe(true);
		expect(isSkillFilePath("skills/example/skill.md")).toBe(false);
		expect(isSkillFilePath("skills/example/README.md")).toBe(false);
	});
});

describe("formatScopedInstructions", () => {
	test("labels paths relative to the session root", () => {
		const root = fixture();
		mkdirSync(join(root, "src"));
		writeFileSync(join(root, "src", "AGENTS.md"), "Use strict mode.");
		const instructions = findScopedInstructions(root, "src/index.ts", "file");

		const formatted = formatScopedInstructions(root, resolveTargetPath(root, "src/index.ts"), instructions);

		expect(formatted).toContain('target="src/index.ts"');
		expect(formatted).toContain('scope="src" path="src/AGENTS.md"');
		expect(formatted).toContain("Use strict mode.");
	});
});
