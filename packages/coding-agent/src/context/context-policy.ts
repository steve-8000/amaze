import type { SubagentLaunchSpec } from "../task/subagent-launch-spec";

export type AgentContextProfile = "main" | "contract";

export function allowExtensionContextHooks(profile: AgentContextProfile, launchSpec?: SubagentLaunchSpec): boolean {
	if (profile === "main") return true;
	return launchSpec?.extensions.allowContextHooks === true;
}
