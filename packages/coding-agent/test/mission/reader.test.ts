import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { MissionEvent } from "../../src/mission/events";
import { readMissionEvents } from "../../src/mission/reader";

const roots: string[] = [];

function tempRoot(): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "amaze-mission-reader-"));
	roots.push(root);
	return root;
}

afterEach(() => {
	for (const root of roots.splice(0)) {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

describe("readMissionEvents", () => {
	test("returns an empty array for a missing mission file", async () => {
		const baseDir = tempRoot();
		expect(await readMissionEvents("missing", { baseDir })).toEqual([]);
	});

	test("parses JSONL in file order", async () => {
		const baseDir = tempRoot();
		fs.mkdirSync(baseDir, { recursive: true });
		const events: MissionEvent[] = [
			{
				type: "research.lane.started",
				missionId: "mission-1",
				laneRunId: "lane-1",
				lane: "repo",
				agent: "explore",
				epistemicRole: "repo_truth",
				ts: 10,
			},
			{
				type: "research.lane.completed",
				missionId: "mission-1",
				laneRunId: "lane-1",
				lane: "repo",
				status: "completed",
				evidenceCount: 2,
				emptyReason: null,
				ts: 20,
			},
		];
		fs.writeFileSync(
			path.join(baseDir, "mission-1.jsonl"),
			`${events.map(event => JSON.stringify(event)).join("\n")}\n`,
		);

		expect(await readMissionEvents("mission-1", { baseDir })).toEqual(events);
	});
});
