import type { Settings } from "../config/settings";
import { getMemoryRoot } from "../memories";
import { getNexusArtifactRoot, getNexusRoot } from "../nexus/store";
import { getRockeyArtifactRoot } from "../rockey/store";
import { resolveMemoryBackend } from "./resolve";

export function resolveMemoryArtifactRoot(settings: Settings, cwd: string): string | undefined {
	const agentDir = settings.getAgentDir();
	const backend = resolveMemoryBackend(settings);
	if (backend.id === "nexus") {
		return getNexusArtifactRoot(agentDir, cwd) ?? getNexusRoot(agentDir);
	}
	switch (settings.get("memory.backend")) {
		case "local":
			return getMemoryRoot(agentDir, cwd);
		case "rockey":
			return getRockeyArtifactRoot(agentDir, cwd);
		default:
			return undefined;
	}
}
