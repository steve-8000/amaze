import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { NexusKnowledgeStore } from "./store";
import type {
	NexusKnowledgeIndexOptions,
	NexusKnowledgeIndexStats,
	NexusKnowledgeSymbolKind,
	NexusKnowledgeUpsertDocumentInput,
} from "./types";

const DEFAULT_MAX_FILES = 2_000;
const DEFAULT_MAX_FILE_BYTES = 512 * 1024;
const DEFAULT_CHUNK_MAX_LINES = 80;
const DEFAULT_CHUNK_MAX_CHARS = 8_000;

const SKIP_DIRS = new Set([
	".git",
	".hg",
	".svn",
	".idea",
	".vscode",
	"node_modules",
	"dist",
	"build",
	"coverage",
	".next",
	".nuxt",
	".turbo",
	".cache",
	"tmp",
	"temp",
	"vendor",
]);

const TEXT_EXTENSIONS = new Set([
	".ts",
	".tsx",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".json",
	".md",
	".mdx",
	".txt",
	".yml",
	".yaml",
	".toml",
	".css",
	".scss",
	".html",
	".xml",
	".sh",
	".py",
	".rb",
	".go",
	".rs",
	".java",
	".kt",
	".swift",
	".c",
	".h",
	".cpp",
	".hpp",
]);

const CODE_EXTENSIONS = new Set([
	".ts",
	".tsx",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".mts",
	".cts",
]);

const LANGUAGE_BY_EXTENSION = new Map<string, string>([
	[".ts", "typescript"],
	[".tsx", "tsx"],
	[".js", "javascript"],
	[".jsx", "jsx"],
	[".mjs", "javascript"],
	[".cjs", "javascript"],
	[".json", "json"],
	[".md", "markdown"],
	[".mdx", "mdx"],
	[".yml", "yaml"],
	[".yaml", "yaml"],
]);

interface DiscoveredFile {
	absolutePath: string;
	relativePath: string;
	size: number;
}

interface SymbolCandidate {
	name: string;
	kind: NexusKnowledgeSymbolKind;
	exported: boolean;
	line: number;
	column: number;
	signature: string;
}

export async function indexNexusRepository(options: NexusKnowledgeIndexOptions): Promise<NexusKnowledgeIndexStats> {
	const repoRoot = path.resolve(options.repoRoot ?? options.cwd);
	const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
	const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
	const chunkMaxLines = options.chunkMaxLines ?? DEFAULT_CHUNK_MAX_LINES;
	const chunkMaxChars = options.chunkMaxChars ?? DEFAULT_CHUNK_MAX_CHARS;
	const store = new NexusKnowledgeStore({ agentDir: options.agentDir, cwd: options.cwd });
	try {
		const discovered = await discoverRepositoryFiles(repoRoot, { maxFiles, maxFileBytes });
		const stats: NexusKnowledgeIndexStats = {
			repoRoot,
			discoveredFiles: discovered.length,
			indexedFiles: 0,
			skippedFiles: 0,
			chunks: 0,
			symbols: 0,
		};
		for (const file of discovered) {
			const content = await fs.readFile(file.absolutePath, "utf8").catch(() => null);
			if (content === null || !looksTextual(content)) {
				stats.skippedFiles++;
				continue;
			}
			const extension = path.extname(file.relativePath).toLowerCase();
			const chunks = chunkContent(content, { maxLines: chunkMaxLines, maxChars: chunkMaxChars });
			const symbols = CODE_EXTENSIONS.has(extension) ? extractJsTsSymbols(content) : [];
			const input: NexusKnowledgeUpsertDocumentInput = {
				repoRoot,
				path: normalizeRelativePath(file.relativePath),
				absolutePath: file.absolutePath,
				kind: CODE_EXTENSIONS.has(extension) ? "code" : "text",
				language: (LANGUAGE_BY_EXTENSION.get(extension) ?? extension.slice(1)) || null,
				contentHash: hashText(content),
				sizeBytes: Buffer.byteLength(content),
				chunks,
				symbols,
			};
			store.upsertDocument(input);
			stats.indexedFiles++;
			stats.chunks += chunks.length;
			stats.symbols += symbols.length;
		}
		return stats;
	} finally {
		store.close();
	}
}

export async function discoverRepositoryFiles(
	repoRoot: string,
	options: { maxFiles?: number; maxFileBytes?: number } = {},
): Promise<DiscoveredFile[]> {
	const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
	const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
	const files: DiscoveredFile[] = [];
	async function visit(dir: string): Promise<void> {
		if (files.length >= maxFiles) return;
		const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
		entries.sort((left, right) => left.name.localeCompare(right.name));
		for (const entry of entries) {
			if (files.length >= maxFiles) return;
			if (entry.name.startsWith(".") && SKIP_DIRS.has(entry.name)) continue;
			const absolutePath = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				if (SKIP_DIRS.has(entry.name)) continue;
				await visit(absolutePath);
				continue;
			}
			if (!entry.isFile()) continue;
			const extension = path.extname(entry.name).toLowerCase();
			if (!TEXT_EXTENSIONS.has(extension)) continue;
			const stat = await fs.stat(absolutePath).catch(() => null);
			if (!stat || stat.size > maxFileBytes) continue;
			files.push({
				absolutePath,
				relativePath: path.relative(repoRoot, absolutePath),
				size: stat.size,
			});
		}
	}
	await visit(repoRoot);
	return files;
}

export function chunkContent(
	content: string,
	options: { maxLines?: number; maxChars?: number } = {},
): NexusKnowledgeUpsertDocumentInput["chunks"] {
	const maxLines = options.maxLines ?? DEFAULT_CHUNK_MAX_LINES;
	const maxChars = options.maxChars ?? DEFAULT_CHUNK_MAX_CHARS;
	const lines = content.split("\n");
	const chunks: NexusKnowledgeUpsertDocumentInput["chunks"] = [];
	let start = 0;
	while (start < lines.length) {
		let end = start;
		let chars = 0;
		while (end < lines.length && end - start < maxLines && chars + (lines[end]?.length ?? 0) <= maxChars) {
			chars += (lines[end]?.length ?? 0) + 1;
			end++;
		}
		if (end === start) end++;
		const chunkLines = lines.slice(start, end);
		const contentHash = hashText(chunkLines.join("\n"));
		chunks.push({
			chunkIndex: chunks.length,
			startLine: start + 1,
			endLine: end,
			content: chunkLines.join("\n"),
			contentHash,
		});
		start = end;
	}
	return chunks;
}

export function extractJsTsSymbols(content: string): SymbolCandidate[] {
	const symbols: SymbolCandidate[] = [];
	const seen = new Set<string>();
	const patterns: { kind: NexusKnowledgeSymbolKind; regex: RegExp; nameGroup: number }[] = [
		{ kind: "function", regex: /^(\s*)(export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)/, nameGroup: 3 },
		{ kind: "class", regex: /^(\s*)(export\s+)?class\s+([A-Za-z_$][\w$]*)\b/, nameGroup: 3 },
		{ kind: "interface", regex: /^(\s*)(export\s+)?interface\s+([A-Za-z_$][\w$]*)\b/, nameGroup: 3 },
		{ kind: "type", regex: /^(\s*)(export\s+)?type\s+([A-Za-z_$][\w$]*)\b/, nameGroup: 3 },
		{
			kind: "const",
			regex: /^(\s*)(export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)(?:\s*:\s*[^=]+?)?\s*=>|[A-Za-z_$][\w$]*(?:\s*:\s*[^=]+?)?\s*=>)/,
			nameGroup: 3,
		},
		{
			kind: "let",
			regex: /^(\s*)(export\s+)?let\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)(?:\s*:\s*[^=]+?)?\s*=>|[A-Za-z_$][\w$]*(?:\s*:\s*[^=]+?)?\s*=>)/,
			nameGroup: 3,
		},
		{
			kind: "var",
			regex: /^(\s*)(export\s+)?var\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)(?:\s*:\s*[^=]+?)?\s*=>|[A-Za-z_$][\w$]*(?:\s*:\s*[^=]+?)?\s*=>)/,
			nameGroup: 3,
		},
	];
	const lines = content.split("\n");
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index] ?? "";
		for (const pattern of patterns) {
			const match = pattern.regex.exec(line);
			if (!match) continue;
			const name = match[pattern.nameGroup] ?? "";
			const key = `${name}:${pattern.kind}:${index + 1}`;
			if (!name || seen.has(key)) continue;
			seen.add(key);
			symbols.push({
				name,
				kind: pattern.kind,
				exported: Boolean(match[2]),
				line: index + 1,
				column: line.indexOf(name) + 1,
				signature: line.trim(),
			});
			break;
		}
	}
	return symbols;
}

function normalizeRelativePath(filePath: string): string {
	return filePath.split(path.sep).join("/");
}

function looksTextual(content: string): boolean {
	if (content.includes("\0")) return false;
	if (content.length === 0) return true;
	let suspicious = 0;
	const sample = content.slice(0, 4096);
	for (const char of sample) {
		const code = char.charCodeAt(0);
		if (code < 7 || (code > 14 && code < 32)) suspicious++;
	}
	return suspicious / sample.length < 0.02;
}

function hashText(text: string): string {
	return crypto.createHash("sha256").update(text).digest("hex");
}
