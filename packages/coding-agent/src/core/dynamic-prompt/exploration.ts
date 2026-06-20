import { hasXenoniteProjectTools } from "./tool-categorization.ts";
import type { AvailableTool } from "./types.ts";

export function buildExplorationSection(tools: AvailableTool[] = []): string {
	const xenoniteFirst = hasXenoniteProjectTools(tools)
		? `
### Xenonite-first project intelligence

When the task depends on repository context, start with the narrowest Xenonite path:
- If the user named exact files, call \`context_engine\` once with those file hints; it will exact-read bounded ranges without model exploration.
- If the location is unknown, call \`context_engine\` once with the task; it will handle internal search, memory selection, FastContext ranking, and bounded reads.
- Stop when \`context_engine.assessment.shouldReadMore\` is false unless synthesis reveals a concrete missing fact.
- If more repository evidence is needed, call \`context_engine\` again with that missing fact, narrower file/symbol hints, or adjusted budget instead of manually fanning out \`code_read\`, \`search_query\`, \`index_status\`, or file-read calls.
- Use \`code_read\`, \`search_query\`, graph tools, or \`raw_read\` only as fallback after \`context_engine\` is unavailable or returns \`ok: false\`.

Do not manually fan out \`index_status\` + \`search_query\` from the main model; Xenonite Core owns that policy internally.`
		: "";
	return `## Exploration

Use tools whenever they materially improve correctness. Memory of file contents is unreliable; when repository context is needed and \`context_engine\` is available, call it once before claiming or editing code/text.

Stop searching when the selected context answers the core question, a bounded read proves the needed fact, or context_engine says shouldReadMore is false. Launch another read only when synthesis surfaced a concrete missing fact, never as a "just to be sure" sweep.${xenoniteFirst}`;
}
