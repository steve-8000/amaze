/**
 * System prompt section layer: shared-tail assembly and body rendering.
 *
 * Owns rendering of the shared-system-prompt tail plus the helper that injects
 * that shared tail into the selected body template. This keeps the section layer
 * as the seam `buildSystemPrompt` calls instead of rendering template bodies
 * inline, while staying behavior-neutral.
 */

import { prompt } from "@steve-z8k/pi-utils";
import sharedSystemPromptTailTemplate from "../shared-system-prompt-tail.md" with { type: "text" };
import { emptySharedTailSlots } from "./context";
import type { SharedTailSlots, SystemPromptRenderData } from "./types";

/**
 * Render the selected system prompt body template with the shared tail.
 *
 * @param template Body template chosen by `buildSystemPrompt`.
 * @param data Typed render data shared by the body and tail templates.
 * @param sharedSystemPromptTail Rendered tail block to inject.
 * @returns The rendered, trimmed body block.
 */
export function assembleSystemPromptBody(
	template: string,
	data: SystemPromptRenderData,
	sharedSystemPromptTail: string,
): string {
	return prompt.render(template, { ...data, sharedSystemPromptTail }).trim();
}

/**
 * Render the shared-system-prompt tail and splice the (empty-by-default) slots
 * around it.
 *
 * @param data Typed render data for the tail template.
 * @param slots Optional lead/trail blocks. Defaults to empty, making this a
 *   pass-through over the rendered template.
 * @returns The assembled, trimmed shared tail block.
 */
export function assembleSharedTail(
	data: SystemPromptRenderData,
	slots: SharedTailSlots = emptySharedTailSlots(),
): string {
	const body = prompt.render(sharedSystemPromptTailTemplate, data).trim();
	const blocks = [...slots.lead, body, ...slots.trail].map(block => block.trim()).filter(block => block.length > 0);
	return blocks.join("\n\n").trim();
}
