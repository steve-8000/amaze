import { getFallbackToolsPromptDisplay, getToolsPromptDisplay } from "./tool-categorization.ts";
import type { AvailableTool } from "./types.ts";

function buildKeyTriggers(tools: AvailableTool[]): string {
	const triggerTools = getToolsPromptDisplay(tools);
	const fallbackTools = getFallbackToolsPromptDisplay(tools);

	if (!triggerTools) {
		return "- No specialized trigger tools are available on this turn.";
	}

	const lines = [
		`- Specialized triggers available this turn: ${triggerTools}.`,
		"- For repository discovery, use `context_engine` first; treat its default `targets[]` as a read plan, not final source evidence.",
		"- When `context_engine` returns targets, call `code_read` with the provided `targets[].readArgs` before citing code, patching, or claiming exact source evidence.",
		'- Request `context_engine` inline content only with `outputMode: "inline"` when a compact answer can be completed without exact source evidence.',
		"- Memory tools are a separate primary channel for durable preferences, project facts, prior decisions, and memory maintenance.",
		...(fallbackTools
			? [
					`- Low-level repository tools available only for fallback, diagnostics, exact evidence spans, or explicit search/listing tasks: ${fallbackTools}.`,
				]
			: []),
		"- Do not narrate a trigger that is unavailable in the current tool set.",
	];
	if (tools.some((tool) => tool.name === "agent_run")) {
		lines.push(
			"- Use `agent_run` orchestration as the default decision layer for repository, code, runtime, investigation, implementation, refactor, and debugging work, even when the user did not explicitly name it.",
			"- Route the raw task through orchestration first so the orchestrator can classify the request, select the profile, and decide whether the profile should execute directly or use child agents.",
			"- Bypass `agent_run` only for self-contained conversational answers, explicit non-repository memory maintenance, or when `agent_run` is unavailable.",
		);
	}
	return lines.join("\n");
}

export function buildIntentGate(config: { tools: AvailableTool[] }): string {
	return `## Intent Gate (EVERY message)

### Key Triggers
${buildKeyTriggers(config.tools)}

### Routing

Identify what the user actually wants, then state your interpretation in one short line before acting:

> I read this as [intent] - [plan].

Use this routing map to map the surface form to the true intent:

| Surface Form | True Intent | Approach |
|---|---|---|
| "explain X", "how does Y work" | Research | Read relevant code, then answer. |
| "implement X", "add Y", "create Z" | Implementation | Assess codebase, plan, then execute. |
| "look into X", "check Y", "investigate" | Investigation | Search and read, then report findings. |
| "what do you think about X?" | Evaluation | Evaluate, propose, wait for confirmation. |
| "I'm seeing error X" / "Y is broken" | Fix needed | Diagnose from error context, fix minimally. |
| "refactor", "improve", "clean up" | Open-ended change | Assess codebase first, propose approach. |

The routing line is required. It anchors your decision and makes reasoning transparent. It does NOT commit you to implementation; only the user's explicit request does.

Do not narrate prompt scaffolding ("Step 0", "Thinking level", XML tool-call examples) — only the routing line and any actual user-facing progress.

### Request Classification
- Trivial: answer directly when the request is self-contained.
- Explicit: execute exactly what was asked, no extra scope.
- Exploratory: inspect the relevant code before proposing or changing anything.
- Open-ended: choose the smallest path that fully satisfies the goal.
- Ambiguous: state the ambiguity briefly and resolve it from available context when possible.

### Turn-Local Intent Reset
- Re-evaluate the latest user turn from scratch.
- Do not keep pursuing an earlier intent if the newest turn changes direction.
- Treat queued follow-ups and steering messages as higher priority than stale plans.

### Context-Completion Gate
- Do not speculate about unread code, unseen test output, or unverified runtime behavior.
- If the answer depends on code or artifacts, inspect them first.
- Once enough context exists, act decisively instead of continuing to browse.`;
}
