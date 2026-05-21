import { describe, expect, it } from "bun:test";
import { checkScope, renderSubagentContract, type SubagentContract } from "@amaze/coding-agent/subagent/contract";

function baseContract(overrides: Partial<SubagentContract> = {}): SubagentContract {
	return {
		role: "refactor-applier",
		scope: { include: [], exclude: [] },
		successCriteria: [],
		escalation: { onUncertainty: "ask-parent", budgetCap: 50000 },
		...overrides,
	};
}

describe("SubagentContract — Phase 2.0 primitive", () => {
	it("renderSubagentContract produces a deterministic XML block (byte-stable for identical input)", () => {
		const contract: SubagentContract = baseContract({
			role: "refactor-applier",
			scope: { include: ["packages/coding-agent/**"], exclude: ["**/CHANGELOG.md"] },
			successCriteria: [
				{
					id: "tests-pass",
					description: "all tests green",
					check: { type: "command-exit", command: "bun test", expected: 0 },
				},
			],
			escalation: { onUncertainty: "ask-parent", budgetCap: 50000 },
		});

		const a = renderSubagentContract(contract);
		const b = renderSubagentContract(contract);
		expect(a).toBe(b);
		expect(a).toContain(`role="refactor-applier"`);
		expect(a).toContain(`<include>packages/coding-agent/**</include>`);
		expect(a).toContain(`<exclude>**/CHANGELOG.md</exclude>`);
		expect(a).toContain(`<criterion id="tests-pass"`);
		expect(a).toContain(`<escalation on-uncertainty="ask-parent" budget-cap="50000"/>`);
	});

	it("renderSubagentContract escapes XML metacharacters in user-provided fields", () => {
		const contract: SubagentContract = baseContract({
			role: "watch & wait",
			scope: { include: ["src/<gen>/*.ts"], exclude: [] },
			successCriteria: [
				{
					id: "a&b",
					description: "fix <bad> & restore",
					check: { type: "manual", description: "human check" },
				},
			],
		});
		const rendered = renderSubagentContract(contract);
		expect(rendered).toContain(`role="watch &amp; wait"`);
		expect(rendered).toContain(`<include>src/&lt;gen&gt;/*.ts</include>`);
		expect(rendered).toContain(`<criterion id="a&amp;b" kind="manual">fix &lt;bad&gt; &amp; restore</criterion>`);
	});

	it("renderSubagentContract omits sections that are empty (clean output)", () => {
		const minimal = baseContract();
		const rendered = renderSubagentContract(minimal);
		expect(rendered).not.toContain("<success-criteria>");
		expect(rendered).not.toContain("<input-artifact>");
		expect(rendered).not.toContain("<output-contract>");
		// Scope block emitted even if both lists empty, so the contract surface is consistent
		// (callers can always count on `<scope>` presence when reading).
		expect(rendered).toContain("<scope>");
		expect(rendered).toContain("</scope>");
	});

	it("checkScope: allowed when no contract is set (no-op for ungoverned subagents)", () => {
		const result = checkScope(undefined, "anything/at/all.ts");
		expect(result.allowed).toBe(true);
	});

	it("checkScope: blocks paths matching scope.exclude (hard fail)", () => {
		const contract = baseContract({
			scope: { include: [], exclude: ["**/CHANGELOG.md"] },
		});
		const result = checkScope(contract, "packages/coding-agent/CHANGELOG.md");
		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.reason).toContain("scope.exclude");
			expect(result.reason).toContain("CHANGELOG.md");
		}
	});

	it("checkScope: allows paths inside scope.include when include is non-empty", () => {
		const contract = baseContract({
			scope: { include: ["packages/coding-agent/**"], exclude: [] },
		});
		const inside = checkScope(contract, "packages/coding-agent/src/x.ts");
		const outside = checkScope(contract, "packages/ai/src/y.ts");
		expect(inside.allowed).toBe(true);
		expect(outside.allowed).toBe(false);
		if (!outside.allowed) {
			expect(outside.reason).toContain("outside contract scope.include");
		}
	});

	it("checkScope: empty include means no positive restriction (only exclude matters)", () => {
		const contract = baseContract({
			scope: { include: [], exclude: ["secrets/**"] },
		});
		expect(checkScope(contract, "anywhere/else.ts").allowed).toBe(true);
		expect(checkScope(contract, "secrets/key.env").allowed).toBe(false);
	});

	it("checkScope: exclude takes precedence over include (defense in depth)", () => {
		const contract = baseContract({
			scope: { include: ["packages/**"], exclude: ["**/CHANGELOG.md"] },
		});
		// CHANGELOG.md is inside packages/** but also matches exclude — exclude wins.
		const result = checkScope(contract, "packages/coding-agent/CHANGELOG.md");
		expect(result.allowed).toBe(false);
	});

	it("checkScope: normalizes backslashes to forward slashes (Windows interop)", () => {
		const contract = baseContract({
			scope: { include: ["packages/**"], exclude: [] },
		});
		const result = checkScope(contract, "packages\\coding-agent\\src\\x.ts");
		expect(result.allowed).toBe(true);
	});
});
