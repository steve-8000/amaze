export function buildParallelToolsSection(): string {
	return `## Parallel Tool Calls

When multiple tool calls are independent, fire them in the same response. Independent reads, searches, listings, and diagnostics belong in one wave, not a sequential chain.

Repository-context exploration is the exception: do not parallelize \`index_status\`, \`search_query\`, \`code_read\`, or file reads when \`context_engine\` can answer the context question. Use one \`context_engine\` call first; it controls internal search, memory, FastContext selection, and bounded reads. If a concrete missing fact remains, ask \`context_engine\` again with that narrower target before manual fanout. Parallelize only independent diagnostics or validations after the needed context is known.

Sequence calls only when the next call needs a value the previous one produced. Never use placeholders for missing parameters.`;
}
