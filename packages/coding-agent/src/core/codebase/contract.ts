export const CODEBASE_MEMORY_NATIVE_TOOL_NAMES = [
	"index_repository",
	"search_graph",
	"query_graph",
	"trace_path",
	"get_code_snippet",
	"get_graph_schema",
	"get_architecture",
	"search_code",
	"list_projects",
	"delete_project",
	"index_status",
	"detect_changes",
	"manage_adr",
	"ingest_traces",
] as const;

export const CODEBASE_MEMORY_NATIVE_TOOL_ALIASES = ["trace_call_path"] as const;

export const AMAZE_LEGACY_CODEBASE_TOOL_NAMES = [
	"index_repository",
	"list_projects",
	"index_status",
	"delete_project",
	"detect_changes",
	"get_architecture",
	"search_graph",
	"search_code",
	"get_code_snippet",
] as const;

export const AMAZE_SKILL_TOOL_NAMES = ["skill_search", "skill_get", "put_skill", "delete_skill"] as const;

export const AMAZE_CODEBASE_TOOL_NAMES = [...AMAZE_LEGACY_CODEBASE_TOOL_NAMES, ...AMAZE_SKILL_TOOL_NAMES] as const;

export type CodebaseMemoryNativeToolName = (typeof CODEBASE_MEMORY_NATIVE_TOOL_NAMES)[number];
export type CodebaseMemoryNativeToolAlias = (typeof CODEBASE_MEMORY_NATIVE_TOOL_ALIASES)[number];
export type CodebaseMemoryNativeCallableToolName = CodebaseMemoryNativeToolName | CodebaseMemoryNativeToolAlias;
export type AmazeLegacyCodebaseToolName = (typeof AMAZE_LEGACY_CODEBASE_TOOL_NAMES)[number];
export type AmazeSkillToolName = (typeof AMAZE_SKILL_TOOL_NAMES)[number];
export type AmazeCodebaseToolName = (typeof AMAZE_CODEBASE_TOOL_NAMES)[number];
