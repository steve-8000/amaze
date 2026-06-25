import { describe, expect, it } from "bun:test";
import { buildCoordinationAdvisory, composeSpawnAdvisory } from "@amaze/pi-coding-agent/task";
import type { TaskItem } from "@amaze/pi-coding-agent/task/types";
import { prompt } from "@amaze/pi-utils";
import subagentSystemPromptTemplate from "../../src/prompts/system/subagent-system-prompt.md" with { type: "text" };

// Contract: a multi-sibling spawn with spawn capacity and IRC available draws
// a proactive coordinate-via-irc suggestion, and the subagent COOP prompt
// actively tells peers to coordinate before overlapping edits.

const item = (): TaskItem => ({ assignment: "do the thing" });

describe("buildCoordinationAdvisory", () => {
	it("suggests irc coordination for >=2 siblings with capacity and irc enabled", () => {
		const advice = buildCoordinationAdvisory([item(), item()], true, true);
		expect(advice).toBeDefined();
		expect(advice).toContain("`irc`");
	});

	it("stays silent for a single spawn", () => {
		expect(buildCoordinationAdvisory([item()], true, true)).toBeUndefined();
	});

	it("stays silent when irc is unavailable", () => {
		expect(buildCoordinationAdvisory([item(), item()], true, false)).toBeUndefined();
	});

	it("stays silent at max depth (no spawn capacity)", () => {
		expect(buildCoordinationAdvisory([item(), item()], false, true)).toBeUndefined();
	});
});

describe("subagent COOP irc guidance", () => {
	it("prompts coordination before overlapping edits when peers are present", () => {
		const out = prompt.render(subagentSystemPromptTemplate, {
			agent: "Base worker.",
			ircPeers: "- `Sib` — task (sub, running)",
			ircSelfId: "Self",
		});
		expect(out).toContain("before you edit");
		expect(out).toMatch(/overlapping edits collide/i);
	});
});

// Contract: TaskTool.execute appends only the async coordination suggestion.
// Sync siblings have already finished, so composeSpawnAdvisory must stay silent
// there even when the same worker fanout would coordinate on the async path.
describe("composeSpawnAdvisory", () => {
	const worker = (role?: string): TaskItem => ({ assignment: "x", role });

	it("returns the irc coordination suggestion for an async fanout", () => {
		const advisory = composeSpawnAdvisory({
			agentName: "task",
			items: [worker(), worker()],
			depthCapacity: true,
			ircEnabled: true,
			willRunAsync: true,
		});
		expect(advisory).toContain("Coordinate:");
	});

	it("drops the coordination suggestion on the sync path", () => {
		expect(
			composeSpawnAdvisory({
				agentName: "task",
				items: [worker(), worker()],
				depthCapacity: true,
				ircEnabled: true,
				willRunAsync: false,
			}),
		).toBeUndefined();
	});

	it("omits coordination when irc is unavailable, even async", () => {
		expect(
			composeSpawnAdvisory({
				agentName: "task",
				items: [worker(), worker()],
				depthCapacity: true,
				ircEnabled: false,
				willRunAsync: true,
			}),
		).toBeUndefined();
	});

	it("returns undefined for a single named spawn", () => {
		expect(
			composeSpawnAdvisory({
				agentName: "reviewer",
				items: [worker("Auth-flow security reviewer")],
				depthCapacity: true,
				ircEnabled: true,
				willRunAsync: true,
			}),
		).toBeUndefined();
	});

	it("returns undefined at max depth (no spawn capacity)", () => {
		expect(
			composeSpawnAdvisory({
				agentName: "task",
				items: [worker(), worker()],
				depthCapacity: false,
				ircEnabled: true,
				willRunAsync: true,
			}),
		).toBeUndefined();
	});
});
