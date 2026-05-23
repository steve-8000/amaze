import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Settings } from "@amaze/coding-agent/config/settings";
import { nexusBackend } from "@amaze/coding-agent/memory-backend/nexus-backend";

async function makeTempDir(prefix: string): Promise<string> {
	return fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
}

describe("nexus startup degradation", () => {
	it("records maintenance startup failures without blocking startup", async () => {
		const agentDir = await makeTempDir("nexus-startup-degraded-agent");
		const cwd = await makeTempDir("nexus-startup-degraded-cwd");
		const { NexusStore } = await import("@amaze/coding-agent/nexus/store");
		const originalRenderArtifacts = NexusStore.prototype.renderArtifacts;
		try {
			const settings = Settings.isolated({
				"memory.backend": "nexus",
				"nexus.llm.enabled": false,
				"nexus.embeddings.enabled": false,
				"nexus.pipeline.enabled": true,
				"nexus.healing.enabled": false,
				"nexus.hypothesisVerification.enabled": false,
				"nexus.conceptualSkills.enabled": false,
				"nexus.knowledge.enabled": false,
			});
			const session = {
				sessionManager: {
					getCwd: () => cwd,
					getSessionDir: () => path.join(agentDir, "sessions"),
				},
				settings,
			} as any;
			Object.defineProperty(settings, "getAgentDir", { value: () => agentDir });

			NexusStore.prototype.renderArtifacts = async () => {
				throw new Error("injected startup maintenance failure");
			};
			await expect(
				nexusBackend.start({ session, settings, modelRegistry: {} as any, agentDir, taskDepth: 0 }),
			).resolves.toBeUndefined();

			expect(nexusBackend.getDegradationStatus().maintenance).toContain("injected startup maintenance failure");
		} finally {
			NexusStore.prototype.renderArtifacts = originalRenderArtifacts;
			await fs.rm(agentDir, { recursive: true, force: true });
			await fs.rm(cwd, { recursive: true, force: true });
		}
	});
});
