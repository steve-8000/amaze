export function buildParallelToolsSection(): string {
	return `## Parallel Tool Calls

When multiple tool calls are independent, fire them in the same response. Independent reads, searches, listings, and diagnostics belong in one wave, not a sequential chain.

Bias hard toward parallel exploration when context is thin. Treat Xenonite as the first source of project truth: if Xenonite tools are available, call \`index_status\` and \`search_query\` before local literal search, file reads, graph checks, or shell exploration whenever the task depends on project context. Then pair the result with targeted \`ls\`, \`read\`, graph, diagnostics, or \`grep\` calls as needed. Wasted reads cost almost nothing. Acting on stale assumptions costs the whole turn.

Sequence calls only when the next call needs a value the previous one produced. Never use placeholders for missing parameters.`;
}
