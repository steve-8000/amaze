import { beforeEach, describe, expect, it } from "bun:test";
import { clearBundledAgentsCache, getBundledAgent, loadBundledAgents } from "../../src/task/agents";

describe("bundled agents", () => {
	beforeEach(() => {
		clearBundledAgentsCache();
	});

	it("loads the complete bundled agent roster", () => {
		const agents = loadBundledAgents();
		const names = agents.map(agent => agent.name);

		expect(agents).toHaveLength(7);
		expect(names.filter(name => name === "Resercher_X")).toHaveLength(1);
		expect(names.filter(name => name === "Resercher")).toHaveLength(1);
	});

	it("registers the canonical Resercher_X agent", () => {
		const xResearcher = getBundledAgent("Resercher_X");
		if (!xResearcher) throw new Error("Expected bundled Resercher_X agent");

		expect(xResearcher.tools?.filter(tool => tool !== "yield")).toEqual(["x_search", "x_search_deep"]);
		expect(xResearcher.description).toContain("SocialSignalCards");
		expect(xResearcher.description).toContain("verbatimAvailable");
		expect(xResearcher.systemPrompt).toContain("canonical dedicated xAI X/Twitter research agent");
		expect(xResearcher.systemPrompt).toContain("verbatimAvailable: false");
	});

	it("registers Resercher with web source tools", () => {
		const sourceScout = getBundledAgent("Resercher");
		if (!sourceScout) throw new Error("Expected bundled Resercher agent");

		expect(sourceScout.tools?.filter(tool => tool !== "yield")).toEqual(["web_search", "read"]);
		expect(sourceScout.systemPrompt).toContain("source harvester, not a judge");
		expect(sourceScout.model).toEqual(["Resercher"]);
		expect(sourceScout.output).toBeDefined();
	});

	it("keeps Explore repository-only", () => {
		const explore = getBundledAgent("Explore");
		if (!explore) throw new Error("Expected bundled Explore agent");

		expect(explore.tools?.filter(tool => tool !== "yield")).toEqual(["read", "search", "find"]);
		expect(explore.tools).not.toContain("web_search");
		expect(explore.description).toContain("Repository facts only; no web access.");
	});
});

describe("bundled visual qa agent", () => {
	it("registers the Designer runtime-inspection agent", () => {
		clearBundledAgentsCache();
		const visualQa = getBundledAgent("Designer");
		if (!visualQa) throw new Error("Expected bundled Designer agent");

		expect(visualQa.tools).toEqual(expect.arrayContaining(["browser", "inspect_image", "read"]));
		expect(visualQa.tools).not.toContain("cua");
		expect(visualQa.systemPrompt).toContain("visual QA specialist");
		expect(visualQa.systemPrompt).toContain("You are NOT a coding agent.");
	});
	it("appears in the bundled agent roster exactly once", () => {
		clearBundledAgentsCache();
		const names = loadBundledAgents().map(agent => agent.name);
		expect(names.filter(name => name === "Designer")).toHaveLength(1);
	});
});
