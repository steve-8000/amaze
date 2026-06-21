import type { AgentMessage } from "@steve-8000/amaze-agent-core";
import type { ImageContent, TextContent, ToolResultMessage } from "@steve-8000/amaze-ai";
import {
	type ReduceContextOptions,
	reduceContextMessages,
} from "../extensions/builtin/compaction/context-reduction.ts";
import { buildCacheAlignmentPlan, type CacheAlignmentPlan } from "./cache-alignment.ts";

export type ContextOptimizerMode = "off" | "audit" | "optimize";

export interface ContextOptimizerSettings {
	enabled?: boolean;
	mode?: ContextOptimizerMode;
	compressToolResultsOverChars?: number;
	compressedToolResultHeadChars?: number;
	compressedToolResultTailChars?: number;
	preserveRecentMessages?: number;
	preserveRecentToolResults?: number;
	logAudit?: boolean;
}

export interface ContextOptimizerTransformAudit {
	phase: "tool-output-compression" | "rolling-window" | "cache-alignment";
	kind: string;
	beforeTokens: number;
	afterTokens: number;
	itemsChanged: number;
	reason: string;
}

export interface ContextOptimizerAudit {
	mode: ContextOptimizerMode;
	beforeTokens: number;
	afterTokens: number;
	tokensSaved: number;
	savedRatio: number;
	beforeMessages: number;
	afterMessages: number;
	transforms: ContextOptimizerTransformAudit[];
	cacheAlignment: {
		stablePrefixMessages: number;
		stablePrefixTokens: number;
		stablePrefixHash: string;
		reordered: false;
		barrierReason: CacheAlignmentPlan["barrierReason"];
	};
}

export interface ContextOptimizerResult {
	messages: AgentMessage[];
	audit: ContextOptimizerAudit;
	changed: boolean;
	warnings: string[];
}

const DEFAULT_COMPRESS_TOOL_RESULTS_OVER_CHARS = 4_000;
const DEFAULT_COMPRESSED_TOOL_RESULT_HEAD_CHARS = 800;
const DEFAULT_COMPRESSED_TOOL_RESULT_TAIL_CHARS = 400;
const DEFAULT_PRESERVE_RECENT_MESSAGES = 4;
const DEFAULT_PRESERVE_RECENT_TOOL_RESULTS = 2;

function approxTokens(text: string): number {
	if (!text) return 0;
	return Math.ceil(text.length / 4);
}

function textFromContent(content: (TextContent | ImageContent)[] | string | undefined): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	let out = "";
	for (const part of content) {
		if (part.type === "text") out += part.text;
	}
	return out;
}

function messageText(message: AgentMessage): string {
	if (message.role === "user") return textFromContent(message.content as string | (TextContent | ImageContent)[]);
	if (message.role === "toolResult") return textFromContent((message as ToolResultMessage).content);
	if (message.role === "assistant") {
		let out = "";
		for (const block of message.content) {
			if (block.type === "text") out += block.text;
			else if (block.type === "thinking") out += block.thinking;
			else if (block.type === "toolCall") out += `${block.name} ${JSON.stringify(block.arguments)}`;
		}
		return out;
	}
	if (message.role === "bashExecution") return `${message.command}\n${message.output}`;
	if (message.role === "custom") return textFromContent(message.content);
	if (message.role === "branchSummary") return message.summary;
	return "";
}

function estimateMessages(messages: AgentMessage[]): number {
	return messages.reduce((sum, message) => sum + approxTokens(messageText(message)), 0);
}

function readMode(settings?: ContextOptimizerSettings): ContextOptimizerMode {
	const envMode = process.env.AMAZE_CONTEXT_OPTIMIZER;
	if (envMode === "off" || envMode === "audit" || envMode === "optimize") return envMode;
	if (settings?.enabled === false) return "off";
	return settings?.mode ?? "optimize";
}

function replaceFirstTextContent(
	content: (TextContent | ImageContent)[],
	text: string,
): (TextContent | ImageContent)[] {
	let replaced = false;
	const next = content.map((part) => {
		if (!replaced && part.type === "text") {
			replaced = true;
			return { ...part, text } satisfies TextContent;
		}
		return part;
	});
	return replaced
		? next
		: ([{ type: "text", text } as TextContent, ...content] satisfies (TextContent | ImageContent)[]);
}

function buildCompressedToolText(original: string, options: { headChars: number; tailChars: number }): string {
	const head = original.slice(0, options.headChars).trimEnd();
	const tail = original.slice(Math.max(options.headChars, original.length - options.tailChars)).trimStart();
	const omittedChars = Math.max(0, original.length - head.length - tail.length);
	return [
		head,
		`[tool output compressed by native context optimizer — original_chars=${original.length}, omitted_chars=${omittedChars}]`,
		tail,
	]
		.filter((part) => part.length > 0)
		.join("\n\n");
}

function compressLargeToolResults(
	messages: AgentMessage[],
	settings: ContextOptimizerSettings | undefined,
): {
	messages: AgentMessage[];
	itemsChanged: number;
	tokensSaved: number;
	preservedErrors: number;
} {
	const threshold = Math.max(1, settings?.compressToolResultsOverChars ?? DEFAULT_COMPRESS_TOOL_RESULTS_OVER_CHARS);
	const headChars = Math.max(0, settings?.compressedToolResultHeadChars ?? DEFAULT_COMPRESSED_TOOL_RESULT_HEAD_CHARS);
	const tailChars = Math.max(0, settings?.compressedToolResultTailChars ?? DEFAULT_COMPRESSED_TOOL_RESULT_TAIL_CHARS);
	const preserveRecentMessages = Math.max(0, settings?.preserveRecentMessages ?? DEFAULT_PRESERVE_RECENT_MESSAGES);
	const limit = Math.max(0, messages.length - preserveRecentMessages);
	const next = messages.slice();
	let itemsChanged = 0;
	let tokensSaved = 0;
	let preservedErrors = 0;

	for (let i = 0; i < limit; i += 1) {
		const message = next[i];
		if (message.role !== "toolResult") continue;
		const toolResult = message as ToolResultMessage;
		const originalText = textFromContent(toolResult.content);
		if (originalText.length < threshold) continue;
		if (toolResult.isError) {
			preservedErrors += 1;
			continue;
		}
		const compressedText = buildCompressedToolText(originalText, { headChars, tailChars });
		const originalTokens = approxTokens(originalText);
		const compressedTokens = approxTokens(compressedText);
		if (compressedTokens >= originalTokens) continue;
		next[i] = {
			...toolResult,
			content: replaceFirstTextContent(toolResult.content, compressedText),
		};
		itemsChanged += 1;
		tokensSaved += originalTokens - compressedTokens;
	}

	return { messages: next, itemsChanged, tokensSaved, preservedErrors };
}

function emptyAudit(mode: ContextOptimizerMode, messages: AgentMessage[]): ContextOptimizerAudit {
	const tokens = estimateMessages(messages);
	const cacheAlignment = buildCacheAlignmentPlan(messages);
	return {
		mode,
		beforeTokens: tokens,
		afterTokens: tokens,
		tokensSaved: 0,
		savedRatio: 0,
		beforeMessages: messages.length,
		afterMessages: messages.length,
		transforms: [],
		cacheAlignment: {
			stablePrefixMessages: cacheAlignment.stablePrefixMessages,
			stablePrefixTokens: cacheAlignment.stablePrefixTokens,
			stablePrefixHash: cacheAlignment.stablePrefixHash,
			reordered: false,
			barrierReason: cacheAlignment.barrierReason,
		},
	};
}

function buildReductionOptions(settings: ContextOptimizerSettings | undefined): ReduceContextOptions {
	const preserveRecentMessages = Math.max(0, settings?.preserveRecentMessages ?? DEFAULT_PRESERVE_RECENT_MESSAGES);
	const preserveRecentToolResults = Math.max(
		0,
		settings?.preserveRecentToolResults ?? DEFAULT_PRESERVE_RECENT_TOOL_RESULTS,
	);
	return {
		collapse: {
			minGroupSize: 2,
			protectRecentMessages: preserveRecentMessages,
		},
		shrinkAssistant: false,
		clearToolResults: {
			keepRecent: preserveRecentToolResults,
		},
	};
}

export function optimizeAgentContextMessages(
	messages: AgentMessage[],
	settings?: ContextOptimizerSettings,
): ContextOptimizerResult {
	const mode = readMode(settings);
	if (mode === "off") {
		return { messages, audit: emptyAudit(mode, messages), changed: false, warnings: [] };
	}

	const beforeTokens = estimateMessages(messages);
	const cacheAlignment = buildCacheAlignmentPlan(messages);
	const compressed = compressLargeToolResults(messages, settings);
	const reduction = reduceContextMessages(compressed.messages, buildReductionOptions(settings));
	const optimizedMessages = mode === "audit" ? messages : reduction.messages;
	const afterTokens = mode === "audit" ? beforeTokens : estimateMessages(optimizedMessages);
	const tokensSaved = Math.max(0, beforeTokens - afterTokens);

	const transforms: ContextOptimizerTransformAudit[] = [];
	if (compressed.itemsChanged > 0) {
		transforms.push({
			phase: "tool-output-compression",
			kind: "compress-large-tool-results",
			beforeTokens,
			afterTokens: Math.max(0, beforeTokens - compressed.tokensSaved),
			itemsChanged: compressed.itemsChanged,
			reason: "large non-error tool results can preserve head/tail evidence with an explicit compression marker",
		});
	}
	if (reduction.groupsCollapsed > 0) {
		transforms.push({
			phase: "tool-output-compression",
			kind: "collapse-consecutive-tool-results",
			beforeTokens,
			afterTokens: Math.max(0, beforeTokens - compressed.tokensSaved - reduction.tokensSaved),
			itemsChanged: reduction.groupsCollapsed,
			reason: "consecutive read/grep/bash tool results can be represented by compact labels",
		});
	}
	if (reduction.toolResultsCleared > 0) {
		transforms.push({
			phase: "rolling-window",
			kind: "clear-old-tool-results",
			beforeTokens,
			afterTokens: Math.max(0, beforeTokens - compressed.tokensSaved - reduction.tokensSaved),
			itemsChanged: reduction.toolResultsCleared,
			reason: "older tool results are outside the protected recent window",
		});
	}
	if (compressed.preservedErrors > 0) {
		transforms.push({
			phase: "tool-output-compression",
			kind: "preserve-error-tool-results",
			beforeTokens,
			afterTokens: beforeTokens,
			itemsChanged: 0,
			reason: "error tool results are preserved verbatim to avoid hiding failure evidence",
		});
	}
	transforms.push({
		phase: "cache-alignment",
		kind: "stable-prefix-audit",
		beforeTokens: cacheAlignment.stablePrefixTokens,
		afterTokens: cacheAlignment.stablePrefixTokens,
		itemsChanged: 0,
		reason: `phase 3 records stable prefix hash=${cacheAlignment.stablePrefixHash} without reordering messages`,
	});

	const audit: ContextOptimizerAudit = {
		mode,
		beforeTokens,
		afterTokens,
		tokensSaved,
		savedRatio: beforeTokens > 0 ? tokensSaved / beforeTokens : 0,
		beforeMessages: messages.length,
		afterMessages: optimizedMessages.length,
		transforms,
		cacheAlignment: {
			stablePrefixMessages: cacheAlignment.stablePrefixMessages,
			stablePrefixTokens: cacheAlignment.stablePrefixTokens,
			stablePrefixHash: cacheAlignment.stablePrefixHash,
			reordered: false,
			barrierReason: cacheAlignment.barrierReason,
		},
	};

	if (settings?.logAudit || process.env.AMAZE_CONTEXT_OPTIMIZER_LOG === "1") {
		console.info(
			`[context-optimizer] mode=${mode} saved=${tokensSaved} before=${beforeTokens} after=${afterTokens} transforms=${transforms.length}`,
		);
	}

	return {
		messages: optimizedMessages,
		audit,
		changed: mode === "optimize" && tokensSaved > 0,
		warnings: [],
	};
}
