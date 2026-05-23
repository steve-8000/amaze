import type { Settings } from "../config/settings";
import { getNexusArtifactRoot, getNexusRoot } from "../nexus/store";
import { resolveMemoryBackend } from "./resolve";

export function resolveMemoryArtifactRoot(settings: Settings, cwd: string): string | undefined {
	const agentDir = settings.getAgentDir();
	const backend = resolveMemoryBackend(settings);
	if (backend.id === "nexus") {
		return getNexusArtifactRoot(agentDir, cwd) ?? getNexusRoot(agentDir);
	}
	return undefined;
}
