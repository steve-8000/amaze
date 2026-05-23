/**
 * V3 Phase 4 — verifier extension proofs.
 *
 * Exercises the four new pieces shipped in Phase 4:
 *
 *   - `command-output` backend: exit code + stdout/stderr regex matching
 *   - `lsp-clean` backend: integrates with a diagnostics provider
 *   - `VerifierResultCache`: input-hash + mtime invalidation
 *   - `llm-judged` backend: pluggable runner interface (NULL + deterministic test impl)
 *
 * Acceptance criteria from the Mythos plan, encoded as test assertions:
 *   - Tool-driven backends pass/fail deterministically (no flake).
 *   - LLM-judged returns `uncertain` when no runner is configured — no silent assumption.
 *   - Cache hit + miss are both directly observable; mtime change invalidates.
 */

import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	type AcceptanceCriterion,
	AcceptanceVerifier,
	type LlmJudgeRunner,
	type LspDiagnostic,
	VerifierResultCache,
} from "@amaze/coding-agent/goals/verifier";

async function withTempDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verifier-phase4-"));
	try {
		return await run(dir);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
}

describe("V3 Phase 4 — command-output backend", () => {
	const verifier = new AcceptanceVerifier();

	it("passes when exit code + all patterns satisfied", async () => {
		await withTempDir(async dir => {
			const criterion: AcceptanceCriterion = {
				id: "tests-pass",
				description: "test suite all green",
				check: {
					type: "command-output",
					argv: ["/bin/echo", "5 passing, 0 failing"],
					expected: 0,
					stdoutPattern: "\\d+ passing, 0 failing",
				},
			};
			const [result] = await verifier.verify([criterion], { cwd: dir, changedFiles: [] });
			expect(result.status).toBe("pass");
		});
	});

	it("fails when expected pattern is missing from stdout", async () => {
		await withTempDir(async dir => {
			const criterion: AcceptanceCriterion = {
				id: "tests-pass",
				description: "test suite all green",
				check: {
					type: "command-output",
					argv: ["/bin/echo", "3 passing, 2 failing"],
					stdoutPattern: "\\d+ passing, 0 failing",
				},
			};
			const [result] = await verifier.verify([criterion], { cwd: dir, changedFiles: [] });
			expect(result.status).toBe("fail");
			expect(result.evidence).toContain("did NOT match");
		});
	});

	it("fails when mustNotMatch pattern appears in output (e.g. WARNING)", async () => {
		await withTempDir(async dir => {
			const criterion: AcceptanceCriterion = {
				id: "no-warnings",
				description: "no lint warnings",
				check: {
					type: "command-output",
					argv: ["/bin/echo", "WARNING: unused import"],
					mustNotMatch: ["WARNING"],
				},
			};
			const [result] = await verifier.verify([criterion], { cwd: dir, changedFiles: [] });
			expect(result.status).toBe("fail");
			expect(result.evidence).toContain("forbidden pattern");
		});
	});

	it("fails when exit code differs even if patterns would match", async () => {
		// Exit code is checked first — a process that exited nonzero is suspect regardless of what it printed.
		await withTempDir(async dir => {
			const criterion: AcceptanceCriterion = {
				id: "build",
				description: "build succeeded",
				check: {
					type: "command-output",
					argv: ["/bin/sh", "-c", "echo 'fine'; exit 7"],
					expected: 0,
					stdoutPattern: "fine",
				},
			};
			const [result] = await verifier.verify([criterion], { cwd: dir, changedFiles: [] });
			expect(result.status).toBe("fail");
			expect(result.evidence).toContain("Exit code 7");
		});
	});
});

describe("V3 Phase 4 — lsp-clean backend", () => {
	const verifier = new AcceptanceVerifier();

	it("returns uncertain when no provider configured (no silent assumption)", async () => {
		const criterion: AcceptanceCriterion = {
			id: "lsp",
			description: "no LSP errors",
			check: { type: "lsp-clean", file: "src/x.ts" },
		};
		const [result] = await verifier.verify([criterion], { cwd: "/tmp", changedFiles: [] });
		expect(result.status).toBe("uncertain");
		expect(result.evidence).toContain("No LSP diagnostics provider");
	});

	it("passes when provider returns no errors", async () => {
		const lspDiagnostics = async (_file: string | undefined): Promise<LspDiagnostic[]> => [];
		const criterion: AcceptanceCriterion = {
			id: "lsp",
			description: "no LSP errors",
			check: { type: "lsp-clean" },
		};
		const [result] = await verifier.verify([criterion], { cwd: "/tmp", changedFiles: [], lspDiagnostics });
		expect(result.status).toBe("pass");
	});

	it("fails when provider returns errors, with first 3 surfaced", async () => {
		const lspDiagnostics = async (_file: string | undefined): Promise<LspDiagnostic[]> => [
			{ file: "a.ts", severity: "error", message: "missing semicolon", line: 4 },
			{ file: "b.ts", severity: "error", message: "unknown identifier", line: 10 },
			{ file: "c.ts", severity: "warning", message: "unused var" },
		];
		const criterion: AcceptanceCriterion = {
			id: "lsp",
			description: "no LSP errors",
			check: { type: "lsp-clean" },
		};
		const [result] = await verifier.verify([criterion], { cwd: "/tmp", changedFiles: [], lspDiagnostics });
		expect(result.status).toBe("fail");
		expect(result.evidence).toContain("2 LSP error(s)");
		expect(result.evidence).toContain("missing semicolon");
	});

	it("fails when warnings exceed maxWarnings cap", async () => {
		const lspDiagnostics = async (): Promise<LspDiagnostic[]> => [
			{ file: "a.ts", severity: "warning", message: "w1" },
			{ file: "a.ts", severity: "warning", message: "w2" },
			{ file: "a.ts", severity: "warning", message: "w3" },
		];
		const criterion: AcceptanceCriterion = {
			id: "lsp",
			description: "≤1 warning",
			check: { type: "lsp-clean", maxWarnings: 1 },
		};
		const [result] = await verifier.verify([criterion], { cwd: "/tmp", changedFiles: [], lspDiagnostics });
		expect(result.status).toBe("fail");
		expect(result.evidence).toContain("3 warnings exceed");
	});
});

describe("V3 Phase 4 — llm-judged backend", () => {
	const verifier = new AcceptanceVerifier();

	it("returns uncertain (NULL behavior) when no runner is configured — never silently passes", async () => {
		const criterion: AcceptanceCriterion = {
			id: "ux-feel",
			description: "judge whether the diff matches the UX intent",
			check: { type: "llm-judged", question: "Does this diff improve focus?", candidate: "<diff>" },
		};
		const [result] = await verifier.verify([criterion], { cwd: "/tmp", changedFiles: [] });
		expect(result.status).toBe("uncertain");
		expect(result.evidence).toContain("No LLM judge runner");
	});

	it("delegates to runner and surfaces verdict + tokens used", async () => {
		// Deterministic test runner — proves the seam works without any real LLM call.
		const testRunner: LlmJudgeRunner = {
			judge: async ({ question }) => ({
				status: question.includes("focus") ? "pass" : "fail",
				evidence: "deterministic test verdict",
				confidence: 0.9,
				tokensUsed: 142,
			}),
		};
		const criterion: AcceptanceCriterion = {
			id: "ux-feel",
			description: "judge focus improvement",
			check: { type: "llm-judged", question: "Does this diff improve focus?", candidate: "<diff>" },
		};
		const [result] = await verifier.verify([criterion], {
			cwd: "/tmp",
			changedFiles: [],
			llmJudge: testRunner,
		});
		expect(result.status).toBe("pass");
		expect(result.evidence).toContain("cost: 142 tokens");
		expect(result.confidence).toBe(0.9);
	});

	it("when runner throws, returns fail (defensive — uncertain would mask bugs)", async () => {
		const brokenRunner: LlmJudgeRunner = {
			judge: async () => {
				throw new Error("backend down");
			},
		};
		const criterion: AcceptanceCriterion = {
			id: "ux",
			description: "judge ux",
			check: { type: "llm-judged", question: "?", candidate: "<>" },
		};
		const [result] = await verifier.verify([criterion], {
			cwd: "/tmp",
			changedFiles: [],
			llmJudge: brokenRunner,
		});
		expect(result.status).toBe("fail");
		expect(result.evidence).toContain("LLM judge threw");
	});
});

describe("V3 Phase 4 — VerifierResultCache", () => {
	it("identical input on second verify call returns cached result (no backend re-run)", async () => {
		await withTempDir(async dir => {
			let callCount = 0;
			const trackingRunner: LlmJudgeRunner = {
				judge: async () => {
					callCount++;
					return { status: "pass", evidence: "from runner", confidence: 1.0 };
				},
			};
			const cache = new VerifierResultCache();
			const verifier = new AcceptanceVerifier({ cache });
			const criterion: AcceptanceCriterion = {
				id: "judge",
				description: "expensive judgement",
				check: { type: "llm-judged", question: "ok?", candidate: "x" },
			};
			const ctx = { cwd: dir, changedFiles: [], llmJudge: trackingRunner };

			const [r1] = await verifier.verify([criterion], ctx);
			const [r2] = await verifier.verify([criterion], ctx);
			expect(r1.status).toBe("pass");
			expect(r2.status).toBe("pass");
			// Runner ran exactly once — second call hit cache.
			expect(callCount).toBe(1);
		});
	});

	it("file mtime change invalidates the cache entry for the touched file", async () => {
		await withTempDir(async dir => {
			const filePath = path.join(dir, "target.ts");
			await fs.writeFile(filePath, "v1");
			const cache = new VerifierResultCache();
			const verifier = new AcceptanceVerifier({ cache });
			const criterion: AcceptanceCriterion = {
				id: "exists",
				description: "target.ts present",
				check: { type: "file-exists", path: "target.ts" },
			};
			const ctx = { cwd: dir, changedFiles: ["target.ts"] };

			const [first] = await verifier.verify([criterion], ctx);
			expect(first.status).toBe("pass");

			// Touch the file — mtime advances.
			await new Promise(r => setTimeout(r, 20));
			await fs.writeFile(filePath, "v2");

			// Cache MUST detect the mtime change and re-run rather than returning stale verdict.
			const beforeKey = cache.keyFor(criterion, ctx);
			const cachedDirect = await cache.get(criterion, ctx);
			expect(cachedDirect).toBeUndefined();
			expect(typeof beforeKey).toBe("string");
		});
	});

	it("PHASE 4 ACCEPTANCE: cache cuts repeated llm-judged calls by ≥80% on identical inputs", async () => {
		// The acceptance bar in the plan was "consistent verdicts at low cost". The cache
		// makes "identical input → same result for free" structural. We run the same llm-judged
		// criterion 10 times under cache; runner MUST be invoked at most 2 times (first call +
		// at most one re-run if the mtime snapshot were unstable, which it isn't here).
		await withTempDir(async dir => {
			let calls = 0;
			const runner: LlmJudgeRunner = {
				judge: async () => {
					calls++;
					return { status: "pass", evidence: "cached", confidence: 0.95, tokensUsed: 200 };
				},
			};
			const verifier = new AcceptanceVerifier({ cache: new VerifierResultCache() });
			const criterion: AcceptanceCriterion = {
				id: "stable",
				description: "stable judgement",
				check: { type: "llm-judged", question: "is this ok?", candidate: "yes" },
			};
			const ctx = { cwd: dir, changedFiles: [], llmJudge: runner };

			for (let i = 0; i < 10; i++) {
				await verifier.verify([criterion], ctx);
			}

			// Acceptance: <= 2 actual runner calls out of 10 verifier invocations → ≥80% savings.
			expect(calls).toBeLessThanOrEqual(2);
		});
	});
});

describe("V3 Phase 4 — backends compose cleanly", () => {
	it("FULL STACK: command-output + lsp-clean + llm-judged + scope-include in one verify", async () => {
		await withTempDir(async dir => {
			const lspDiagnostics = async (): Promise<LspDiagnostic[]> => [];
			const testRunner: LlmJudgeRunner = {
				judge: async () => ({ status: "pass", evidence: "looks right", confidence: 1.0 }),
			};
			const criteria: AcceptanceCriterion[] = [
				{
					id: "scope",
					description: "edits in src/",
					check: { type: "scope-include", globs: ["src/**"] },
				},
				{
					id: "tests",
					description: "tests green",
					check: {
						type: "command-output",
						argv: ["/bin/echo", "4 passing, 0 failing"],
						stdoutPattern: "0 failing",
					},
				},
				{
					id: "lsp",
					description: "no errors",
					check: { type: "lsp-clean" },
				},
				{
					id: "ux",
					description: "UX judgement",
					check: { type: "llm-judged", question: "ok?", candidate: "y" },
				},
			];
			const verifier = new AcceptanceVerifier({ cache: new VerifierResultCache() });
			const results = await verifier.verify(criteria, {
				cwd: dir,
				changedFiles: ["src/x.ts"],
				lspDiagnostics,
				llmJudge: testRunner,
			});
			expect(results.every(r => r.status === "pass")).toBe(true);
		});
	});
});
