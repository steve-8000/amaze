import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ObjectiveStore } from "../../src/autonomy/store";
import { runAgiCommand } from "../../src/cli/agi";
import { MissionStore } from "../../src/mission/store";

function tempDbPath(): string {
	return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "agi-profile-")), "autonomy.db");
}

function createRuntimeMission(db: string, objectiveId: string, title: string): { missionId: string } {
	const missionStore = new MissionStore(db);
	const objectiveStore = new ObjectiveStore(db);
	try {
		objectiveStore.create({
			id: objectiveId,
			title,
			metricTargets: [{ metric: "x", target: 1, direction: "up" }],
			budget: {},
			guardrails: { requireHumanForApply: false, maxAutoSubgoalsPerDay: 1, forbiddenScopes: [] },
		});
		const mission = missionStore.createMission({
			title,
			objective: title,
			objectiveId,
			briefId: null,
			decisionId: null,
			riskLevel: "medium",
			state: "executing",
			confidence: null,
			snapshotRef: null,
			mode: "interactive",
			intent: "code_change",
			lifecycle: "executing",
		});
		return { missionId: mission.id };
	} finally {
		objectiveStore.close();
		missionStore.close();
	}
}

async function captureStdout(fn: () => Promise<void>): Promise<string> {
	const original = process.stdout.write.bind(process.stdout);
	let captured = "";
	process.stdout.write = (chunk: string | Uint8Array) => {
		captured += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
		return true;
	};
	try {
		await fn();
	} finally {
		process.stdout.write = original;
	}
	return captured;
}

describe("agi runtime profiles", () => {
	test("rejects an unknown profile", async () => {
		const db = tempDbPath();
		try {
			await expect(runAgiCommand({ action: "runtime", profile: "wide-open", db })).rejects.toThrow(
				/strict-observe \| strict-mutation \| strict-self-improve/,
			);
		} finally {
			fs.rmSync(path.dirname(db), { recursive: true, force: true });
		}
	});

	test("strict-observe behaves like the legacy read-only runtime", async () => {
		const db = tempDbPath();
		try {
			const { missionId } = createRuntimeMission(db, "objective-observe", "Observe runtime");
			const out = await captureStdout(() => runAgiCommand({ action: "runtime", profile: "strict-observe", db }));
			expect(out).toContain("AGI strict-observe runtime:");
			expect(out).toContain("queued=1");

			const reopened = new MissionStore(db);
			try {
				const actions = reopened.listRuntimeActionsForMission(missionId);
				expect(actions[0]?.lease?.allowedTools).toEqual(["read"]);
			} finally {
				reopened.close();
			}
		} finally {
			fs.rmSync(path.dirname(db), { recursive: true, force: true });
		}
	});

	test("legacy strict-supervised remains accepted as an observe alias", async () => {
		const db = tempDbPath();
		try {
			createRuntimeMission(db, "objective-legacy", "Legacy runtime");
			const out = await captureStdout(() =>
				runAgiCommand({ action: "runtime", profile: "strict-supervised", db }),
			);
			expect(out).toContain("AGI strict-observe runtime:");
		} finally {
			fs.rmSync(path.dirname(db), { recursive: true, force: true });
		}
	});
});
