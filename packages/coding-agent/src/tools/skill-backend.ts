import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { isEnoent, parseFrontmatter } from "@steve-z8k/pi-utils";
import { YAML } from "bun";
import {
	MAX_MANAGED_SKILL_BYTES,
	sanitizeManagedDescription,
	sanitizeSkillName,
	toSkillFrontmatter,
} from "../autolearn/managed-skills";
import { callTool as callMCPTool } from "../mcp/client";
import type { MCPToolCallResult } from "../mcp/types";
import type { ToolSession } from ".";
import { ToolError } from "./tool-errors";

export interface ManagedSkillWriteInput {
	action: "create" | "update";
	name: string;
	description: string;
	body: string;
}

const CIRCLE_MCP_TOOL_NAMES: Record<string, string> = {
	skill_search: "circle_skill_search",
	skill_get: "circle_skill_get",
	put_skill: "circle_skill_put",
	delete_skill: "circle_skill_delete",
};
function circleToolArguments(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
	if (toolName === "skill_get") {
		return { ...args, id: args.id ?? args.name };
	}
	if (toolName === "put_skill") {
		return {
			...args,
			id: args.id ?? args.name,
			title: args.title ?? args.name,
			content: args.content ?? args.body,
			tags: Array.isArray(args.tags) ? args.tags.join(",") : args.tags,
			summary: args.summary ?? args.description,
		};
	}
	if (toolName === "delete_skill") {
		return { ...args, id: args.id ?? args.name };
	}
	return args;
}

export interface SkillGetResult {
	name: string;
	summary: string;
	tags: string[];
	body: string;
	version: number;
}

export interface SkillSearchResult {
	name: string;
	summary: string;
	tags: string[];
	version?: number;
	score: number;
}

export interface SkillListResult {
	name: string;
	summary: string;
	tags: string[];
	version?: number;
}

function toSkillListResult(skill: SkillGetResult): SkillListResult {
	return {
		name: skill.name,
		summary: skill.summary,
		tags: skill.tags,
		version: skill.version,
	};
}

function toSkillSearchResult(skill: SkillGetResult, score: number): SkillSearchResult {
	return {
		...toSkillListResult(skill),
		score,
	};
}

export function stripSkillBodiesFromSearchResult(value: unknown): unknown {
	if (!Array.isArray(value)) return value;
	return value.map(item => {
		if (!item || typeof item !== "object") return item;
		const record = item as Record<string, unknown>;
		return {
			name: record.name,
			summary: record.summary,
			tags: Array.isArray(record.tags) ? record.tags : [],
			...(typeof record.version === "number" ? { version: record.version } : {}),
			...(typeof record.score === "number" ? { score: record.score } : {}),
		};
	});
}

export interface SkillMutationResult {
	name: string;
	version?: number;
	created?: boolean;
	deleted?: boolean;
}

function managedSkillStoreDir(): string {
	return process.env.CIRCLE_SKILLS_DIR?.trim() || path.join(os.homedir(), ".circle", "skills");
}

function skillFilePath(name: string): string {
	return path.join(managedSkillStoreDir(), `${sanitizeSkillName(name)}.md`);
}

function skillDirPath(name: string): string {
	return path.join(managedSkillStoreDir(), sanitizeSkillName(name));
}

async function readJsonFile(filePath: string): Promise<Record<string, unknown>> {
	try {
		const content = await fs.readFile(filePath, "utf8");
		const value = JSON.parse(content);
		return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
	} catch (error) {
		if (isEnoent(error)) return {};
		throw error;
	}
}

async function readTextFile(filePath: string): Promise<string> {
	try {
		return await fs.readFile(filePath, "utf8");
	} catch (error) {
		if (isEnoent(error)) return "";
		throw error;
	}
}

async function readSkillDocument(
	filePath: string,
	safeName: string,
	meta: Record<string, unknown> = {},
	summaryText = "",
): Promise<SkillGetResult | null> {
	try {
		const content = await fs.readFile(filePath, "utf8");
		const { frontmatter, body } = parseFrontmatter(content, { source: filePath });
		if (frontmatter.enabled === false || meta.enabled === false) return null;
		const rawName = frontmatter.name ?? meta.id ?? meta.name ?? meta.title;
		const rawSummary =
			frontmatterSummary(frontmatter) || (typeof meta.summary === "string" ? meta.summary : "") || summaryText;
		const rawTags =
			frontmatterTags(frontmatter).length > 0 ? frontmatterTags(frontmatter) : stringArrayValue(meta.tags);
		const rawVersion = frontmatter.version ?? meta.version;
		return {
			name: typeof rawName === "string" && rawName.trim() ? rawName.trim() : safeName,
			summary: typeof rawSummary === "string" ? rawSummary.trim() : "",
			tags: rawTags,
			body: body.trim(),
			version: typeof rawVersion === "number" && Number.isFinite(rawVersion) ? rawVersion : 1,
		};
	} catch (error) {
		if (isEnoent(error)) return null;
		throw error;
	}
}

function frontmatterSummary(frontmatter: Record<string, unknown>): string {
	const raw = typeof frontmatter.summary === "string" ? frontmatter.summary : frontmatter.description;
	return typeof raw === "string" ? raw : "";
}

function frontmatterTags(frontmatter: Record<string, unknown>): string[] {
	return Array.isArray(frontmatter.tags)
		? frontmatter.tags.filter((tag): tag is string => typeof tag === "string")
		: [];
}

function frontmatterVersion(frontmatter: Record<string, unknown>): number {
	return typeof frontmatter.version === "number" && Number.isFinite(frontmatter.version) ? frontmatter.version : 1;
}

async function readLocalSkill(name: string): Promise<SkillGetResult | null> {
	const safeName = sanitizeSkillName(name);
	const flatSkill = await readSkillDocument(skillFilePath(safeName), safeName);
	if (flatSkill) return flatSkill;

	const dirPath = skillDirPath(safeName);
	const meta = await readJsonFile(path.join(dirPath, "meta.json"));
	const summaryText = (await readTextFile(path.join(dirPath, "summary.txt"))).trim();
	return await readSkillDocument(path.join(dirPath, "SKILL.md"), safeName, meta, summaryText);
}

async function listLocalSkills(): Promise<SkillGetResult[]> {
	let entries: Array<import("node:fs").Dirent>;
	try {
		entries = await fs.readdir(managedSkillStoreDir(), { withFileTypes: true });
	} catch (error) {
		if (isEnoent(error)) return [];
		throw error;
	}
	const skills = await Promise.all(
		entries
			.filter(
				entry =>
					!entry.name.startsWith(".") && ((entry.isFile() && entry.name.endsWith(".md")) || entry.isDirectory()),
			)
			.map(entry => readLocalSkill(entry.isFile() ? path.basename(entry.name, ".md") : entry.name)),
	);
	return skills.filter((skill): skill is SkillGetResult => skill !== null);
}

function localSearchScore(skill: SkillGetResult, query: string): number {
	const terms = query
		.toLowerCase()
		.split(/[^a-z0-9가-힣_-]+/i)
		.filter(Boolean);
	if (terms.length === 0) return 0;
	const haystack = `${skill.name}\n${skill.summary}\n${skill.tags.join(" ")}\n${skill.body}`.toLowerCase();
	let score = 0;
	for (const term of terms) {
		if (skill.name.toLowerCase().includes(term)) score += 4;
		if (skill.summary.toLowerCase().includes(term)) score += 3;
		if (skill.tags.some(tag => tag.toLowerCase().includes(term))) score += 2;
		if (haystack.includes(term)) score += 1;
	}
	return score;
}

function serializeLocalSkill(skill: {
	name: string;
	summary: string;
	tags: string[];
	version: number;
	body: string;
}): string {
	const frontmatter = YAML.stringify(
		{ name: skill.name, summary: skill.summary, tags: skill.tags, version: skill.version },
		null,
		2,
	).trimEnd();
	return `---\n${frontmatter}\n---\n${skill.body.trim()}\n`;
}

const MANAGED_SKILL_TAGS = ["amaze", "managed"];

function parseToolPayload(result: MCPToolCallResult): unknown {
	const text = result.content.find(part => part.type === "text")?.text;
	if (result.isError) {
		throw new ToolError(text || "Circle MCP skill tool failed.");
	}
	if (!text) return null;
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function stringArrayValue(value: unknown): string[] {
	if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
	if (typeof value === "string") {
		return value
			.split(/[,\n]/)
			.map(item => item.trim())
			.filter(Boolean);
	}
	return [];
}

function parseCircleMeta(value: unknown): Record<string, unknown> | undefined {
	if (typeof value === "string") {
		try {
			return recordValue(JSON.parse(value));
		} catch {
			return undefined;
		}
	}
	return recordValue(value);
}

function circleRankScore(rank: unknown): number {
	return typeof rank === "number" && Number.isFinite(rank) ? 1 / Math.max(1, Math.abs(rank)) : 0;
}

function normalizeCircleSearchItem(value: unknown): SkillSearchResult | unknown {
	const record = recordValue(value);
	if (!record) return value;
	if (typeof record.name !== "string" && typeof record.id !== "string") return value;
	const meta = parseCircleMeta(record.meta);
	return {
		name: String(record.name ?? record.id),
		summary: String(record.summary ?? meta?.summary ?? ""),
		tags: stringArrayValue(record.tags).length ? stringArrayValue(record.tags) : stringArrayValue(meta?.tags),
		...(typeof record.version === "number"
			? { version: record.version }
			: typeof meta?.version === "number"
				? { version: meta.version }
				: {}),
		score:
			typeof record.score === "number" && Number.isFinite(record.score)
				? record.score
				: circleRankScore(record.rank),
	};
}

function normalizeCircleGetResult(value: unknown): SkillGetResult | unknown {
	const record = recordValue(value);
	if (!record) return value;
	const meta = parseCircleMeta(record.meta);
	if (record.id === undefined && record.content === undefined && record.meta === undefined) return value;
	return {
		name: String(record.name ?? record.id ?? ""),
		summary: String(record.summary ?? meta?.summary ?? ""),
		tags: stringArrayValue(record.tags).length ? stringArrayValue(record.tags) : stringArrayValue(meta?.tags),
		body: String(record.body ?? record.content ?? ""),
		version:
			typeof record.version === "number" ? record.version : typeof meta?.version === "number" ? meta.version : 1,
	};
}

function normalizeSkillToolResult(toolName: string, value: unknown): unknown {
	if (toolName === "skill_search") {
		const record = recordValue(value);
		if (record && Array.isArray(record.results)) {
			return record.results.map(normalizeCircleSearchItem);
		}
		if (Array.isArray(value)) {
			return value.map(item => {
				const itemRecord = recordValue(item);
				return itemRecord && (itemRecord.id !== undefined || itemRecord.rank !== undefined)
					? normalizeCircleSearchItem(item)
					: item;
			});
		}
	}
	if (toolName === "skill_get") {
		return normalizeCircleGetResult(value);
	}
	return value;
}

function isNotFoundError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /not found|does not exist|KeyError/i.test(message);
}

function circleMcpToolName(toolName: string): string {
	return CIRCLE_MCP_TOOL_NAMES[toolName] ?? toolName;
}

async function callSkillToolViaMCPManager(
	session: ToolSession,
	toolName: string,
	args: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<unknown | undefined> {
	const manager = session.mcpManager;
	if (!manager) return undefined;
	const candidateNames = Array.from(new Set([circleMcpToolName(toolName), toolName]));
	for (const candidateName of candidateNames) {
		const tool = manager
			.getTools()
			.find(
				candidate =>
					candidate.mcpToolName === candidateName &&
					candidate.mcpServerName !== undefined &&
					/circle/i.test(candidate.mcpServerName),
			);
		if (!tool?.mcpServerName) continue;
		const connection = await manager.waitForConnection(tool.mcpServerName).catch(() => undefined);
		if (!connection) continue;
		const callArgs = candidateName === toolName ? args : circleToolArguments(toolName, args);
		const result = await callMCPTool(connection, candidateName, callArgs, { signal });
		return normalizeSkillToolResult(toolName, parseToolPayload(result));
	}
	return undefined;
}

async function callSkillToolViaLocalStore(toolName: string, args: Record<string, unknown>): Promise<unknown> {
	if (toolName === "skill_get") {
		const name = typeof args.name === "string" ? args.name : "";
		const skill = await readLocalSkill(name);
		if (!skill) throw new ToolError(`Skill not found: ${name}`);
		return skill;
	}
	if (toolName === "skill_list") {
		return (await listLocalSkills()).map(toSkillListResult);
	}
	if (toolName === "skill_search") {
		const query = typeof args.query === "string" ? args.query : "";
		const limit = typeof args.limit === "number" && Number.isFinite(args.limit) ? Math.max(1, args.limit) : 10;
		const ranked = (await listLocalSkills())
			.map(skill => ({ skill, score: localSearchScore(skill, query) }))
			.filter(entry => entry.score > 0 || query.trim().length === 0)
			.sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name))
			.slice(0, limit)
			.map(({ skill, score }) => toSkillSearchResult(skill, score));
		return ranked;
	}
	if (toolName === "put_skill") {
		const name = sanitizeSkillName(String(args.name ?? ""));
		const summary = sanitizeManagedDescription(String(args.summary ?? args.description ?? ""));
		const body = String(args.body ?? "").trim();
		const tags = Array.isArray(args.tags)
			? args.tags.filter((tag): tag is string => typeof tag === "string")
			: MANAGED_SKILL_TAGS;
		if (!summary) throw new ToolError(`Managed skill "${name}" needs a non-empty summary.`);
		if (!body) throw new ToolError(`Managed skill "${name}" needs a non-empty body.`);
		const existing = await readLocalSkill(name);
		const version = existing ? existing.version + 1 : 1;
		await fs.mkdir(managedSkillStoreDir(), { recursive: true });
		await fs.writeFile(skillFilePath(name), serializeLocalSkill({ name, summary, tags, version, body }));
		return { name, version, created: !existing };
	}
	if (toolName === "delete_skill") {
		const name = sanitizeSkillName(String(args.name ?? ""));
		try {
			await fs.unlink(skillFilePath(name));
			return { name, deleted: true };
		} catch (error) {
			if (isEnoent(error)) throw new ToolError(`Skill not found: ${name}`);
			throw error;
		}
	}
	throw new ToolError(`Unsupported managed skill local store tool: ${toolName}`);
}

export async function callSkillTool(
	session: ToolSession,
	toolName: string,
	args: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<unknown> {
	const mcpResult = await callSkillToolViaMCPManager(session, toolName, args, signal);
	if (mcpResult !== undefined) {
		if (toolName !== "skill_search" || !Array.isArray(mcpResult) || mcpResult.length > 0) return mcpResult;
		const localResult = await callSkillToolViaLocalStore(toolName, args);
		return Array.isArray(localResult) && localResult.length > 0 ? localResult : mcpResult;
	}
	return await callSkillToolViaLocalStore(toolName, args);
}

async function getManagedSkill(
	session: ToolSession,
	name: string,
	signal?: AbortSignal,
): Promise<SkillGetResult | null> {
	try {
		return (await callSkillTool(session, "skill_get", { name }, signal)) as SkillGetResult;
	} catch (error) {
		if (isNotFoundError(error)) return null;
		throw error;
	}
}

function normalizeWriteInput(input: ManagedSkillWriteInput): { name: string; summary: string; body: string } {
	const name = sanitizeSkillName(input.name);
	const summary = sanitizeManagedDescription(input.description);
	const body = input.body.trim();
	if (!summary) {
		throw new Error(`Managed skill "${name}" needs a non-empty description.`);
	}
	if (!body) {
		throw new Error(`Managed skill "${name}" needs a non-empty body.`);
	}
	const bytes = Buffer.byteLength(`${toSkillFrontmatter(name, summary)}\n${body}\n`, "utf8");
	if (bytes > MAX_MANAGED_SKILL_BYTES) {
		throw new Error(
			`Managed skill is ${bytes} bytes; the limit is ${MAX_MANAGED_SKILL_BYTES}. Trim the body or description.`,
		);
	}
	return { name, summary, body };
}

export async function writeManagedSkill(
	session: ToolSession,
	input: ManagedSkillWriteInput,
	signal?: AbortSignal,
): Promise<SkillMutationResult> {
	const normalized = normalizeWriteInput(input);
	const existing = await getManagedSkill(session, normalized.name, signal);
	if (input.action === "create" && existing) {
		throw new Error(`Managed skill "${normalized.name}" already exists. Use action "update" to change it.`);
	}
	if (input.action === "update" && !existing) {
		throw new Error(`Managed skill "${normalized.name}" does not exist. Use action "create" to add it.`);
	}
	return (await callSkillTool(
		session,
		"put_skill",
		{ name: normalized.name, summary: normalized.summary, body: normalized.body, tags: MANAGED_SKILL_TAGS },
		signal,
	)) as SkillMutationResult;
}

export async function deleteManagedSkill(
	session: ToolSession,
	name: string,
	signal?: AbortSignal,
): Promise<SkillMutationResult> {
	const safeName = sanitizeSkillName(name);
	const existing = await getManagedSkill(session, safeName, signal);
	if (!existing) {
		throw new Error(`Managed skill "${safeName}" does not exist.`);
	}
	return (await callSkillTool(session, "delete_skill", { name: safeName }, signal)) as SkillMutationResult;
}
