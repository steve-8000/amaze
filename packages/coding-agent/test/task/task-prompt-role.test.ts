import { describe, expect, it } from "bun:test";
import { prompt } from "@steve-z8k/pi-utils";
import taskDescriptionTemplate from "../../src/prompts/tools/task.md" with { type: "text" };

// Contract: the task tool description the model sees advertises the optional
// `role` parameter while routing primarily by the simple contract agent names.

function render(batchEnabled: boolean): string {
	return prompt.render(taskDescriptionTemplate, {
		agents: [{ name: "explore", description: "scout", readOnly: true }],
		spawningDisabled: false,
		MAX_CONCURRENCY: 32,
		isolationEnabled: true,
		batchEnabled,
		asyncEnabled: true,
		ircEnabled: true,
	});
}

describe("task tool description: contract agents", () => {
	it("documents `role` in the batch parameter list", () => {
		const out = render(true);
		expect(out).toContain("`role`:");
		expect(out).toMatch(/optional short specialization label/i);
	});

	it("documents `role` in the flat (single-spawn) parameter list", () => {
		const out = render(false);
		expect(out).toContain("`role`:");
	});

	it("makes the four contract-agent roster the routing default", () => {
		const out = prompt.render(taskDescriptionTemplate, {
			agents: [
				{ name: "ultra", description: "highest-capability user-invoked agent", readOnly: false },
				{ name: "deep", description: "planner and validator", readOnly: false },
				{ name: "flash", description: "fast sandbox coding worker", readOnly: false },
				{ name: "spark", description: "github commit and web search specialist", readOnly: false },
			],
			spawningDisabled: false,
			MAX_CONCURRENCY: 32,
			isolationEnabled: true,
			batchEnabled: true,
			asyncEnabled: true,
			ircEnabled: true,
		});
		expect(out).toContain("# ultra");
		expect(out).toContain("highest-capability user-invoked agent");
		expect(out).toContain("# deep");
		expect(out).toContain("# flash");
		expect(out).toContain("# spark");
		expect(out).toContain(
			"complex/risky comparisons SHOULD use `flash` for isolated implementation candidates and `deep` for review, audit, validation, or merge synthesis",
		);
	});
});
