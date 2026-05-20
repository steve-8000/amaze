import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { RockeyStore, resolveRockeyScope } from "../../src/rockey/store";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rockey-store-"));
	try {
		return await fn(dir);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
}

describe("RockeyStore", () => {
	it("uses SQLite as the canonical source and renders markdown artifacts for memory://root", async () => {
		await withTempDir(async agentDir => {
			const cwd = path.join(agentDir, "repo");
			await fs.mkdir(cwd, { recursive: true });
			const store = new RockeyStore({ agentDir, cwd });

			const add = store.add({ target: "project", content: "Use bun check instead of tsc for this repository." });
			expect(add.success).toBe(true);

			const results = store.search({ query: "bun check", scope: resolveRockeyScope(cwd), limit: 5 });
			expect(results.map(result => result.content)).toContain("Use bun check instead of tsc for this repository.");

			await store.renderArtifacts();
			const artifact = await Bun.file(path.join(store.artifactRoot, "MEMORY.md")).text();
			expect(artifact).toContain("Use bun check instead of tsc for this repository.");
		});
	});

	it("does not collide project scopes that share a basename", async () => {
		await withTempDir(async agentDir => {
			const first = path.join(agentDir, "alpha", "repo");
			const second = path.join(agentDir, "beta", "repo");
			await fs.mkdir(first, { recursive: true });
			await fs.mkdir(second, { recursive: true });

			new RockeyStore({ agentDir, cwd: first }).add({ target: "project", content: "Alpha repo convention." });
			new RockeyStore({ agentDir, cwd: second }).add({ target: "project", content: "Beta repo convention." });

			const firstResults = new RockeyStore({ agentDir, cwd: first }).search({
				query: "repo convention",
				scope: resolveRockeyScope(first),
				limit: 10,
			});
			const secondResults = new RockeyStore({ agentDir, cwd: second }).search({
				query: "repo convention",
				scope: resolveRockeyScope(second),
				limit: 10,
			});

			expect(firstResults.map(result => result.content)).toEqual(["Alpha repo convention."]);
			expect(secondResults.map(result => result.content)).toEqual(["Beta repo convention."]);
		});
	});

	it("rejects secrets before persisting them", async () => {
		await withTempDir(async agentDir => {
			const store = new RockeyStore({ agentDir, cwd: agentDir });
			const result = store.add({ target: "memory", content: "OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz" });

			expect(result.success).toBe(false);
			expect(result.error).toContain("secret");
			expect(store.list({ limit: 10 })).toEqual([]);
		});
	});
});
