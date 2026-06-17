/// <reference types="node" />

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export interface ReconPlan {
	recon_plan_id: string;
	mission_id: string;
	questions?: string[];
	repo_queries?: string[];
	symbol_queries?: string[];
	required_artifacts?: string[];
}

export interface CandidatePathEvidence {
	path: string;
	files: string[];
	symbols: string[];
	tests: string[];
}

export interface RepoEvidencePacket {
	scan_id: string;
	recon_plan_id: string;
	mission_id: string;
	repo_root: string;
	index_status: "xenonite" | "filesystem_fallback" | "incremental_filesystem";
	questions: string[];
	repo_queries: string[];
	symbol_queries: string[];
	candidate_paths: CandidatePathEvidence[];
	delta_scan?: DeltaScanRecord;
	dependency_graph?: DependencyGraphRecord;
	symbol_index?: SymbolIndexRecord;
	commands: Record<string, string>;
	xenonite?: {
		base_url: string;
		status: "ok" | "unavailable";
		results: Array<{ op: string; query?: string; result?: unknown; error?: string }>;
	};
}

export interface CollectRepoEvidenceOptions {
	xenoniteBaseUrl?: string;
	useXenonite?: boolean;
	fetchImpl?: typeof fetch;
	now?: () => number;
	maxFiles?: number;
}

export interface FileFingerprint {
	path: string;
	size: number;
	mtime_ms: number;
	sha256: string;
}

export interface DeltaScanRecord {
	index_id: string;
	previous_index_id?: string;
	changed_files: string[];
	added_files: string[];
	deleted_files: string[];
	unchanged_files: number;
	total_files: number;
}

export interface DependencyGraphRecord {
	edges: Array<{ from: string; to: string }>;
}

export interface SymbolIndexRecord {
	symbols: Array<{ name: string; file: string; kind: "function" | "class" | "interface" | "type" | "const" }>;
}

const EXCLUDED_DIRS = new Set([".git", "node_modules", "dist", "build", ".harness", ".next", "coverage"]);
const TEXT_EXTENSIONS = new Set([
	".ts",
	".tsx",
	".js",
	".jsx",
	".json",
	".md",
	".yaml",
	".yml",
	".toml",
	".css",
	".html",
	".sh",
]);

function safeId(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "scan";
}

function scanId(plan: ReconPlan, now: number): string {
	return `scan-${safeId(plan.mission_id)}-${new Date(now).toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
}

function ensureEvidenceDirs(cwd: string): void {
	for (const dir of ["recon-plans", "scans", "indexes"]) {
		fs.mkdirSync(path.join(cwd, ".harness", "intelligence", dir), { recursive: true });
	}
}

function writeJson(filePath: string, value: unknown): void {
	fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function listFiles(root: string, maxFiles: number): string[] {
	const files: string[] = [];
	const visit = (dir: string): void => {
		if (files.length >= maxFiles) return;
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (files.length >= maxFiles) return;
			if (entry.isDirectory()) {
				if (!EXCLUDED_DIRS.has(entry.name)) visit(path.join(dir, entry.name));
				continue;
			}
			if (!entry.isFile()) continue;
			const filePath = path.join(dir, entry.name);
			if (TEXT_EXTENSIONS.has(path.extname(entry.name)) || entry.name === "package.json") {
				files.push(path.relative(root, filePath).replace(/\\/g, "/"));
			}
		}
	};
	visit(root);
	return files;
}

function readSmallText(root: string, relPath: string): string {
	try {
		const stat = fs.statSync(path.join(root, relPath));
		if (stat.size > 200_000) return "";
		return fs.readFileSync(path.join(root, relPath), "utf-8");
	} catch {
		return "";
	}
}

function tokens(values: string[]): string[] {
	return values
		.flatMap((value) => value.split(/[^a-zA-Z0-9_.$/-]+/))
		.map((value) => value.toLowerCase())
		.filter((value) => value.length >= 3);
}

function parentFolder(relPath: string): string {
	const dir = path.dirname(relPath).replace(/\\/g, "/");
	return dir === "." ? "." : dir;
}

function collectFilesystemCandidates(root: string, plan: ReconPlan, maxFiles: number): CandidatePathEvidence[] {
	const allFiles = listFiles(root, maxFiles);
	const queryTokens = tokens([...(plan.repo_queries ?? []), ...(plan.symbol_queries ?? []), ...(plan.questions ?? [])]);
	const byFolder = new Map<string, CandidatePathEvidence>();
	const add = (folder: string, file: string, symbols: string[] = []): void => {
		const entry = byFolder.get(folder) ?? { path: folder, files: [], symbols: [], tests: [] };
		if (!entry.files.includes(file)) entry.files.push(file);
		for (const symbol of symbols) if (!entry.symbols.includes(symbol)) entry.symbols.push(symbol);
		if (/(^|\/)(test|tests|__tests__)\//.test(file) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(file)) {
			if (!entry.tests.includes(file)) entry.tests.push(file);
		}
		byFolder.set(folder, entry);
	};
	for (const file of allFiles) {
		const lowerPath = file.toLowerCase();
		const content = readSmallText(root, file);
		const lowerContent = content.toLowerCase();
		const matched = queryTokens.length === 0 || queryTokens.some((token) => lowerPath.includes(token) || lowerContent.includes(token));
		if (!matched) continue;
		const symbols = (plan.symbol_queries ?? []).filter((symbol) => content.includes(symbol));
		add(parentFolder(file), file, symbols);
	}
	return [...byFolder.values()]
		.map((entry) => ({
			path: entry.path,
			files: entry.files.sort().slice(0, 40),
			symbols: entry.symbols.sort(),
			tests: entry.tests.sort(),
		}))
		.sort((a, b) => a.path.localeCompare(b.path))
		.slice(0, 50);
}

function fingerprintFile(root: string, relPath: string): FileFingerprint | undefined {
	try {
		const absolute = path.join(root, relPath);
		const stat = fs.statSync(absolute);
		if (!stat.isFile()) return undefined;
		const buffer = fs.readFileSync(absolute);
		return {
			path: relPath,
			size: stat.size,
			mtime_ms: stat.mtimeMs,
			sha256: createHash("sha256").update(buffer).digest("hex"),
		};
	} catch {
		return undefined;
	}
}

function loadPreviousIndex(root: string): { index_id: string; files: FileFingerprint[] } | undefined {
	const pointer = path.join(root, ".harness", "intelligence", "indexes", "latest.json");
	try {
		const latest = JSON.parse(fs.readFileSync(pointer, "utf-8")) as { index_id?: string };
		if (!latest.index_id) return undefined;
		const indexPath = path.join(root, ".harness", "intelligence", "indexes", `${safeId(latest.index_id)}.json`);
		return JSON.parse(fs.readFileSync(indexPath, "utf-8")) as { index_id: string; files: FileFingerprint[] };
	} catch {
		return undefined;
	}
}

function collectIncrementalIndex(root: string, files: string[], scanIdValue: string): { delta: DeltaScanRecord; fingerprints: FileFingerprint[] } {
	const previous = loadPreviousIndex(root);
	const previousByPath = new Map((previous?.files ?? []).map((file) => [file.path, file]));
	const fingerprints = files.map((file) => fingerprintFile(root, file)).filter((file): file is FileFingerprint => Boolean(file));
	const currentByPath = new Map(fingerprints.map((file) => [file.path, file]));
	const changedFiles: string[] = [];
	const addedFiles: string[] = [];
	let unchangedFiles = 0;
	for (const file of fingerprints) {
		const prior = previousByPath.get(file.path);
		if (!prior) {
			addedFiles.push(file.path);
		} else if (prior.sha256 !== file.sha256) {
			changedFiles.push(file.path);
		} else {
			unchangedFiles += 1;
		}
	}
	const deletedFiles = [...previousByPath.keys()].filter((file) => !currentByPath.has(file)).sort();
	const delta: DeltaScanRecord = {
		index_id: scanIdValue,
		previous_index_id: previous?.index_id,
		changed_files: changedFiles.sort(),
		added_files: addedFiles.sort(),
		deleted_files: deletedFiles,
		unchanged_files: unchangedFiles,
		total_files: fingerprints.length,
	};
	writeJson(path.join(root, ".harness", "intelligence", "indexes", `${safeId(scanIdValue)}.json`), { index_id: scanIdValue, files: fingerprints });
	writeJson(path.join(root, ".harness", "intelligence", "indexes", "latest.json"), { index_id: scanIdValue });
	return { delta, fingerprints };
}

function collectDependencyGraph(root: string, files: string[]): DependencyGraphRecord {
	const edges: DependencyGraphRecord["edges"] = [];
	const importPattern = /\bimport\s+(?:[^'"]+\s+from\s+)?["']([^"']+)["']|\brequire\(["']([^"']+)["']\)/g;
	for (const file of files) {
		const content = readSmallText(root, file);
		for (const match of content.matchAll(importPattern)) {
			const target = match[1] ?? match[2];
			if (target) edges.push({ from: file, to: target });
		}
	}
	return { edges };
}

function collectSymbolIndex(root: string, files: string[]): SymbolIndexRecord {
	const symbols: SymbolIndexRecord["symbols"] = [];
	const symbolPattern = /\b(?:export\s+)?(?:async\s+)?(function|class|interface|type|const)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
	for (const file of files) {
		const content = readSmallText(root, file);
		for (const match of content.matchAll(symbolPattern)) {
			const kind = match[1] as SymbolIndexRecord["symbols"][number]["kind"];
			const name = match[2];
			if (name) symbols.push({ name, file, kind });
		}
	}
	return { symbols };
}

function detectCommands(root: string): Record<string, string> {
	const packageJson = path.join(root, "package.json");
	try {
		const parsed = JSON.parse(fs.readFileSync(packageJson, "utf-8")) as { scripts?: Record<string, string> };
		const scripts = parsed.scripts ?? {};
		const commands: Record<string, string> = {};
		for (const name of ["test", "typecheck", "lint", "build"]) {
			if (scripts[name]) commands[name] = `npm run ${name}`;
		}
		return commands;
	} catch {
		return {};
	}
}

async function callXenonite(baseUrl: string, op: string, args: Record<string, unknown>, fetchImpl: typeof fetch): Promise<{ op: string; query?: string; result?: unknown; error?: string }> {
	try {
		const res = await fetchImpl(`${baseUrl}/v1/code/call`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ op, args }),
		});
		const data = await res.json() as { result?: unknown; error?: string };
		return { op, query: typeof args.query === "string" ? args.query : undefined, result: data.result, error: data.error };
	} catch (error) {
		return { op, query: typeof args.query === "string" ? args.query : undefined, error: error instanceof Error ? error.message : String(error) };
	}
}

async function collectXenoniteEvidence(root: string, plan: ReconPlan, options: CollectRepoEvidenceOptions): Promise<RepoEvidencePacket["xenonite"]> {
	if (options.useXenonite === false) return undefined;
	const baseUrl = options.xenoniteBaseUrl ?? process.env.XENONITE_BASE_URL ?? `http://127.0.0.1:${process.env.XENONITE_PORT ?? "8700"}`;
	const fetchImpl = options.fetchImpl ?? globalThis.fetch;
	if (!fetchImpl) return { base_url: baseUrl, status: "unavailable", results: [{ op: "unavailable", error: "fetch is not available" }] };
	const results: Array<{ op: string; query?: string; result?: unknown; error?: string }> = [];
	for (const query of plan.repo_queries ?? []) {
		results.push(await callXenonite(baseUrl, "codebase_search", { projectPath: root, query }, fetchImpl));
	}
	for (const query of plan.symbol_queries ?? []) {
		results.push(await callXenonite(baseUrl, "codebase_symbol", { projectPath: root, query }, fetchImpl));
	}
	return {
		base_url: baseUrl,
		status: results.some((result) => !result.error) ? "ok" : "unavailable",
		results,
	};
}

export async function collectRepoEvidence(
	plan: ReconPlan,
	cwd = process.cwd(),
	options: CollectRepoEvidenceOptions = {},
): Promise<RepoEvidencePacket> {
	const now = options.now?.() ?? Date.now();
	const id = scanId(plan, now);
	ensureEvidenceDirs(cwd);
	writeJson(path.join(cwd, ".harness", "intelligence", "recon-plans", `${safeId(plan.recon_plan_id)}.json`), plan);
	const xenonite = await collectXenoniteEvidence(cwd, plan, options);
	const allFiles = listFiles(cwd, options.maxFiles ?? 2_000);
	const incremental = collectIncrementalIndex(cwd, allFiles, id);
	const packet: RepoEvidencePacket = {
		scan_id: id,
		recon_plan_id: plan.recon_plan_id,
		mission_id: plan.mission_id,
		repo_root: ".",
		index_status: xenonite?.status === "ok" ? "xenonite" : incremental.delta.previous_index_id ? "incremental_filesystem" : "filesystem_fallback",
		questions: plan.questions ?? [],
		repo_queries: plan.repo_queries ?? [],
		symbol_queries: plan.symbol_queries ?? [],
		candidate_paths: collectFilesystemCandidates(cwd, plan, options.maxFiles ?? 2_000),
		delta_scan: incremental.delta,
		dependency_graph: collectDependencyGraph(cwd, allFiles),
		symbol_index: collectSymbolIndex(cwd, allFiles),
		commands: detectCommands(cwd),
		xenonite,
	};
	writeJson(path.join(cwd, ".harness", "intelligence", "scans", `${id}.json`), packet);
	return packet;
}
