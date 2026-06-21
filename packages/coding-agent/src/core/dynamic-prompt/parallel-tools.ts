import { hasXenoniteProjectTools } from "./tool-categorization.ts";
import type { AvailableTool } from "./types.ts";

export function buildParallelToolsSection(tools: AvailableTool[] = []): string {
	const repoContextException = hasXenoniteProjectTools(tools)
		? `Repository-context exploration is the exception: do not parallelize \`index_status\`, \`search_query\`, \`code_read\`, or file reads when \`context_engine\` can answer the context question. Use one \`context_engine\` call first; it controls internal search, FastContext selection, and bounded reads. If a concrete missing fact remains, ask \`context_engine\` again with that narrower target before manual fanout. Parallelize only independent diagnostics or validations after the needed context is known.`
		: `Repository-context exploration is the exception: start with the highest-level repository context tool available, then fan out into exact reads or diagnostics only if a concrete missing fact remains. Do not restart broad exploration or repeat the same file/range reads once the current evidence is enough to answer.`;
	return `## Parallel Tool Calls

When multiple tool calls are independent, fire them in the same response. Independent reads, searches, listings, and diagnostics belong in one wave, not a sequential chain.

${repoContextException}

Sequence calls only when the next call needs a value the previous one produced. Never use placeholders for missing parameters.`;
}
