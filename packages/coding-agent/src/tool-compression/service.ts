import type { AfterToolCallContext, AfterToolCallResult } from "@amaze/agent-core";
import type { TextContent } from "@amaze/ai";
import type { Settings } from "../config/settings";
import type { OutputMeta } from "../tools/output-meta";
import { formatOutputNotice } from "../tools/output-meta";
import type { SessionManager } from "../session/session-manager";
import type { ToolCompressionMetadata, ToolCompressionSettings, CompressionOutcome, PreservedSuffix } from "./types";

const RAW_OUTPUT_FOOTER_RE = /\[raw output: artifact:\/\/(\d+)\]\s*$/;
const COMPRESSED_OUTPUT_FOOTER_RE = /\[compressed output: artifact:\/\/(\d+)\]\s*$/;
const SEARCH_LINE_RE = /^(\*| )(\d+(?:[a-z]{2})?)\|(.*)$/;
const SEARCH_DIR_HEADER_RE = /^#\s+.+$/;
const SEARCH_FILE_HEADER_RE = /^##\s+.+$/;
const LOG_ERROR_RE = /\b(error|fatal|failed|exception|traceback|panic)\b/i;
const LOG_WARN_RE = /\b(warn|warning)\b/i;
const LOG_SUMMARY_RE = /\b(passed|failed|skipped|error|warning|summary|total)\b/i;
const BLOCK_SEPARATOR_RE = /^\s*$/;

interface SearchSection {
	headers: string[];
	matchLines: string[];
	otherLines: string[];
	score: number;
}

function isTextBlock(block: { type: string }): block is TextContent {
	return block.type === "text";
}

function extractJoinedText(result: AfterToolCallContext["result"]): string | null {
	const textBlocks = result.content.filter(isTextBlock);
	if (textBlocks.length === 0) return null;
	return textBlocks.map(block => block.text).join("\n");
}

function countLines(text: string): number {
	if (text.length === 0) return 0;
	return text.split("\n").length;
}

function byteLength(text: string): number {
	return Buffer.byteLength(text, "utf-8");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildSettings(settings: Settings): ToolCompressionSettings {
	return {
		enabled: settings.get("toolCompression.enabled"),
		minimumBytes: settings.get("toolCompression.minimumBytes"),
		search: {
			enabled: settings.get("toolCompression.search.enabled"),
			maxFiles: settings.get("toolCompression.search.maxFiles"),
			maxMatchesPerFile: settings.get("toolCompression.search.maxMatchesPerFile"),
		},
		bash: {
			enabled: settings.get("toolCompression.bash.enabled"),
		},
		log: {
			maxErrorBlocks: settings.get("toolCompression.log.maxErrorBlocks"),
			maxWarningFamilies: settings.get("toolCompression.log.maxWarningFamilies"),
			maxTotalLines: settings.get("toolCompression.log.maxTotalLines"),
		},
	};
}

function splitPreservedSuffix(text: string, meta: OutputMeta | undefined): PreservedSuffix {
	let body = text;
	let suffix = "";
	let existingArtifactId: string | undefined;
	let rawArtifactId: string | undefined;
	const metaNotice = formatOutputNotice(meta);
	if (metaNotice) {
		const trimmedText = body.trimEnd();
		const trimmedNotice = metaNotice.trimEnd();
		if (trimmedText.endsWith(trimmedNotice)) {
			body = trimmedText.slice(0, -trimmedNotice.length);
			suffix = trimmedNotice;
		} else {
			body = text;
		}
	}
	const rawMatch = RAW_OUTPUT_FOOTER_RE.exec(body.trimEnd());
	if (rawMatch) {
		rawArtifactId = rawMatch[1];
		const trimmed = body.trimEnd();
		const footerStart = trimmed.lastIndexOf(rawMatch[0]);
		body = trimmed.slice(0, footerStart).trimEnd();
		suffix = suffix.length > 0 ? `${suffix}\n\n${rawMatch[0].trim()}` : rawMatch[0].trim();
	}
	const compressedMatch = COMPRESSED_OUTPUT_FOOTER_RE.exec(body.trimEnd());
	if (compressedMatch) {
		const trimmed = body.trimEnd();
		const footerStart = trimmed.lastIndexOf(compressedMatch[0]);
		body = trimmed.slice(0, footerStart).trimEnd();
		suffix = suffix.length > 0 ? `${suffix}\n\n${compressedMatch[0].trim()}` : compressedMatch[0].trim();
	}
	existingArtifactId = meta?.truncation?.artifactId;
	return { body, suffix, rawArtifactId, existingArtifactId };
}

function finalizeText(body: string, suffix: string, artifactId: string): string {
	const parts = [body.trimEnd()];
	if (suffix.trim().length > 0) parts.push(suffix.trim());
	parts.push(`[compressed output: artifact://${artifactId}]`);
	return parts.filter(part => part.length > 0).join("\n\n");
}

function scoreSearchLine(line: string): number {
	let score = 0;
	if (LOG_ERROR_RE.test(line)) score += 5;
	if (line.startsWith("*")) score += 3;
	score += Math.min(2, Math.floor(line.length / 80));
	return score;
}

function compressSearch(text: string, settings: ToolCompressionSettings): CompressionOutcome | null {
	const lines = text.split("\n");
	const sections: SearchSection[] = [];
	let currentHeaders: string[] = [];
	let currentLines: string[] = [];
	const flush = () => {
		if (currentLines.length === 0 && currentHeaders.length === 0) return;
		const matchLines = currentLines.filter(line => SEARCH_LINE_RE.test(line));
		const otherLines = currentLines.filter(line => !SEARCH_LINE_RE.test(line));
		sections.push({
			headers: [...currentHeaders],
			matchLines,
			otherLines,
			score: matchLines.reduce((sum, line) => sum + scoreSearchLine(line), 0),
		});
		currentLines = [];
	};
	for (const line of lines) {
		if (SEARCH_DIR_HEADER_RE.test(line) || SEARCH_FILE_HEADER_RE.test(line)) {
			flush();
			currentHeaders = [line];
			continue;
		}
		currentLines.push(line);
	}
	flush();
	if (sections.length === 0) return null;
	const keptSections = sections
		.slice()
		.sort((a, b) => b.score - a.score)
		.slice(0, settings.search.maxFiles)
		.sort((a, b) => sections.indexOf(a) - sections.indexOf(b));
	const renderedLines: string[] = [];
	for (const section of keptSections) {
		if (renderedLines.length > 0) renderedLines.push("");
		renderedLines.push(...section.headers);
		renderedLines.push(...section.matchLines.slice(0, settings.search.maxMatchesPerFile));
	}
	const compressedText = renderedLines.join("\n").trim();
	if (compressedText.length === 0 || compressedText.length >= text.trim().length) return null;
	return { kind: "search", text: compressedText, reason: "retained highest-signal search matches" };
}

function splitBlocks(text: string): string[] {
	const lines = text.split("\n");
	const blocks: string[] = [];
	let current: string[] = [];
	for (const line of lines) {
		if (BLOCK_SEPARATOR_RE.test(line)) {
			if (current.length > 0) {
				blocks.push(current.join("\n"));
				current = [];
			}
			continue;
		}
		current.push(line);
	}
	if (current.length > 0) blocks.push(current.join("\n"));
	return blocks;
}

function scoreLogBlock(block: string): number {
	let score = 0;
	if (LOG_ERROR_RE.test(block)) score += 8;
	if (LOG_WARN_RE.test(block)) score += 4;
	if (LOG_SUMMARY_RE.test(block)) score += 3;
	score += Math.min(3, Math.floor(block.length / 300));
	return score;
}

function compressLog(text: string, settings: ToolCompressionSettings): CompressionOutcome | null {
	const blocks = splitBlocks(text);
	if (blocks.length < 2) return null;
	const scored = blocks.map((block, index) => ({ block, index, score: scoreLogBlock(block) }));
	const kept = scored
		.filter(entry => entry.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, settings.log.maxErrorBlocks + settings.log.maxWarningFamilies)
		.sort((a, b) => a.index - b.index);
	if (kept.length === 0) return null;
	const compressedText = kept.map(entry => entry.block).join("\n\n");
	if (compressedText.length >= text.trim().length) return null;
	const limitedLines = compressedText.split("\n").slice(0, settings.log.maxTotalLines).join("\n");
	return { kind: "log", text: limitedLines, reason: "retained high-signal log blocks" };
}

function compressGeneric(text: string): CompressionOutcome | null {
	const blocks = splitBlocks(text);
	if (blocks.length < 3) return null;
	const kept = [blocks[0], ...blocks.slice(1, -1).filter(block => LOG_ERROR_RE.test(block)).slice(0, 2), blocks[blocks.length - 1]];
	const unique = Array.from(new Set(kept));
	const compressedText = unique.join("\n\n");
	if (compressedText.length >= text.trim().length) return null;
	return { kind: "generic", text: compressedText, reason: "collapsed repeated middle blocks" };
}

async function ensureArtifactId(
	sessionManager: SessionManager,
	preferredExistingId: string | undefined,
	fullText: string,
	toolName: string,
): Promise<{ artifactId?: string; sourceArtifact?: ToolCompressionMetadata["sourceArtifact"] }> {
	if (preferredExistingId) {
		return { artifactId: preferredExistingId, sourceArtifact: "reused-existing" };
	}
	const artifactId = await sessionManager.saveArtifact(fullText, `${toolName}-original`);
	if (!artifactId) return {};
	return { artifactId, sourceArtifact: "saved-new" };
}

export async function compressToolResult(
	ctx: AfterToolCallContext,
	sessionManager: SessionManager,
	settings: Settings,
): Promise<AfterToolCallResult | undefined> {
	const compressionSettings = buildSettings(settings);
	if (!compressionSettings.enabled) return undefined;
	if (ctx.toolCall.name !== "search" && ctx.toolCall.name !== "bash") return undefined;
	const originalText = extractJoinedText(ctx.result);
	if (!originalText) return undefined;
	if (byteLength(originalText) < compressionSettings.minimumBytes) return undefined;
	const detailObject = isPlainObject(ctx.result.details) ? ctx.result.details : undefined;
	const meta = detailObject?.meta as OutputMeta | undefined;
	const preserved = splitPreservedSuffix(originalText, meta);
	const body = preserved.body.trim();
	if (body.length === 0) return undefined;
	const isSearch = ctx.toolCall.name === "search" && compressionSettings.search.enabled;
	const isLog = ctx.toolCall.name === "bash" && compressionSettings.bash.enabled;
	const outcome = isSearch
		? compressSearch(body, compressionSettings)
		: isLog
			? compressLog(body, compressionSettings) ?? compressGeneric(body)
			: null;
	if (!outcome) return undefined;
	const artifactInfo = await ensureArtifactId(
		sessionManager,
		preserved.existingArtifactId ?? preserved.rawArtifactId,
		originalText,
		ctx.toolCall.name,
	);
	if (!artifactInfo.artifactId || !artifactInfo.sourceArtifact) return undefined;
	const finalText = finalizeText(outcome.text, preserved.suffix, artifactInfo.artifactId);
	if (byteLength(finalText) >= byteLength(originalText)) return undefined;
	const nextDetails = detailObject ? { ...detailObject } : {};
	nextDetails.compression = {
		applied: true,
		kind: outcome.kind,
		originalBytes: byteLength(originalText),
		compressedBytes: byteLength(finalText),
		originalLines: countLines(originalText),
		compressedLines: countLines(finalText),
		artifactId: artifactInfo.artifactId,
		sourceArtifact: artifactInfo.sourceArtifact,
		reason: outcome.reason,
	};
	return {
		content: [{ type: "text", text: finalText }],
		details: nextDetails,
	};
}
