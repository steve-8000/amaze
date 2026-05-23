import { beforeEach, describe, expect, it } from "bun:test";
import { clearBundledAgentsCache, getBundledAgent, loadBundledAgents } from "../../src/task/agents";

describe("bundled agents", () => {
	beforeEach(() => {
		clearBundledAgentsCache();
	});

	it("loads the complete bundled agent roster", () => {
		const agents = loadBundledAgents();
		const names = agents.map(agent => agent.name);

		expect(agents).toHaveLength(11);
		expect(names.filter(name => name === "researcher")).toHaveLength(1);
		expect(names.filter(name => name === "x_researcher")).toHaveLength(1);
		expect(names.filter(name => name === "source_scout")).toHaveLength(1);
		expect(names.filter(name => name === "memory_scout")).toHaveLength(1);
	});

	it("registers the deprecated researcher alias", () => {
		const researcher = getBundledAgent("researcher");
		if (!researcher) throw new Error("Expected bundled researcher agent");

		expect(researcher.description).toStartWith("[DEPRECATED alias for x_researcher]");
		expect(researcher.tools?.filter(tool => tool !== "yield")).toEqual(["x_search", "x_search_deep"]);
		expect(researcher.tools).not.toContain("web_search");
		expect(researcher.tools).not.toContain("browser");
		expect(researcher.tools).not.toContain("read");
		expect(researcher.model).toEqual(["xai/grok-4.3"]);
		expect(researcher.systemPrompt).toContain("Deprecated alias");
		expect(researcher.systemPrompt).toContain("X/Twitter only");
		expect(researcher.systemPrompt).toContain("x_search");
		expect(researcher.systemPrompt).not.toContain("web_search");
	});

	it("registers the canonical x_researcher agent", () => {
		const xResearcher = getBundledAgent("x_researcher");
		if (!xResearcher) throw new Error("Expected bundled x_researcher agent");

		expect(xResearcher.tools?.filter(tool => tool !== "yield")).toEqual(["x_search", "x_search_deep"]);
		expect(xResearcher.description).toContain("SocialSignalCards");
		expect(xResearcher.systemPrompt).toContain("canonical dedicated xAI X/Twitter research agent");
	});

	it("registers source_scout with web source tools", () => {
		const sourceScout = getBundledAgent("source_scout");
		if (!sourceScout) throw new Error("Expected bundled source_scout agent");

		expect(sourceScout.tools?.filter(tool => tool !== "yield")).toEqual(["web_search", "read"]);
		expect(sourceScout.systemPrompt).toContain("source harvester, not a judge");
	});

	it("registers memory_scout with memory lookup tools", () => {
		const memoryScout = getBundledAgent("memory_scout");
		if (!memoryScout) throw new Error("Expected bundled memory_scout agent");

		expect(memoryScout.tools?.filter(tool => tool !== "yield")).toEqual(["read", "search"]);
		expect(memoryScout.systemPrompt).toContain("read memory://root");
	});

	it("keeps explore repository-only", () => {
		const explore = getBundledAgent("explore");
		if (!explore) throw new Error("Expected bundled explore agent");

		expect(explore.tools?.filter(tool => tool !== "yield")).toEqual(["read", "search", "find"]);
		expect(explore.tools).not.toContain("web_search");
		expect(explore.description).toContain("Repository facts only; no web access.");
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
