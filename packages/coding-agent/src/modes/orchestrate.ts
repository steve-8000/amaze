import orchestrateNotice from "../prompts/system/orchestrate-notice.md" with { type: "text" };
import { createGradientHighlighter, type KeywordHighlighter } from "./gradient-highlight";
import { keywordInProse } from "./markdown-prose";

/**
 * "orchestrate" keyword support.
 *
 * Typing the standalone English word in the input editor paints it with a cool
 * teal→violet gradient ({@link highlightOrchestrate}); submitting a message that
 * mentions it appends a hidden {@link ORCHESTRATE_NOTICE} that switches the model
 * into multi-agent orchestration mode. We also treat clear Korean orchestration
 * phrasing centered on 오케스트레이터 / 오케스트레이션 (including common case
 * particles) as an orchestration trigger. Matching stays prose-aware and skips
 * code blocks, inline code spans, and XML/HTML sections.
 */

const KOREAN_PARTICLES =
	"(?:으로|로|은|는|이|가|을|를|과|와|도|에|에서|에게|께|한테|부터|까지|만|처럼|같이|조차|마저|뿐)?";
const ORCHESTRATE_PATTERN = `(?<!\\S)(?:orchestrate|오케스트레이터${KOREAN_PARTICLES}|오케스트레이션${KOREAN_PARTICLES})(?!\\S)`;

// Detection: the lowercase English keyword or the Korean orchestration terms, flanked by whitespace or a string edge.
// Non-global so `.test` stays stateless.
const ORCHESTRATE_WORD = new RegExp(ORCHESTRATE_PATTERN, "u");

/** Hidden system notice appended after a user message that mentions orchestration intent. */
export const ORCHESTRATE_NOTICE: string = orchestrateNotice.trim();

/**
 * Whether `text` contains clear orchestration intent in prose — never inside a
 * code block, inline code span, or XML/HTML section.
 */
export function containsOrchestrate(text: string): boolean {
	return keywordInProse(text, ORCHESTRATE_WORD);
}

/**
 * Highlight orchestration intent in `text` for editor display with a cool
 * teal→violet gradient (hue 150..280), visually distinct from ultrathink's
 * full-spectrum rainbow.
 */
export const highlightOrchestrate: KeywordHighlighter = createGradientHighlighter({
	probe: /orchestrate|오케스트레이터|오케스트레이션/,
	highlight: new RegExp(ORCHESTRATE_PATTERN, "gu"),
	stops: 14,
	hue: t => 150 + t * 130,
});
