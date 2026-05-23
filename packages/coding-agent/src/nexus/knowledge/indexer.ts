import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { NexusKnowledgeStore } from "./store";
import type {
	NexusKnowledgeIndexOptions,
	NexusKnowledgeIndexStats,
	NexusKnowledgeSymbol,
	NexusKnowledgeSymbolKind,
	NexusKnowledgeUpsertDocumentInput,
} from "./types";

const DEFAULT_MAX_FILES = 2_000;
const DEFAULT_MAX_FILE_BYTES = 512 * 1024;
const DEFAULT_CHUNK_MAX_LINES = 80;
const DEFAULT_CHUNK_MAX_CHARS = 8_000;
const CHUNK_OVERLAP_LINES = 3;

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

const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]);
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

interface SymbolCandidate extends Omit<NexusKnowledgeSymbol, "id" | "documentId" | "path"> {}

interface ScopeRange {
	name: string;
	startLine: number;
	endLine: number;
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
			unchangedFiles: 0,
			prunedFiles: 0,
			readErrors: 0,
			chunks: 0,
			symbols: 0,
		};
		const existingPaths = new Set(store.listDocumentPaths(repoRoot));
		for (const file of discovered) {
			const relativePath = normalizeRelativePath(file.relativePath);
			existingPaths.delete(relativePath);
			const content = await fs.readFile(file.absolutePath, "utf8").catch(() => null);
			if (content === null) {
				stats.readErrors++;
				continue;
			}
			if (!looksTextual(content)) {
				stats.skippedFiles++;
				continue;
			}
			const extension = path.extname(relativePath).toLowerCase();
			const language = (LANGUAGE_BY_EXTENSION.get(extension) ?? extension.slice(1)) || null;
			const kind = CODE_EXTENSIONS.has(extension) ? "code" : "text";
			const contentHash = hashText(content);
			const sizeBytes = Buffer.byteLength(content);
			const existing = store.getDocumentByRepoPath(repoRoot, relativePath);
			if (existing && existing.contentHash === contentHash && existing.sizeBytes === sizeBytes) {
				stats.unchangedFiles++;
				continue;
			}
			const symbols = CODE_EXTENSIONS.has(extension) ? extractJsTsSymbols(content) : [];
			const chunks = chunkContent(content, {
				maxLines: chunkMaxLines,
				maxChars: chunkMaxChars,
				language,
				kind,
				symbols,
			});
			const input: NexusKnowledgeUpsertDocumentInput = {
				repoRoot,
				path: relativePath,
				absolutePath: file.absolutePath,
				kind,
				language,
				contentHash,
				sizeBytes,
				chunks,
				symbols,
			};
			store.upsertDocument(input);
			stats.indexedFiles++;
			stats.chunks += chunks.length;
			stats.symbols += symbols.length;
		}
		if (existingPaths.size > 0) {
			stats.prunedFiles = store.deleteDocumentsByPath(repoRoot, [...existingPaths]);
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
	options: {
		maxLines?: number;
		maxChars?: number;
		language?: string | null;
		kind?: "code" | "text";
		symbols?: SymbolCandidate[];
	} = {},
): NexusKnowledgeUpsertDocumentInput["chunks"] {
	const maxLines = options.maxLines ?? DEFAULT_CHUNK_MAX_LINES;
	const maxChars = options.maxChars ?? DEFAULT_CHUNK_MAX_CHARS;
	const lines = content.split("\n");
	const ranges = buildChunkRanges(lines, {
		maxLines,
		maxChars,
		isMarkdown: options.language === "markdown" || options.language === "mdx",
		symbols: options.kind === "code" ? (options.symbols ?? []) : [],
	});
	return ranges.map((range, chunkIndex) => {
		const chunkLines = lines.slice(range.startLine - 1, range.endLine);
		return {
			chunkIndex,
			startLine: range.startLine,
			endLine: range.endLine,
			content: chunkLines.join("\n"),
			contentHash: hashText(chunkLines.join("\n")),
		};
	});
}

export function extractJsTsSymbols(content: string): SymbolCandidate[] {
	const lines = content.split("\n");
	const classScopes = collectScopedBlocks(lines, /^(\s*)(export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)\b/, 3);
	const objectScopes = collectScopedBlocks(
		lines,
		/^(\s*)(export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\{/,
		3,
	);
	const symbols: SymbolCandidate[] = [];
	const seen = new Set<string>();

	for (let index = 0; index < lines.length; index++) {
		const line = lines[index] ?? "";
		const lineNumber = index + 1;
		const trimmed = line.trim();
		if (!trimmed) continue;

		const currentClass = activeScopeForLine(classScopes, lineNumber);
		const currentObject = activeScopeForLine(objectScopes, lineNumber);

		const add = (candidate: SymbolCandidate): void => {
			const key = `${candidate.parentSymbol ?? ""}:${candidate.name}:${candidate.kind}:${candidate.line}`;
			if (seen.has(key)) return;
			seen.add(key);
			symbols.push(candidate);
		};

		let matched = false;
		for (const pattern of DECLARATION_PATTERNS) {
			const match = pattern.regex.exec(line);
			if (!match) continue;
			const name = match[pattern.nameGroup] ?? "";
			if (!name) continue;
			add({
				name,
				kind: pattern.kind,
				exported: Boolean(match[2] || pattern.forceExported),
				line: lineNumber,
				endLine: inferSymbolEndLine(lines, lineNumber),
				column: line.indexOf(name) + 1,
				signature: line.trim(),
				parentSymbol: null,
			});
			matched = true;
			break;
		}
		if (matched) continue;

		if (currentClass && currentClass.startLine < lineNumber && lineNumber <= currentClass.endLine) {
			const methodMatch =
				/^(\s*)(?:public\s+|private\s+|protected\s+|static\s+|async\s+|readonly\s+|override\s+|get\s+|set\s+|\*)*([A-Za-z_$][\w$]*)\s*\([^;]*\)\s*\{/.exec(
					line,
				);
			const name = methodMatch?.[2] ?? "";
			if (name && name !== "constructor") {
				add({
					name,
					kind: "method",
					exported: false,
					line: lineNumber,
					endLine: inferSymbolEndLine(lines, lineNumber),
					column: line.indexOf(name) + 1,
					signature: line.trim(),
					parentSymbol: currentClass.name,
				});
				continue;
			}
		}

		if (currentObject && currentObject.startLine < lineNumber && lineNumber <= currentObject.endLine) {
			const objectMethodMatch =
				/^(\s*)([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/.exec(
					line,
				);
			const name = objectMethodMatch?.[2] ?? "";
			if (name) {
				add({
					name,
					kind: "method",
					exported: false,
					line: lineNumber,
					endLine: inferSymbolEndLine(lines, lineNumber),
					column: line.indexOf(name) + 1,
					signature: line.trim(),
					parentSymbol: currentObject.name,
				});
				continue;
			}
		}

		const exportMatch = /^\s*export\s*\{([^}]+)\}/.exec(line);
		if (exportMatch?.[1]) {
			for (const part of exportMatch[1]
				.split(",")
				.map(value => value.trim())
				.filter(Boolean)) {
				const aliasMatch = /^(?<local>[A-Za-z_$][\w$]*)(?:\s+as\s+(?<exported>[A-Za-z_$][\w$]*))?$/.exec(part);
				const local = aliasMatch?.groups?.local ?? "";
				const exportedName = aliasMatch?.groups?.exported ?? local;
				if (!local || !exportedName) continue;
				add({
					name: exportedName,
					kind: "alias",
					exported: true,
					line: lineNumber,
					endLine: lineNumber,
					column: line.indexOf(exportedName) + 1,
					signature: line.trim(),
					parentSymbol: null,
				});
			}
		}
	}

	for (let index = 0; index < lines.length; index++) {
		const line = lines[index] ?? "";
		const match = /^\s*export\s+default\s+([A-Za-z_$][\w$]*)\s*;?\s*$/.exec(line);
		const name = match?.[1] ?? "";
		if (!name) continue;
		const symbol = [...symbols].reverse().find(candidate => candidate.name === name && candidate.line <= index + 1);
		if (symbol) symbol.exported = true;
	}

	return symbols.sort(
		(left, right) => left.line - right.line || left.column - right.column || left.name.localeCompare(right.name),
	);
}

const DECLARATION_PATTERNS: {
	kind: NexusKnowledgeSymbolKind;
	regex: RegExp;
	nameGroup: number;
	forceExported?: boolean;
}[] = [
	{
		kind: "function",
		regex: /^(\s*)(export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)/,
		nameGroup: 3,
	},
	{ kind: "class", regex: /^(\s*)(export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)\b/, nameGroup: 3 },
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

function buildChunkRanges(
	lines: string[],
	options: { maxLines: number; maxChars: number; isMarkdown: boolean; symbols: SymbolCandidate[] },
): Array<{ startLine: number; endLine: number }> {
	const preferredStarts = new Set<number>([1]);
	if (options.isMarkdown) {
		for (let index = 0; index < lines.length; index++) {
			if (/^#{1,6}\s/.test(lines[index] ?? "")) preferredStarts.add(index + 1);
		}
	}
	for (const symbol of options.symbols) preferredStarts.add(symbol.line);
	const sortedStarts = [...preferredStarts].sort((left, right) => left - right);
	const chunks: Array<{ startLine: number; endLine: number }> = [];
	let cursor = 1;
	while (cursor <= lines.length) {
		const preferredEnd = findPreferredChunkEnd(sortedStarts, cursor, options.maxLines, lines.length);
		let endLine = fitChunkToCharBudget(lines, cursor, preferredEnd, options.maxChars);
		if (endLine < cursor) endLine = cursor;
		chunks.push({ startLine: cursor, endLine });
		if (endLine >= lines.length) break;
		cursor = Math.max(endLine + 1 - CHUNK_OVERLAP_LINES, cursor + 1);
		while (cursor < endLine + 1) cursor++;
		const nextPreferred = sortedStarts.find(start => start > endLine && start <= endLine + CHUNK_OVERLAP_LINES + 1);
		if (nextPreferred && nextPreferred > cursor) cursor = nextPreferred;
	}
	return chunks;
}

function findPreferredChunkEnd(
	preferredStarts: number[],
	startLine: number,
	maxLines: number,
	maxLineCount: number,
): number {
	const hardEnd = Math.min(maxLineCount, startLine + maxLines - 1);
	const candidateStarts = preferredStarts.filter(line => line > startLine && line <= hardEnd);
	if (candidateStarts.length === 0) return hardEnd;
	return Math.max(startLine, candidateStarts[candidateStarts.length - 1]! - 1);
}

function fitChunkToCharBudget(lines: string[], startLine: number, preferredEnd: number, maxChars: number): number {
	let endLine = startLine - 1;
	let chars = 0;
	for (let lineNumber = startLine; lineNumber <= preferredEnd; lineNumber++) {
		const nextChars = chars + (lines[lineNumber - 1]?.length ?? 0) + 1;
		if (endLine >= startLine && nextChars > maxChars) break;
		chars = nextChars;
		endLine = lineNumber;
	}
	return endLine < startLine ? startLine : endLine;
}

function collectScopedBlocks(lines: string[], regex: RegExp, nameGroup: number): ScopeRange[] {
	const scopes: ScopeRange[] = [];
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index] ?? "";
		const match = regex.exec(line);
		if (!match) continue;
		const name = match[nameGroup] ?? "";
		if (!name) continue;
		scopes.push({ name, startLine: index + 1, endLine: inferSymbolEndLine(lines, index + 1) ?? index + 1 });
	}
	return scopes;
}

function activeScopeForLine(scopes: ScopeRange[], line: number): ScopeRange | null {
	for (let index = scopes.length - 1; index >= 0; index--) {
		const scope = scopes[index];
		if (scope && scope.startLine <= line && scope.endLine >= line) return scope;
	}
	return null;
}

function inferSymbolEndLine(lines: string[], startLine: number): number | null {
	const startIndex = Math.max(0, startLine - 1);
	const startLineText = lines[startIndex] ?? "";
	if (!startLineText.includes("{")) return startLine;
	let depth = 0;
	let seenOpen = false;
	for (let index = startIndex; index < lines.length; index++) {
		for (const char of lines[index] ?? "") {
			if (char === "{") {
				depth++;
				seenOpen = true;
			}
			if (char === "}") depth--;
		}
		if (seenOpen && depth <= 0) return index + 1;
	}
	return lines.length;
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
