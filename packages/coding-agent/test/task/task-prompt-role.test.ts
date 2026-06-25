import { describe, expect, it } from "bun:test";
import { prompt } from "@amaze/pi-utils";
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

	it("makes the simple contract roster the routing default", () => {
		const out = render(true);
		expect(out).toContain("`thinker`: hard judgment");
		expect(out).toContain("`coder`: complex implementation");
		expect(out).toContain("`finder`: read-only investigation");
		expect(out).toContain("`fixer`: small, clear");
		expect(out).toContain("`checker`: review");
		expect(out).toContain("`helper`: cheap summarization");
	});
});
