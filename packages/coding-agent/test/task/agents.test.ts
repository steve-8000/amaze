import { describe, expect, it } from "bun:test";
import { clearBundledAgentsCache, getBundledAgent, loadBundledAgents } from "../../src/task/agents";

describe("bundled researcher agent", () => {
	it("registers the xAI X/Twitter researcher agent", () => {
		clearBundledAgentsCache();
		const researcher = getBundledAgent("researcher");
		if (!researcher) throw new Error("Expected bundled researcher agent");

		expect(researcher.description).toContain("X/Twitter");
		expect(researcher.tools).toEqual(expect.arrayContaining(["x_search", "x_search_deep"]));
		expect(researcher.tools).not.toContain("web_search");
		expect(researcher.tools).not.toContain("browser");
		expect(researcher.tools).not.toContain("read");
		expect(researcher.model).toEqual(["xai/grok-4.3"]);
		expect(researcher.systemPrompt).toContain("X/Twitter only");
		expect(researcher.systemPrompt).toContain("x_search");
		expect(researcher.systemPrompt).not.toContain("web_search");
	});

	it("appears in the bundled agent roster exactly once", () => {
		clearBundledAgentsCache();
		const names = loadBundledAgents().map(agent => agent.name);
		expect(names.filter(name => name === "researcher")).toHaveLength(1);
	});
});

describe("bundled visual qa agent", () => {
	it("registers the visual_qa runtime-inspection agent", () => {
		clearBundledAgentsCache();
		const visualQa = getBundledAgent("visual_qa");
		if (!visualQa) throw new Error("Expected bundled visual_qa agent");

		expect(visualQa.tools).toEqual(expect.arrayContaining(["browser", "cua", "inspect_image", "read"]));
		expect(visualQa.systemPrompt).toContain("visual QA specialist");
		expect(visualQa.systemPrompt).toContain("You are NOT a coding agent.");
	});
	it("appears in the bundled agent roster exactly once", () => {
		clearBundledAgentsCache();
		const names = loadBundledAgents().map(agent => agent.name);
		expect(names.filter(name => name === "visual_qa")).toHaveLength(1);
	});
});
