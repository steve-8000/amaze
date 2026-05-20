import type { CacheRetention } from "@amaze/ai";
import type { Settings } from "./config/settings";
import type { ProjectContextMode } from "./system-prompt";

export type AgentPromptCacheRole = "orchestrator" | "subagent";
export type PromptCacheRetentionSetting = CacheRetention | "default";

export interface PromptCachePolicy {
	role: AgentPromptCacheRole;
	projectContextMode: ProjectContextMode;
	cacheRetention: CacheRetention | undefined;
}

function resolveCacheRetentionSetting(value: PromptCacheRetentionSetting): CacheRetention | undefined {
	return value === "default" ? undefined : value;
}

export function resolvePromptCachePolicy(options: {
	settings: Settings;
	taskDepth?: number;
	parentTaskPrefix?: string;
}): PromptCachePolicy {
	const isSubagent = (options.taskDepth ?? 0) > 0 || Boolean(options.parentTaskPrefix);
	const role: AgentPromptCacheRole = isSubagent ? "subagent" : "orchestrator";

	if (role === "subagent") {
		return {
			role,
			projectContextMode: "full",
			cacheRetention: resolveCacheRetentionSetting(options.settings.get("prompt.cache.subagentRetention")),
		};
	}

	return {
		role,
		projectContextMode: options.settings.get("prompt.mainContextMode") ?? "compact",
		cacheRetention: resolveCacheRetentionSetting(options.settings.get("prompt.cache.orchestratorRetention")),
	};
}
