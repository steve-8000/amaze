import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { InternalUrlRouter } from "@amaze/coding-agent/internal-urls";
import type { AgentSession } from "@amaze/coding-agent/session/agent-session";
import { Settings } from "../../src/config/settings";
import { AgentRegistry } from "../../src/registry/agent-registry";
import { getRockeyArtifactRoot } from "../../src/rockey/store";

describe("Rockey memory://root", () => {
	beforeEach(() => {
		AgentRegistry.resetGlobalForTests();
		InternalUrlRouter.resetForTests();
	});

	afterEach(() => {
		AgentRegistry.resetGlobalForTests();
		InternalUrlRouter.resetForTests();
	});

	it("resolves Rockey derived artifacts from the active backend root", async () => {
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rockey-memory-protocol-"));
		try {
			const agentDir = path.join(tempRoot, "agent");
			const cwd = path.join(tempRoot, "repo");
			await fs.mkdir(cwd, { recursive: true });
			const settings = Settings.isolated({ "memory.backend": "rockey" });
			settings.getAgentDir = () => agentDir;
			const memoryRoot = getRockeyArtifactRoot(agentDir, cwd);
			await fs.mkdir(memoryRoot, { recursive: true });
			await Bun.write(path.join(memoryRoot, "memory_summary.md"), "rockey summary");
			AgentRegistry.global().register({
				id: "test-main",
				displayName: "test",
				kind: "main",
				session: {
					settings,
					sessionManager: {
						getCwd: () => cwd,
						getArtifactsDir: () => null,
						getSessionId: () => "test",
					},
				} as unknown as AgentSession,
				sessionFile: null,
			});
			const resource = await InternalUrlRouter.instance().resolve("memory://root");
			expect(resource.content).toBe("rockey summary");
		} finally {
			await fs.rm(tempRoot, { recursive: true, force: true });
		}
	});
});
