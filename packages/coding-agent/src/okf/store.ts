import { createHash, randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { KNOWLEDGE_CONFIDENCES, KNOWLEDGE_SCOPES } from "../memory/types";
import type { NewOkfDocument, OkfDocument, OkfQuery, OkfSourceRef } from "./types";

export const DEFAULT_OKF_PATH = path.join(os.homedir(), ".amaze", "knowledge", "okf");

export const OKF_EXTERNAL_STALE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

const AUTO_OBSERVED_SOURCE_KINDS = new Set<OkfSourceRef["kind"]>(["url", "file", "tool", "evidence", "verifier", "proposal", "provider"]);
const STALE_SOURCE_KINDS = new Set<OkfSourceRef["kind"]>(["url", "provider"]);
const VALID_SOURCE_KINDS = new Set<string>(["mission", "task", "tool", "evidence", "verifier", "proposal", "provider", "human", "file", "url"]);

const VALID_SCOPES = new Set<string>(KNOWLEDGE_SCOPES);
const VALID_CONFIDENCES = new Set<string>(KNOWLEDGE_CONFIDENCES);

interface StoredOkfDocument {
	document: OkfDocument;
	path: string;
}

type FrontmatterValue = string | number | null | FrontmatterRecord[] | string[];
type FrontmatterRecord = Record<string, string | number | null>;
type Frontmatter = Record<string, FrontmatterValue>;

export class OkfStore {
	readonly filePath: string;
	readonly rootDir: string;
	readonly #rootDir: string;

	constructor(filePath = DEFAULT_OKF_PATH) {
		this.rootDir = path.resolve(expandHome(filePath));
		this.filePath = this.rootDir;
		this.#rootDir = this.rootDir;
		fs.mkdirSync(this.#rootDir, { recursive: true });
	}

	record(input: NewOkfDocument): OkfDocument {
		validateDocument(input);
		const existing = this.#readAll();
		if (input.id && existing.some(entry => entry.document.id === input.id)) {
			throw new Error(`OKF document already exists: ${input.id}`);
		}
		if (input.supersedes && !existing.some(entry => entry.document.id === input.supersedes)) {
			throw new Error(`Superseded OKF document not found: ${input.supersedes}`);
		}
		const now = Date.now();
		const normalizedSourceRefs = input.sourceRefs.map(ref => normalizeSourceRef(ref, now));
		const docContentHash = input.contentHash ?? firstSourceContentHash(normalizedSourceRefs);
		const doc: OkfDocument = {
			...input,
			id: input.id ?? `okf-${now}-${randomBytes(4).toString("hex")}`,
			claim: input.claim.trim(),
			filePath: input.filePath ? safeRelativePath(input.filePath) : null,
			sourceRefs: normalizedSourceRefs,
			contentHash: docContentHash,
			tags: normalizeTags(input.tags ?? []),
			supersededBy: null,
			staleAt: input.staleAt ?? defaultStaleAt(normalizedSourceRefs, now),
			createdAt: now,
			updatedAt: now,
		};
		const target = this.#pathForDocumentId(doc.id);
		this.#writeDocument(target, doc);
		if (doc.supersedes) {
			for (const entry of existing) {
				if (entry.document.id === doc.supersedes) {
					this.#writeDocument(entry.path, { ...entry.document, supersededBy: doc.id, updatedAt: now });
				}
			}
		}
		return doc;
	}

	get(id: string): OkfDocument | undefined {
		return this.#readAll().find(entry => entry.document.id === id)?.document;
	}

	query(opts: OkfQuery = {}): OkfDocument[] {
		const activeOnly = opts.activeOnly !== false;
		const claimLike = opts.claimLike?.toLocaleLowerCase();
		const filePath = opts.filePath ? safeRelativePath(opts.filePath) : undefined;
		const tags = opts.tags ? normalizeTags(opts.tags) : [];
		const limit = Math.max(1, Math.trunc(opts.limit ?? 100));
		return this.#readAll()
			.map(entry => entry.document)
			.filter(doc => {
				if (opts.scope && doc.scope !== opts.scope) return false;
				if (claimLike && !doc.claim.toLocaleLowerCase().includes(claimLike)) return false;
				if (filePath && doc.filePath !== filePath) return false;
				if (activeOnly && (doc.supersededBy !== null || doc.staleAt !== null)) return false;
				if (tags.length > 0 && !tags.every(tag => doc.tags.includes(tag))) return false;
				return true;
			})
			.sort((a, b) => b.updatedAt - a.updatedAt || b.id.localeCompare(a.id))
			.slice(0, limit);
	}

	#readAll(): StoredOkfDocument[] {
		return discoverMarkdownFiles(this.#rootDir).map(filePath => ({ document: readDocument(filePath), path: filePath }));
	}

	#pathForDocumentId(id: string): string {
		return safePathInside(this.#rootDir, path.join(this.#rootDir, `${encodeDocumentFileName(id)}.md`));
	}

	#writeDocument(targetPath: string, doc: OkfDocument): void {
		const target = safePathInside(this.#rootDir, targetPath);
		fs.mkdirSync(path.dirname(target), { recursive: true });
		const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
		fs.writeFileSync(tmp, serializeDocument(doc), "utf8");
		fs.renameSync(tmp, target);
	}
}

export function safeRelativePath(filePath: string): string {
	if (filePath.trim().length === 0) throw new Error("OKF filePath must not be empty");
	if (path.isAbsolute(filePath)) throw new Error(`OKF filePath must be workspace-relative: ${filePath}`);
	const normalized = path.normalize(filePath).replaceAll(path.sep, "/");
	if (normalized === "." || normalized.startsWith("../") || normalized === "..") {
		throw new Error(`OKF filePath must stay inside the workspace: ${filePath}`);
	}
	return normalized;
}

export function safePathInside(rootDir: string, targetPath: string): string {
	const root = path.resolve(rootDir);
	const target = path.resolve(targetPath);
	const relative = path.relative(root, target);
	if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return target;
	throw new Error(`OKF path escapes root: ${targetPath}`);
}

function validateDocument(input: NewOkfDocument): void {
	if (!VALID_SCOPES.has(input.scope)) throw new Error(`Invalid OKF scope: ${input.scope}`);
	if (!VALID_CONFIDENCES.has(input.confidence)) throw new Error(`Invalid OKF confidence: ${input.confidence}`);
	if (input.claim.trim().length === 0) throw new Error("OKF claim must not be empty");
	if (input.sourceRefs.length === 0) throw new Error("OKF document requires at least one source ref");
	for (const ref of input.sourceRefs) normalizeSourceRef(ref);
	if (input.filePath) safeRelativePath(input.filePath);
	if (input.staleAt !== undefined && input.staleAt !== null && !Number.isFinite(input.staleAt)) {
		throw new Error("OKF staleAt must be a finite number or null");
	}
}

function normalizeSourceRef(ref: OkfSourceRef | string, observedAt = Date.now()): OkfSourceRef {
	const parsed = parseSourceRef(ref);
	const withHash = {
		...parsed,
		contentHash: parsed.contentHash ?? contentHashForSourceRef(parsed),
	};
	return {
		...withHash,
		observedAt: withHash.observedAt ?? (AUTO_OBSERVED_SOURCE_KINDS.has(withHash.kind) ? observedAt : undefined),
	};
}

function parseSourceRef(ref: OkfSourceRef | string): OkfSourceRef {
	if (typeof ref === "string") {
		if (ref.trim().length === 0) throw new Error("OKF source ref uri must not be empty");
		return { kind: "evidence", uri: ref.trim() };
	}
	if (!VALID_SOURCE_KINDS.has(ref.kind)) throw new Error(`Invalid OKF source ref kind: ${ref.kind}`);
	if (ref.uri.trim().length === 0) throw new Error("OKF source ref uri must not be empty");
	return { ...ref, uri: ref.uri.trim() };
}

function normalizeTags(tags: string[]): string[] {
	return [...new Set(tags.map(tag => tag.trim()).filter(Boolean))].sort();
}

function normalizeStoredDocument(doc: OkfDocument): OkfDocument {
	const sourceRefs = doc.sourceRefs.map(parseSourceRef);
	return {
		...doc,
		claim: doc.claim.trim(),
		filePath: doc.filePath ? safeRelativePath(doc.filePath) : null,
		contentHash: doc.contentHash ?? null,
		supersedes: doc.supersedes ?? null,
		sourceRefs,
		tags: normalizeTags(doc.tags ?? []),
		supersededBy: doc.supersededBy ?? null,
		staleAt: doc.staleAt ?? null,
	};
}

function discoverMarkdownFiles(rootDir: string): string[] {
	const root = path.resolve(rootDir);
	const files: string[] = [];
	const visit = (dir: string): void => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const fullPath = safePathInside(root, path.join(dir, entry.name));
			if (entry.isDirectory()) {
				visit(fullPath);
				continue;
			}
			if (entry.isFile() && entry.name.endsWith(".md") && !entry.name.includes(".tmp")) files.push(fullPath);
		}
	};
	try {
		visit(root);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	return files.sort((a, b) => path.relative(root, a).localeCompare(path.relative(root, b)));
}

function readDocument(filePath: string): OkfDocument {
	const { frontmatter, body } = parseMarkdownDocument(fs.readFileSync(filePath, "utf8"));
	const doc = normalizeStoredDocument({
		id: requiredString(frontmatter, "id", filePath),
		scope: requiredString(frontmatter, "scope", filePath) as OkfDocument["scope"],
		claim: body.trim(),
		sourceRefs: requiredSourceRefs(frontmatter, filePath),
		confidence: requiredString(frontmatter, "confidence", filePath) as OkfDocument["confidence"],
		filePath: nullableString(frontmatter.filePath, "filePath", filePath),
		contentHash: nullableString(frontmatter.contentHash, "contentHash", filePath),
		supersedes: nullableString(frontmatter.supersedes, "supersedes", filePath),
		supersededBy: nullableString(frontmatter.supersededBy, "supersededBy", filePath),
		staleAt: nullableNumber(frontmatter.staleAt, "staleAt", filePath),
		tags: stringArray(frontmatter.tags, "tags", filePath),
		createdAt: requiredNumber(frontmatter, "createdAt", filePath),
		updatedAt: requiredNumber(frontmatter, "updatedAt", filePath),
	});
	validateStoredDocument(doc, filePath);
	return doc;
}

function validateStoredDocument(doc: OkfDocument, filePath: string): void {
	if (!VALID_SCOPES.has(doc.scope)) throw new Error(`Invalid OKF scope in ${filePath}: ${doc.scope}`);
	if (!VALID_CONFIDENCES.has(doc.confidence)) throw new Error(`Invalid OKF confidence in ${filePath}: ${doc.confidence}`);
	if (doc.claim.length === 0) throw new Error(`OKF claim body must not be empty: ${filePath}`);
	if (doc.sourceRefs.length === 0) throw new Error(`OKF document requires at least one source ref: ${filePath}`);
}

export interface OkfQualityIssue {
	id: string;
	severity: "warning" | "error";
	field: string;
	message: string;
}

export function qualityIssuesForDocument(doc: OkfDocument): OkfQualityIssue[] {
	const issues: OkfQualityIssue[] = [];
	if (doc.filePath && !doc.contentHash) {
		issues.push({
			id: doc.id,
			severity: "warning",
			field: "contentHash",
			message: "repo-anchored OKF document has filePath without contentHash",
		});
	}
	for (const ref of doc.sourceRefs) {
		if (AUTO_OBSERVED_SOURCE_KINDS.has(ref.kind) && !ref.observedAt) {
			issues.push({
				id: doc.id,
				severity: "warning",
				field: "sourceRefs.observedAt",
				message: `${ref.kind} source ${ref.uri} is missing observedAt`,
			});
		}
		if ((ref.kind === "file" || ref.kind === "evidence") && isReadableFileUri(ref.uri) && !ref.contentHash) {
			issues.push({
				id: doc.id,
				severity: "warning",
				field: "sourceRefs.contentHash",
				message: `${ref.kind} source ${ref.uri} is missing contentHash`,
			});
		}
		if (STALE_SOURCE_KINDS.has(ref.kind) && !doc.staleAt) {
			issues.push({
				id: doc.id,
				severity: "warning",
				field: "staleAt",
				message: `${ref.kind} sourced OKF document has no staleAt refresh policy`,
			});
		}
	}
	return issues;
}

function serializeDocument(doc: OkfDocument): string {
	const normalized = normalizeStoredDocument(doc);
	const frontmatter: Frontmatter = {
		id: normalized.id,
		scope: normalized.scope,
		sourceRefs: normalized.sourceRefs.map(ref => ({
			kind: ref.kind,
			uri: ref.uri,
			contentHash: ref.contentHash ?? null,
			observedAt: ref.observedAt ?? null,
		})),
		confidence: normalized.confidence,
		filePath: normalized.filePath,
		contentHash: normalized.contentHash,
		supersedes: normalized.supersedes,
		supersededBy: normalized.supersededBy,
		staleAt: normalized.staleAt,
		tags: normalized.tags,
		createdAt: normalized.createdAt,
		updatedAt: normalized.updatedAt,
	};
	return `---\n${serializeFrontmatter(frontmatter)}---\n\n${normalized.claim}\n`;
}

function parseMarkdownDocument(content: string): { frontmatter: Frontmatter; body: string } {
	if (!content.startsWith("---\n")) throw new Error("OKF markdown document must start with YAML frontmatter");
	const end = content.indexOf("\n---", 4);
	if (end === -1) throw new Error("OKF markdown document missing closing YAML frontmatter delimiter");
	const afterDelimiter = content.startsWith("\n", end + 4) ? end + 5 : end + 4;
	return { frontmatter: parseFrontmatter(content.slice(4, end)), body: content.slice(afterDelimiter) };
}

function serializeFrontmatter(frontmatter: Frontmatter): string {
	const lines: string[] = [];
	for (const [key, value] of Object.entries(frontmatter)) {
		if (Array.isArray(value)) {
			lines.push(`${key}:`);
			if (value.length === 0) continue;
			for (const item of value) {
				if (typeof item === "string") {
					lines.push(`  - ${quoteYamlString(item)}`);
					continue;
				}
				const entries = Object.entries(item);
				const [firstKey, firstValue] = entries[0] ?? [undefined, undefined];
				if (!firstKey) {
					lines.push("  - {}");
					continue;
				}
				lines.push(`  - ${firstKey}: ${serializeScalar(firstValue)}`);
				for (const [childKey, childValue] of entries.slice(1)) lines.push(`    ${childKey}: ${serializeScalar(childValue)}`);
			}
			continue;
		}
		lines.push(`${key}: ${serializeScalar(value)}`);
	}
	return `${lines.join("\n")}\n`;
}

function parseFrontmatter(text: string): Frontmatter {
	const lines = text.split(/\r?\n/);
	const result: Frontmatter = {};
	let index = 0;
	while (index < lines.length) {
		const line = lines[index++];
		if (line.trim().length === 0) continue;
		const pair = /^(\w+):(.*)$/.exec(line);
		if (!pair) throw new Error(`Unsupported OKF YAML line: ${line}`);
		const key = pair[1];
		const rawValue = pair[2].trim();
		if (rawValue.length > 0) {
			result[key] = parseScalar(rawValue);
			continue;
		}
		const array: FrontmatterRecord[] | string[] = [];
		while (index < lines.length && lines[index].startsWith("  - ")) {
			const first = lines[index++].slice(4);
			if (!first.includes(":")) {
				(array as string[]).push(String(parseScalar(first)));
				continue;
			}
			const record: FrontmatterRecord = {};
			const [childKey, childRawValue] = splitYamlPair(first);
			record[childKey] = parseScalar(childRawValue.trim());
			while (index < lines.length && lines[index].startsWith("    ")) {
				const [nestedKey, nestedRawValue] = splitYamlPair(lines[index++].slice(4));
				record[nestedKey] = parseScalar(nestedRawValue.trim());
			}
			(array as FrontmatterRecord[]).push(record);
		}
		result[key] = array;
	}
	return result;
}

function splitYamlPair(line: string): [string, string] {
	const separator = line.indexOf(":");
	if (separator === -1) throw new Error(`Unsupported OKF YAML mapping line: ${line}`);
	return [line.slice(0, separator).trim(), line.slice(separator + 1)];
}

function serializeScalar(value: string | number | null): string {
	if (value === null) return "null";
	if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
	return quoteYamlString(value);
}

function quoteYamlString(value: string): string {
	return JSON.stringify(value);
}

function parseScalar(value: string): string | number | null {
	if (value === "null" || value === "~") return null;
	if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
	if (value.startsWith('"') && value.endsWith('"')) return JSON.parse(value) as string;
	return value;
}

function requiredString(frontmatter: Frontmatter, key: string, filePath: string): string {
	const value = frontmatter[key];
	if (typeof value !== "string" || value.trim().length === 0) throw new Error(`OKF ${key} must be a non-empty string: ${filePath}`);
	return value.trim();
}

function nullableString(value: FrontmatterValue | undefined, key: string, filePath: string): string | null {
	if (value === null || value === undefined) return null;
	if (typeof value !== "string") throw new Error(`OKF ${key} must be a string or null: ${filePath}`);
	return value.trim().length > 0 ? value.trim() : null;
}

function requiredNumber(frontmatter: Frontmatter, key: string, filePath: string): number {
	const value = frontmatter[key];
	if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`OKF ${key} must be a number: ${filePath}`);
	return value;
}

function nullableNumber(value: FrontmatterValue | undefined, key: string, filePath: string): number | null {
	if (value === null || value === undefined) return null;
	if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`OKF ${key} must be a number or null: ${filePath}`);
	return value;
}

function stringArray(value: FrontmatterValue | undefined, key: string, filePath: string): string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.some(item => typeof item !== "string")) throw new Error(`OKF ${key} must be a string array: ${filePath}`);
	return normalizeTags(value as string[]);
}

function requiredSourceRefs(frontmatter: Frontmatter, filePath: string): OkfSourceRef[] {
	const value = frontmatter.sourceRefs;
	if (!Array.isArray(value) || value.length === 0) throw new Error(`OKF sourceRefs must be a non-empty array: ${filePath}`);
	return value.map(item => {
		if (typeof item === "string") return parseSourceRef(item);
		return parseSourceRef({
			kind: requiredRecordString(item, "kind", filePath) as OkfSourceRef["kind"],
			uri: requiredRecordString(item, "uri", filePath),
			contentHash: optionalRecordString(item, "contentHash", filePath),
			observedAt: optionalRecordNumber(item, "observedAt", filePath),
		});
	});
}

function requiredRecordString(record: FrontmatterRecord, key: string, filePath: string): string {
	const value = record[key];
	if (typeof value !== "string" || value.trim().length === 0) throw new Error(`OKF sourceRefs.${key} must be a non-empty string: ${filePath}`);
	return value.trim();
}

function optionalRecordString(record: FrontmatterRecord, key: string, filePath: string): string | undefined {
	const value = record[key];
	if (value === null || value === undefined) return undefined;
	if (typeof value !== "string") throw new Error(`OKF sourceRefs.${key} must be a string: ${filePath}`);
	return value.trim().length > 0 ? value.trim() : undefined;
}

function optionalRecordNumber(record: FrontmatterRecord, key: string, filePath: string): number | undefined {
	const value = record[key];
	if (value === null || value === undefined) return undefined;
	if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`OKF sourceRefs.${key} must be a number: ${filePath}`);
	return value;
}

function firstSourceContentHash(sourceRefs: OkfSourceRef[]): string | null {
	return sourceRefs.find(ref => ref.contentHash)?.contentHash ?? null;
}

function defaultStaleAt(sourceRefs: OkfSourceRef[], now: number): number | null {
	return sourceRefs.some(ref => STALE_SOURCE_KINDS.has(ref.kind)) ? now + OKF_EXTERNAL_STALE_AFTER_MS : null;
}

function contentHashForSourceRef(ref: OkfSourceRef): string | undefined {
	if (ref.kind !== "file" && ref.kind !== "evidence") return undefined;
	const filePath = sourceRefFilePath(ref.uri);
	if (!filePath) return undefined;
	try {
		return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
	} catch {
		return undefined;
	}
}

function isReadableFileUri(uri: string): boolean {
	return sourceRefFilePath(uri) !== null;
}

function sourceRefFilePath(uri: string): string | null {
	if (uri.startsWith("file://")) return new URL(uri).pathname;
	if (path.isAbsolute(uri)) return uri;
	return null;
}

function encodeDocumentFileName(id: string): string {
	return encodeURIComponent(id).replaceAll("%", "_");
}

function expandHome(value: string): string {
	return value === "~" || value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
}
