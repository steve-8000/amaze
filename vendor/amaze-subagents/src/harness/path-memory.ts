/// <reference types="node" />

import * as fs from "node:fs";
import * as path from "node:path";
import type { PathContract } from "./path-contract.ts";
import { validatePathMemoryUpdates } from "./memory-update-validator.ts";

export const PATH_MEMORY_PACKET_ENV = "PI_SUBAGENT_PATH_MEMORY_PACKET";

export interface PathMemoryInclude {
	profile?: boolean;
	conventions?: boolean;
	recent_decisions?: number;
	known_failures?: number;
	incidents?: number;
	contract_summaries?: number;
}

export interface PathMemoryBudget {
	max_tokens?: number;
	max_bytes?: number;
}

export interface PathMemoryAttachment {
	attachment_id?: string;
	path_id: string;
	memory_path: string;
	xenonite_namespace?: string;
	include?: PathMemoryInclude;
	mode?: "read_only";
	budget?: PathMemoryBudget;
}

export interface PathMemoryScope {
	type: "path";
	path_id: string;
	memory_path: string;
	xenonite_namespace?: string;
}

export interface PathMemoryPacketInput {
	packet_id?: string;
	contract_id?: string;
	memory_scope?: PathMemoryScope;
	memoryScope?: PathMemoryScope;
	scope?: PathMemoryScope;
	memory_attachments?: PathMemoryAttachment[];
	memoryAttachments?: PathMemoryAttachment[];
	attachments?: PathMemoryAttachment[];
	apply_updates_after_validation_pass?: boolean;
}

export interface RenderedPathMemoryPacket {
	markdown: string;
	warnings: string[];
}

export interface PathMemoryUpdate {
	type?: string;
	summary?: string;
	decision?: string;
	lesson?: string;
	reason?: string;
	related_files?: string[];
	[key: string]: unknown;
}

export interface PathMemoryAppendResult {
	written: number;
	skipped: number;
	warnings: string[];
	files: string[];
}

export interface PathMemoryHistoryRecord extends PathMemoryUpdate {
	history_type: "decision" | "known_failure" | "incident" | "contract" | "summary";
	path_id: string;
}

const DEFAULT_INCLUDE: Required<PathMemoryInclude> = {
	profile: true,
	conventions: true,
	recent_decisions: 8,
	known_failures: 6,
	incidents: 4,
	contract_summaries: 5,
};

function asObject(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: undefined;
}

function normalizeInclude(include: PathMemoryInclude | undefined): Required<PathMemoryInclude> {
	return {
		profile: include?.profile ?? DEFAULT_INCLUDE.profile,
		conventions: include?.conventions ?? DEFAULT_INCLUDE.conventions,
		recent_decisions: include?.recent_decisions ?? DEFAULT_INCLUDE.recent_decisions,
		known_failures: include?.known_failures ?? DEFAULT_INCLUDE.known_failures,
		incidents: include?.incidents ?? DEFAULT_INCLUDE.incidents,
		contract_summaries: include?.contract_summaries ?? DEFAULT_INCLUDE.contract_summaries,
	};
}

function normalizeScope(input: PathMemoryPacketInput): PathMemoryScope | undefined {
	return input.memory_scope ?? input.memoryScope ?? input.scope;
}

function normalizeAttachments(input: PathMemoryPacketInput, scope: PathMemoryScope | undefined): PathMemoryAttachment[] {
	const attachments = input.memory_attachments ?? input.memoryAttachments ?? input.attachments;
	if (attachments?.length) {
		return attachments.map((attachment) => ({
			...attachment,
			xenonite_namespace: attachment.xenonite_namespace ?? scope?.xenonite_namespace,
			mode: "read_only",
		}));
	}
	if (!scope) return [];
	return [{
		attachment_id: `${scope.path_id}:default`,
		path_id: scope.path_id,
		memory_path: scope.memory_path,
		xenonite_namespace: scope.xenonite_namespace,
		mode: "read_only",
	}];
}

function resolveMemoryPath(cwd: string, memoryPath: string): string {
	if (path.isAbsolute(memoryPath)) return memoryPath;
	return path.resolve(cwd, memoryPath);
}

function readTextFile(filePath: string, warnings: string[]): string {
	try {
		return fs.readFileSync(filePath, "utf-8").trim();
	} catch (error) {
		if ((error as { code?: string }).code !== "ENOENT") {
			warnings.push(`Failed to read ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
		}
		return "";
	}
}

function readJsonlTail(filePath: string, count: number, warnings: string[]): string {
	if (count <= 0) return "";
	const text = readTextFile(filePath, warnings);
	if (!text) return "";
	return text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.slice(-count)
		.join("\n");
}

function pushSection(parts: string[], title: string, body: string): void {
	const trimmed = body.trim();
	if (!trimmed) return;
	parts.push(`### ${title}\n\n${trimmed}`);
}

function applyByteBudget(text: string, budget: PathMemoryBudget | undefined): string {
	const maxBytes = budget?.max_bytes ?? (budget?.max_tokens ? budget.max_tokens * 4 : 24_000);
	if (!Number.isFinite(maxBytes) || maxBytes <= 0) return text;
	const bytes = Buffer.byteLength(text, "utf-8");
	if (bytes <= maxBytes) return text;
	const targetChars = Math.max(0, Math.floor(maxBytes));
	return `${text.slice(0, targetChars)}\n\n[Path memory truncated to ${maxBytes} bytes]`;
}

function renderAttachment(cwd: string, attachment: PathMemoryAttachment, warnings: string[]): string {
	const include = normalizeInclude(attachment.include);
	const memoryRoot = resolveMemoryPath(cwd, attachment.memory_path);
	const sections: string[] = [];
	if (include.profile) pushSection(sections, "profile.md", readTextFile(path.join(memoryRoot, "profile.md"), warnings));
	if (include.conventions) pushSection(sections, "conventions.md", readTextFile(path.join(memoryRoot, "conventions.md"), warnings));
	pushSection(sections, "decisions.jsonl", readJsonlTail(path.join(memoryRoot, "decisions.jsonl"), include.recent_decisions, warnings));
	pushSection(sections, "known-failures.jsonl", readJsonlTail(path.join(memoryRoot, "known-failures.jsonl"), include.known_failures, warnings)
		|| readJsonlTail(path.join(memoryRoot, "known_failures.jsonl"), include.known_failures, warnings));
	pushSection(sections, "incidents.jsonl", readJsonlTail(path.join(memoryRoot, "incidents.jsonl"), include.incidents, warnings));
	pushSection(sections, "contracts.jsonl", readJsonlTail(path.join(memoryRoot, "contracts.jsonl"), include.contract_summaries, warnings));
	pushSection(sections, "summaries.jsonl", readJsonlTail(path.join(memoryRoot, "summaries.jsonl"), include.contract_summaries, warnings));
	const rendered = [
		`## Attachment: ${attachment.path_id}`,
		"",
		"```json",
		JSON.stringify({
			attachment_id: attachment.attachment_id,
			path_id: attachment.path_id,
			memory_path: attachment.memory_path,
			xenonite_namespace: attachment.xenonite_namespace,
			mode: attachment.mode ?? "read_only",
			include,
		}, null, 2),
		"```",
		"",
		sections.length ? sections.join("\n\n") : "_No path memory files matched this attachment._",
	].join("\n");
	return applyByteBudget(rendered, attachment.budget);
}

export function pathIdFromFolder(folderPath: string): string {
	return `folder.${folderPath.replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\//g, ".").replace(/-/g, "_")}`;
}

export function xenoniteNamespaceFromPath(folderPath: string): string {
	const normalized = folderPath.replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\/+$/, "");
	return `path:${normalized}`;
}

export function renderPathMemoryPacket(input: PathMemoryPacketInput, cwd = process.cwd()): RenderedPathMemoryPacket {
	const scope = normalizeScope(input);
	const attachments = normalizeAttachments(input, scope);
	const warnings: string[] = [];
	const header = {
		packet_id: input.packet_id,
		contract_id: input.contract_id,
		memory_scope: scope,
		apply_updates_after_validation_pass: input.apply_updates_after_validation_pass ?? true,
	};
	const markdown = [
		"# Path Memory Packet",
		"",
		"This packet is read-only path-local experience for the fresh child runtime. It is not parent conversation history.",
		"Use it only when relevant to the execution contract. Propose memory_updates in your final output; memory updates are appended only after validator pass.",
		"",
		"```json",
		JSON.stringify(header, null, 2),
		"```",
		"",
		...attachments.map((attachment) => renderAttachment(cwd, attachment, warnings)),
		warnings.length ? `\n## Memory Load Warnings\n\n${warnings.map((warning) => `- ${warning}`).join("\n")}` : "",
	].filter(Boolean).join("\n");
	return { markdown, warnings };
}

export function parsePathMemoryPacketInput(value: unknown): PathMemoryPacketInput | undefined {
	const object = asObject(value);
	if (!object) return undefined;
	return object as unknown as PathMemoryPacketInput;
}

function updateTargetFile(type: string | undefined): string {
	switch ((type ?? "decision").toLowerCase().replace(/-/g, "_")) {
		case "incident":
			return "incidents.jsonl";
		case "known_failure":
		case "known_failures":
		case "failure":
			return "known-failures.jsonl";
		case "contract":
			return "contracts.jsonl";
		case "summary":
			return "summaries.jsonl";
		case "decision":
		default:
			return "decisions.jsonl";
	}
}

function updateHistoryType(type: string | undefined): PathMemoryHistoryRecord["history_type"] {
	switch ((type ?? "decision").toLowerCase().replace(/-/g, "_")) {
		case "incident":
			return "incident";
		case "known_failure":
		case "known_failures":
		case "failure":
			return "known_failure";
		case "contract":
			return "contract";
		case "summary":
			return "summary";
		case "decision":
		default:
			return "decision";
	}
}

function normalizeMemoryUpdate(value: unknown, contractId: string | undefined, now: () => number): PathMemoryUpdate | undefined {
	const object = asObject(value);
	if (!object) return undefined;
	const summary = typeof object.summary === "string" ? object.summary.trim() : "";
	const decision = typeof object.decision === "string" ? object.decision.trim() : "";
	const lesson = typeof object.lesson === "string" ? object.lesson.trim() : "";
	if (!summary && !decision && !lesson) return undefined;
	return {
		...object,
		type: typeof object.type === "string" ? object.type : "decision",
		timestamp: new Date(now()).toISOString(),
		source_contract_id: contractId,
	};
}

export function extractMemoryUpdates(source: unknown, fallbackText?: string): unknown[] {
	const object = asObject(source);
	const direct = object?.memory_updates ?? object?.memoryUpdates;
	if (Array.isArray(direct)) return direct;
	const text = fallbackText?.trim();
	if (!text || (!text.startsWith("{") && !text.startsWith("["))) return [];
	try {
		const parsed = JSON.parse(text) as unknown;
		if (Array.isArray(parsed)) return [];
		const parsedObject = asObject(parsed);
		const parsedUpdates = parsedObject?.memory_updates ?? parsedObject?.memoryUpdates;
		return Array.isArray(parsedUpdates) ? parsedUpdates : [];
	} catch {
		return [];
	}
}

export function appendPathMemoryUpdates(
	input: PathMemoryPacketInput | undefined,
	updates: unknown[],
	cwd = process.cwd(),
	now = Date.now,
	options: { pathContract?: PathContract } = {},
): PathMemoryAppendResult {
	const warnings: string[] = [];
	if (!input || updates.length === 0) return { written: 0, skipped: 0, warnings, files: [] };
	if (input.apply_updates_after_validation_pass === false) {
		return { written: 0, skipped: updates.length, warnings: ["Path memory updates disabled by contract."], files: [] };
	}
	const scope = normalizeScope(input);
	if (!scope) return { written: 0, skipped: updates.length, warnings: ["Path memory updates skipped: missing memory_scope."], files: [] };
	const validation = validatePathMemoryUpdates(input, updates, { cwd, pathContract: options.pathContract });
	warnings.push(...validation.warnings);
	const memoryRoot = resolveMemoryPath(cwd, scope.memory_path);
	fs.mkdirSync(memoryRoot, { recursive: true });
	let written = 0;
	let skipped = validation.skipped;
	const files = new Set<string>();
	for (const value of validation.updates) {
		const update = normalizeMemoryUpdate(value, input.contract_id, now);
		if (!update) {
			skipped++;
			continue;
		}
		const filePath = path.join(memoryRoot, updateTargetFile(update.type));
		fs.appendFileSync(filePath, `${JSON.stringify(update)}\n`, { mode: 0o600 });
		const history: PathMemoryHistoryRecord = {
			...update,
			history_type: updateHistoryType(update.type),
			path_id: scope.path_id,
		};
		fs.appendFileSync(path.join(memoryRoot, "history.jsonl"), `${JSON.stringify(history)}\n`, { mode: 0o600 });
		files.add(filePath);
		files.add(path.join(memoryRoot, "history.jsonl"));
		written++;
	}
	return { written, skipped, warnings, files: [...files] };
}
