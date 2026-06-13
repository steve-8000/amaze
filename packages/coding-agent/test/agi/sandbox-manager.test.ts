import { describe, expect, test } from "bun:test";
import { InMemorySandboxManager } from "../../src/agi/sandbox-manager";

describe("sandbox manager", () => {
	test("creates isolated workspace and produces rollback refs", async () => {
		const manager = new InMemorySandboxManager({ now: () => 10 });
		const workspace = await manager.create({
			missionId: "mission-1",
			actionId: "action-1",
			cwd: "/repo",
			baselineRef: "base",
		});
		const diff = await manager.captureDiff(workspace.id);
		const applied = await manager.applyToMain(workspace.id);

		expect(workspace.mode).toBe("isolated-worktree");
		expect(diff.diffRef).toContain(workspace.id);
		expect(applied.rollbackRef).toContain(workspace.id);
	});
});
