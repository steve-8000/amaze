import type { Settings } from "../config/settings";
import { getMemoryRoot } from "../memories";
import { getRockeyArtifactRoot } from "../rockey/store";

export function resolveMemoryArtifactRoot(settings: Settings, cwd: string): string | undefined {
	const agentDir = settings.getAgentDir();
	switch (settings.get("memory.backend")) {
		case "local":
			return getMemoryRoot(agentDir, cwd);
		case "rockey":
			return getRockeyArtifactRoot(agentDir, cwd);
		default:
			return undefined;
	}
}
