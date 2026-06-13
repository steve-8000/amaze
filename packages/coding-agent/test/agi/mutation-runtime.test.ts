import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { StrictMutationRuntime } from "../../src/cli/agi-mutation-runtime";
import { Settings } from "../../src/config/settings";
import { MissionStore } from "../../src/mission/store";

interface Fixture {
	root: string;
	repo: string;
	sandboxRoot: string;
	dbPath: string;
	settings: Settings;
}

async function makeFixture(initialContent = "version = 0\n"): Promise<Fixture> {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "agi-mutation-runtime-"));
	const repo = path.join(root, "repo");
	const sandboxRoot = path.join(root, "sandboxes");
	fs.mkdirSync(repo, { recursive: true });
	await git(repo, ["init"]);
	await git(repo, ["config", "user.email", "test@example.com"]);
	await git(repo, ["config", "user.name", "Test"]);
	await git(repo, ["config", "commit.gpgsign", "false"]);
	fs.writeFileSync(path.join(repo, "config.txt"), initialContent);
	await git(repo, ["add", "config.txt"]);
	await git(repo, ["commit", "-m", "base"]);
	const settings = await Settings.createForCwd(repo);
	return { root, repo, sandboxRoot, dbPath: path.join(root, "autonomy.db"), settings };
}

function cleanup(fixture: Fixture): void {
	fs.rmSync(fixture.root, { recursive: true, force: true });
}

describe("StrictMutationRuntime end-to-end", () => {
	test("applies a sandboxed mutation to main only after verification passes", async () => {
		const fixture = await makeFixture();
		const runtime = await StrictMutationRuntime.create({
			repoCwd: fixture.repo,
			sandboxRoot: fixture.sandboxRoot,
			dbPath: fixture.dbPath,
			targetPath: "config.txt",
			mutationContent: "version = 1 // MUTATION_MARKER\n",
			expectedMarker: "MUTATION_MARKER",
			approval: "approve",
			settings: fixture.settings,
		});
		try {
			// Main repo is untouched before the tick runs the sandboxed mutation.
			expect(fs.readFileSync(path.join(fixture.repo, "config.txt"), "utf8")).toBe("version = 0\n");

			const result = await runtime.tick();

			expect(result.tick.actionsAllowed).toBe(1);
			expect(result.tick.actionsBlocked).toBe(0);
			expect(result.actionStatus).toBe("verified");
			expect(result.leaseAllowedTools).toEqual(["write"]);

			// Production write descriptor selected, sandbox isolated mutation, accept-to-main.
			expect(result.eventTypes).toContain("mission.tool.requested");
			expect(result.eventTypes).toContain("mission.tool.completed");
			expect(result.eventTypes).toContain("runtime_action.completed");
			expect(result.eventTypes).toContain("sandbox.diff_captured");
			expect(result.eventTypes).toContain("evidence.verified");
			expect(result.eventTypes).toContain("sandbox.applied");
			expect(result.eventTypes).not.toContain("rollback.completed");

			// Mutation landed in the MAIN repo after acceptance.
			expect(fs.readFileSync(path.join(fixture.repo, "config.txt"), "utf8")).toBe(
				"version = 1 // MUTATION_MARKER\n",
			);
		} finally {
			runtime.close();
			cleanup(fixture);
		}
	});

	test("persists the mutation runtime event chain durably", async () => {
		const fixture = await makeFixture();
		const runtime = await StrictMutationRuntime.create({
			repoCwd: fixture.repo,
			sandboxRoot: fixture.sandboxRoot,
			dbPath: fixture.dbPath,
			targetPath: "config.txt",
			mutationContent: "version = 1 // MUTATION_MARKER\n",
			expectedMarker: "MUTATION_MARKER",
			settings: fixture.settings,
		});
		let missionId: string;
		let actionId: string;
		try {
			const result = await runtime.tick();
			missionId = result.missionId;
			actionId = result.actionId;
		} finally {
			runtime.close();
		}

		// Reopen the durable store after the runtime closed (restart-style read).
		const reopened = new MissionStore(fixture.dbPath);
		try {
			const action = reopened.listRuntimeActionsForMission(missionId);
			expect(action).toHaveLength(1);
			expect(action[0]?.id).toBe(actionId);
			expect(action[0]?.status).toBe("verified");
			expect(action[0]?.lease?.allowedTools).toEqual(["write"]);
			const events = reopened.listRuntimeEvents(missionId).map(event => event.type);
			expect(events).toContain("mission.tool.requested");
			expect(events).toContain("sandbox.applied");
		} finally {
			reopened.close();
			cleanup(fixture);
		}
	});
	test("rolls back the sandbox and never mutates main when verification fails", async () => {
		const fixture = await makeFixture();
		const runtime = await StrictMutationRuntime.create({
			repoCwd: fixture.repo,
			sandboxRoot: fixture.sandboxRoot,
			dbPath: fixture.dbPath,
			targetPath: "config.txt",
			// The mutation runs, but the content lacks the marker the verifier requires.
			mutationContent: "version = 1 // WRONG\n",
			expectedMarker: "MUTATION_MARKER",
			approval: "approve",
			settings: fixture.settings,
		});
		try {
			const result = await runtime.tick();

			expect(result.actionStatus).toBe("failed");
			expect(result.missionState).toBe("blocked");
			expect(result.eventTypes).toContain("sandbox.diff_captured");
			expect(result.eventTypes).toContain("rollback.completed");
			expect(result.eventTypes).not.toContain("sandbox.applied");

			// Main repo content is unchanged and the working tree is clean (no leak).
			expect(fs.readFileSync(path.join(fixture.repo, "config.txt"), "utf8")).toBe("version = 0\n");
			expect(result.mainClean).toBe(true);
		} finally {
			runtime.close();
			cleanup(fixture);
		}
	});

	test("rollback state is persisted and visible after a runtime restart", async () => {
		const fixture = await makeFixture();
		const runtime = await StrictMutationRuntime.create({
			repoCwd: fixture.repo,
			sandboxRoot: fixture.sandboxRoot,
			dbPath: fixture.dbPath,
			targetPath: "config.txt",
			mutationContent: "version = 1 // WRONG\n",
			expectedMarker: "MUTATION_MARKER",
			settings: fixture.settings,
		});
		let missionId: string;
		try {
			const result = await runtime.tick();
			missionId = result.missionId;
		} finally {
			runtime.close();
		}

		const reopened = new MissionStore(fixture.dbPath);
		try {
			expect(reopened.getMission(missionId)?.state).toBe("blocked");
			expect(reopened.listRuntimeActionsForMission(missionId)[0]?.status).toBe("failed");
			const events = reopened.listRuntimeEvents(missionId).map(event => event.type);
			expect(events).toContain("rollback.completed");
			expect(fs.readFileSync(path.join(fixture.repo, "config.txt"), "utf8")).toBe("version = 0\n");
		} finally {
			reopened.close();
			cleanup(fixture);
		}
	});

	test("rejected governance approval blocks the mutation before it runs", async () => {
		const fixture = await makeFixture();
		const runtime = await StrictMutationRuntime.create({
			repoCwd: fixture.repo,
			sandboxRoot: fixture.sandboxRoot,
			dbPath: fixture.dbPath,
			targetPath: "config.txt",
			mutationContent: "version = 1 // MUTATION_MARKER\n",
			expectedMarker: "MUTATION_MARKER",
			approval: "reject",
			settings: fixture.settings,
		});
		try {
			const result = await runtime.tick();

			expect(result.tick.actionsBlocked).toBe(1);
			expect(result.tick.actionsAllowed).toBe(0);
			expect(result.actionStatus).toBe("blocked");
			expect(result.eventTypes).toContain("runtime.governance.blocked");
			expect(result.eventTypes).not.toContain("mission.tool.requested");
			expect(result.eventTypes).not.toContain("sandbox.applied");
			expect(fs.readFileSync(path.join(fixture.repo, "config.txt"), "utf8")).toBe("version = 0\n");
			expect(result.mainClean).toBe(true);
		} finally {
			runtime.close();
			cleanup(fixture);
		}
	});

	test("approved governance approval allows the mutation to execute", async () => {
		const fixture = await makeFixture();
		const runtime = await StrictMutationRuntime.create({
			repoCwd: fixture.repo,
			sandboxRoot: fixture.sandboxRoot,
			dbPath: fixture.dbPath,
			targetPath: "config.txt",
			mutationContent: "version = 1 // MUTATION_MARKER\n",
			expectedMarker: "MUTATION_MARKER",
			approval: "approve",
			settings: fixture.settings,
		});
		try {
			const result = await runtime.tick();
			expect(result.actionStatus).toBe("verified");
			expect(result.eventTypes).toContain("sandbox.applied");
		} finally {
			runtime.close();
			cleanup(fixture);
		}
	});

	test("persisted emergency stop blocks the mutation and survives runtime recreation", async () => {
		const fixture = await makeFixture();
		const runtime = await StrictMutationRuntime.create({
			repoCwd: fixture.repo,
			sandboxRoot: fixture.sandboxRoot,
			dbPath: fixture.dbPath,
			targetPath: "config.txt",
			mutationContent: "version = 1 // MUTATION_MARKER\n",
			expectedMarker: "MUTATION_MARKER",
			approval: "approve",
			emergencyStop: true,
			settings: fixture.settings,
		});
		let missionId: string;
		try {
			const result = await runtime.tick();
			missionId = result.missionId;
			expect(result.tick.actionsBlocked).toBe(1);
			expect(result.actionStatus).toBe("blocked");
			expect(result.eventTypes).toContain("runtime.governance.blocked");
			expect(fs.readFileSync(path.join(fixture.repo, "config.txt"), "utf8")).toBe("version = 0\n");

			// Recreate the runtime against the same db: the emergency stop persists.
			runtime.reopen();
			const second = await runtime.tick();
			expect(second.actionStatus).toBe("blocked");
		} finally {
			runtime.close();
		}

		const reopened = new MissionStore(fixture.dbPath);
		try {
			expect(reopened.getAgiEmergencyStop(missionId)?.missionId).toBe(missionId);
			expect(reopened.getMission(missionId)?.state).toBe("blocked");
		} finally {
			reopened.close();
			cleanup(fixture);
		}
	});

	test("restart after an issued lease does not leave a running wedge", async () => {
		const fixture = await makeFixture();
		const runtime = await StrictMutationRuntime.create({
			repoCwd: fixture.repo,
			sandboxRoot: fixture.sandboxRoot,
			dbPath: fixture.dbPath,
			targetPath: "config.txt",
			mutationContent: "version = 1 // MUTATION_MARKER\n",
			expectedMarker: "MUTATION_MARKER",
			settings: fixture.settings,
		});
		let missionId: string;
		try {
			// First tick verifies and applies, persisting the action and lease.
			const first = await runtime.tick();
			missionId = first.missionId;
			expect(first.actionStatus).toBe("verified");

			// Restart the runtime against the same durable db. A terminal verified
			// action must remain verified — restart must never reopen a closed action.
			runtime.reopen();
		} finally {
			// keep runtime open for assertions below
		}

		const reopened = new MissionStore(fixture.dbPath);
		try {
			const action = reopened.listRuntimeActionsForMission(missionId);
			expect(action).toHaveLength(1);
			// The terminal verified status is preserved across restart; no running wedge.
			expect(action[0]?.status).toBe("verified");
		} finally {
			reopened.close();
			runtime.close();
			cleanup(fixture);
		}
	});
	test("restart after a pending approval blocks rather than wedging", async () => {
		const fixture = await makeFixture();
		const runtime = await StrictMutationRuntime.create({
			repoCwd: fixture.repo,
			sandboxRoot: fixture.sandboxRoot,
			dbPath: fixture.dbPath,
			targetPath: "config.txt",
			mutationContent: "version = 1 // MUTATION_MARKER\n",
			expectedMarker: "MUTATION_MARKER",
			approval: "pending",
			settings: fixture.settings,
		});
		let missionId: string;
		try {
			const first = await runtime.tick();
			missionId = first.missionId;
			expect(first.actionStatus).toBe("blocked");
			expect(first.eventTypes).toContain("runtime.governance.blocked");

			// Restart with the approval still pending: the runtime stays blocked, never running.
			runtime.reopen();
			const second = await runtime.tick();
			expect(second.actionStatus).toBe("blocked");
			expect(fs.readFileSync(path.join(fixture.repo, "config.txt"), "utf8")).toBe("version = 0\n");
		} finally {
			runtime.close();
		}

		const reopened = new MissionStore(fixture.dbPath);
		try {
			expect(reopened.listRuntimeActionsForMission(missionId)[0]?.status).toBe("blocked");
			expect(reopened.getMission(missionId)?.state).toBe("blocked");
		} finally {
			reopened.close();
			cleanup(fixture);
		}
	});
});

async function git(cwd: string, args: string[]): Promise<void> {
	const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr || stdout}`);
}
