/**
 * System prompt section layer.
 *
 * A small but real module boundary that owns the typed prompt data, the
 * default-empty additive seams, the shared-tail assembly, and the body
 * rendering helper previously inlined in `system-prompt.ts`. Re-exported here
 * so callers depend on the layer rather than individual files.
 */

export { assembleSharedTail, assembleSystemPromptBody } from "./assemble";
export { buildSystemPromptRenderData, emptyPromptAddenda, emptySharedTailSlots } from "./context";
export type { AlwaysApplyRule, SharedTailSlots, SystemPromptAddenda, SystemPromptRenderData } from "./types";
