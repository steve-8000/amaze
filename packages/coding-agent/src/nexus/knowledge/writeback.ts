import * as path from "node:path";
import { chunkContent, extractJsTsSymbols } from "./indexer";
import type { NexusKnowledgeStore } from "./store";
import type { NexusKnowledgeDocumentKind, NexusKnowledgeUpsertDocumentInput } from "./types";

export interface NexusKnowledgeWritebackRequest {
	repoRoot: string;
	repoPath: string;
	content: string;
	kind?: NexusKnowledgeDocumentKind;
	language?: string | null;
	provenance: {
		source: "manual" | "maintenance";
		reason: string;
	};
	chunkMaxLines?: number;
	chunkMaxChars?: number;
}

export type NexusKnowledgeWritebackValidationResult =
	| { ok: true; input: NexusKnowledgeUpsertDocumentInput }
	| { ok: false; error: string };

const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]);

export function validateNexusKnowledgeWriteback(
	request: NexusKnowledgeWritebackRequest,
): NexusKnowledgeWritebackValidationResult {
	const repoRoot = path.resolve(request.repoRoot);
	const repoPath = normalizeRepoPath(request.repoPath);
	const absolutePath = path.resolve(repoRoot, repoPath);
	if (!repoPath || repoPath.startsWith("../") || path.relative(repoRoot, absolutePath).startsWith("..")) {
		return { ok: false, error: "repoPath must stay within repoRoot." };
	}
	if (!request.content.trim()) return { ok: false, error: "content must be non-empty." };
	if (!request.provenance.reason.trim()) return { ok: false, error: "provenance.reason must be non-empty." };
	const extension = path.extname(repoPath).toLowerCase();
	const kind = request.kind ?? (CODE_EXTENSIONS.has(extension) ? "code" : "text");
	const language = request.language ?? (extension ? extension.slice(1) : null);
	const symbols = kind === "code" ? extractJsTsSymbols(request.content) : [];
	const chunks = chunkContent(request.content, {
		maxLines: request.chunkMaxLines,
		maxChars: request.chunkMaxChars,
		language,
		kind,
		symbols,
	});
	return {
		ok: true,
		input: {
			repoRoot,
			path: repoPath,
			absolutePath,
			kind,
			language,
			contentHash: Bun.hash(request.content).toString(16),
			sizeBytes: Buffer.byteLength(request.content),
			chunks,
			symbols,
		},
	};
}

export function applyNexusKnowledgeWriteback(
	store: NexusKnowledgeStore,
	request: NexusKnowledgeWritebackRequest,
): NexusKnowledgeWritebackValidationResult {
	const validation = validateNexusKnowledgeWriteback(request);
	if (!validation.ok) return validation;
	store.upsertDocument(validation.input);
	return validation;
}

function normalizeRepoPath(repoPath: string): string {
	return repoPath.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}
