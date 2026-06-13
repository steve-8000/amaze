import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { GitWorktreeSandboxManager, InMemorySandboxManager } from "../../src/agi/sandbox-manager";

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

	test("git worktree sandbox executes outside main repo and captures diff", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "agi-sandbox-test-"));
		const repo = path.join(root, "repo");
		const sandboxes = path.join(root, "sandboxes");
		fs.mkdirSync(repo, { recursive: true });
		try {
			await git(repo, ["init"]);
			await git(repo, ["config", "user.email", "test@example.com"]);
			await git(repo, ["config", "user.name", "Test"]);
			fs.writeFileSync(path.join(repo, "file.txt"), "base\n");
			await git(repo, ["add", "file.txt"]);
			await git(repo, ["commit", "-m", "base"]);

			const manager = new GitWorktreeSandboxManager({ rootDir: sandboxes, now: () => 123 });
			const workspace = await manager.create({ missionId: "mission-1", actionId: "action-1", cwd: repo });
			fs.writeFileSync(path.join(workspace.cwd, "file.txt"), "changed\n");

			expect(fs.readFileSync(path.join(repo, "file.txt"), "utf8")).toBe("base\n");
			const diff = await manager.captureDiff(workspace.id);
			expect(fs.readFileSync(diff.diffRef, "utf8")).toContain("changed");
			expect(diff.contentHash).toHaveLength(64);

			const applied = await manager.applyToMain(workspace.id);
			expect(fs.readFileSync(path.join(repo, "file.txt"), "utf8")).toBe("changed\n");
			await manager.rollback({ rollbackRef: applied.rollbackRef, reason: "test rollback" });
			expect(fs.readFileSync(path.join(repo, "file.txt"), "utf8")).toBe("base\n");
			await manager.dispose(workspace.id);
			expect(fs.existsSync(workspace.cwd)).toBe(false);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
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
