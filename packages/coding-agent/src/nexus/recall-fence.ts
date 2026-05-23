export const RECALL_FENCE_OPEN = "<nexus-recall>";
export const RECALL_FENCE_CLOSE = "</nexus-recall>";

const FENCE_RE = /<\/?nexus-recall>/gi;

/**
 * Strip any literal recall fence tags from arbitrary text (user input, tool output, recall body).
 *
 * Applied as a fixpoint loop so that nested constructions like
 * `<nexus-recall<nexus-recall>>` cannot reassemble a literal tag after a single
 * `replace` pass. `String.prototype.replace` does NOT re-scan over removed
 * regions, so a one-shot strip can leave the very token it was supposed to
 * neutralize.
 */
export function stripRecallFences(input: string): string {
	if (!input) return input;
	let prev = input;
	let next = input.replace(FENCE_RE, "");
	while (next !== prev) {
		prev = next;
		next = next.replace(FENCE_RE, "");
	}
	return next;
}

/**
 * Wrap a recall block so the resulting payload contains exactly one open/close
 * pair. The body is sanitized first so memory entries whose content carries a
 * literal fence cannot terminate the trust boundary early.
 */
export function wrapRecallBlock(text: string): string {
	const safeBody = stripRecallFences(text).trim();
	return `${RECALL_FENCE_OPEN}\n${safeBody}\n${RECALL_FENCE_CLOSE}`;
}
