import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	type AcceptanceCriterion,
	AcceptanceVerifier,
	summarize,
	type VerificationContext,
} from "@amaze/coding-agent/mission/core/verifier";

async function withTempDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "amaze-verifier-"));
	try {
		return await run(dir);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
}

const verifier = new AcceptanceVerifier();

describe("AcceptanceVerifier — Phase 0 synthetic cases", () => {
	it("scope-include: passes when every changed file matches an include glob", async () => {
		const ctx: VerificationContext = {
			cwd: "/tmp",
			changedFiles: ["packages/coding-agent/src/x.ts", "packages/coding-agent/src/y.ts"],
		};
		const criterion: AcceptanceCriterion = {
			id: "C1",
			description: "edits stay inside coding-agent",
			check: { type: "scope-include", globs: ["packages/coding-agent/**"] },
		};

		const [result] = await verifier.verify([criterion], ctx);
		expect(result.status).toBe("pass");
		expect(result.confidence).toBe(1.0);
	});

	it("scope-include: fails when any changed file lands outside include globs", async () => {
		const ctx: VerificationContext = {
			cwd: "/tmp",
			changedFiles: ["packages/coding-agent/src/x.ts", "packages/ai/src/leak.ts"],
		};
		const criterion: AcceptanceCriterion = {
			id: "C2",
			description: "edits stay inside coding-agent",
			check: { type: "scope-include", globs: ["packages/coding-agent/**"] },
		};

		const [result] = await verifier.verify([criterion], ctx);
		expect(result.status).toBe("fail");
		expect(result.evidence).toContain("packages/ai/src/leak.ts");
	});

	it("scope-include: returns uncertain when no files changed (cannot verify positively)", async () => {
		const ctx: VerificationContext = { cwd: "/tmp", changedFiles: [] };
		const criterion: AcceptanceCriterion = {
			id: "C3",
			description: "scope guarded with no edits",
			check: { type: "scope-include", globs: ["src/**"] },
		};
		const [result] = await verifier.verify([criterion], ctx);
		expect(result.status).toBe("uncertain");
	});

	it("scope-exclude: passes when no changed file hits an exclude glob", async () => {
		const ctx: VerificationContext = {
			cwd: "/tmp",
			changedFiles: ["packages/coding-agent/src/x.ts"],
		};
		const criterion: AcceptanceCriterion = {
			id: "C4",
			description: "never touch CHANGELOG",
			check: { type: "scope-exclude", globs: ["**/CHANGELOG.md"] },
		};
		const [result] = await verifier.verify([criterion], ctx);
		expect(result.status).toBe("pass");
	});

	it("scope-exclude: fails when any changed file matches an exclude glob", async () => {
		const ctx: VerificationContext = {
			cwd: "/tmp",
			changedFiles: ["packages/coding-agent/src/x.ts", "packages/coding-agent/CHANGELOG.md"],
		};
		const criterion: AcceptanceCriterion = {
			id: "C5",
			description: "never touch CHANGELOG",
			check: { type: "scope-exclude", globs: ["**/CHANGELOG.md"] },
		};
		const [result] = await verifier.verify([criterion], ctx);
		expect(result.status).toBe("fail");
		expect(result.evidence).toContain("CHANGELOG.md");
	});

	it("file-exists: passes when the named file is present", async () => {
		await withTempDir(async dir => {
			await fs.writeFile(path.join(dir, "ARTIFACT.md"), "ok");
			const [result] = await verifier.verify(
				[
					{
						id: "C6",
						description: "produces ARTIFACT.md",
						check: { type: "file-exists", path: "ARTIFACT.md" },
					},
				],
				{ cwd: dir, changedFiles: [] },
			);
			expect(result.status).toBe("pass");
			expect(result.evidence).toContain("ARTIFACT.md");
		});
	});

	it("file-exists: fails when the named file is missing", async () => {
		await withTempDir(async dir => {
			const [result] = await verifier.verify(
				[
					{
						id: "C7",
						description: "produces missing.md",
						check: { type: "file-exists", path: "missing.md" },
					},
				],
				{ cwd: dir, changedFiles: [] },
			);
			expect(result.status).toBe("fail");
		});
	});

	it("command-exit: passes when the shell command returns the expected code", async () => {
		await withTempDir(async dir => {
			const [result] = await verifier.verify(
				[
					{
						id: "C8",
						description: "noop succeeds",
						check: { type: "command-exit", argv: ["/bin/sh", "-c", "true"], expected: 0 },
					},
				],
				{ cwd: dir, changedFiles: [] },
			);
			expect(result.status).toBe("pass");
		});
	});

	it("command-exit: fails when the shell command exits with the wrong code", async () => {
		await withTempDir(async dir => {
			const [result] = await verifier.verify(
				[
					{
						id: "C9",
						description: "false should be 0",
						check: { type: "command-exit", argv: ["/bin/sh", "-c", "false"], expected: 0 },
					},
				],
				{ cwd: dir, changedFiles: [] },
			);
			expect(result.status).toBe("fail");
			expect(result.evidence).toContain("Exit code 1");
		});
	});

	it("manual: always returns uncertain so closing audit surfaces it without blocking", async () => {
		const [result] = await verifier.verify(
			[
				{
					id: "C10",
					description: "user must confirm UX feel",
					check: { type: "manual", description: "Operator visual review" },
				},
			],
			{ cwd: "/tmp", changedFiles: [] },
		);
		expect(result.status).toBe("uncertain");
		expect(result.confidence).toBe(0.0);
	});

	it("summarize: verdict=fail when any criterion fails, uncertain alone does not block", async () => {
		const ctx: VerificationContext = { cwd: "/tmp", changedFiles: ["src/x.ts"] };
		const criteria: AcceptanceCriterion[] = [
			{ id: "A", description: "in scope", check: { type: "scope-include", globs: ["src/**"] } },
			{ id: "B", description: "manual review", check: { type: "manual", description: "look at it" } },
		];
		const verdict = summarize(await verifier.verify(criteria, ctx));
		expect(verdict.verdict).toBe("pass");
		expect(verdict.uncertainCount).toBe(1);
		expect(verdict.passedCount).toBe(1);

		const failingCriteria: AcceptanceCriterion[] = [
			{ id: "A", description: "in scope", check: { type: "scope-include", globs: ["other/**"] } },
			{ id: "B", description: "manual review", check: { type: "manual", description: "look at it" } },
		];
		const failingVerdict = summarize(await verifier.verify(failingCriteria, ctx));
		expect(failingVerdict.verdict).toBe("fail");
		expect(failingVerdict.failedCount).toBe(1);
	});

	it("deterministic backends produce byte-identical evidence for the same input (cache-friendly)", async () => {
		const criterion: AcceptanceCriterion = {
			id: "DET",
			description: "stable",
			check: { type: "scope-include", globs: ["src/**"] },
		};
		const ctx: VerificationContext = { cwd: "/tmp", changedFiles: ["src/x.ts", "src/y.ts"] };
		const first = await verifier.verify([criterion], ctx);
		const second = await verifier.verify([criterion], ctx);
		expect(first).toEqual(second);
	});
});
