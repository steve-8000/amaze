import { describe, expect, it, spyOn } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { importPiHermesMemoryOnce } from "../../src/rockey/migration";
import { RockeyStore } from "../../src/rockey/store";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rockey-migration-"));
	try {
		return await fn(dir);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
}

describe("Rockey migration", () => {
	it("imports global and project pi-hermes markdown memories without duplicating on rerun", async () => {
		await withTempDir(async root => {
			const fakeHome = path.join(root, "home");
			const legacyAgentRoot = path.join(fakeHome, ".pi", "agent");
			const legacyGlobal = path.join(legacyAgentRoot, "pi-hermes-memory");
			const legacyProject = path.join(legacyAgentRoot, "projects-memory", "repo");
			await fs.mkdir(legacyGlobal, { recursive: true });
			await fs.mkdir(legacyProject, { recursive: true });
			await Bun.write(
				path.join(legacyGlobal, "MEMORY.md"),
				"Use bun check\n§\nUse memory_search before assumptions",
			);
			await Bun.write(path.join(legacyProject, "MEMORY.md"), "Repo-specific convention");
			const homedirSpy = spyOn(os, "homedir").mockReturnValue(fakeHome);

			const agentDir = path.join(root, "agent");
			const cwd = path.join(root, "work", "repo");
			await fs.mkdir(cwd, { recursive: true });
			const store = new RockeyStore({ agentDir, cwd });
			try {
				await importPiHermesMemoryOnce(store);
				await importPiHermesMemoryOnce(store);
				const globalEntries = store.search({
					query: "memory_search",
					scope: { kind: "global", key: null, displayName: "global", cwd: null },
					includeGlobal: false,
					limit: 10,
				});
				const projectEntries = store.search({
					query: "Repo-specific",
					scope: store.scope,
					includeGlobal: false,
					limit: 10,
				});
				expect(globalEntries.map(entry => entry.content)).toEqual(["Use memory_search before assumptions"]);
				expect(projectEntries.map(entry => entry.content)).toEqual(["Repo-specific convention"]);
			} finally {
				homedirSpy.mockRestore();
				store.close();
			}
		});
	});
});
