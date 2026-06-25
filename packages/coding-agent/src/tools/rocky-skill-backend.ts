import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { isEnoent, parseFrontmatter } from "@amaze/pi-utils";
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

export interface RockyManagedSkillWriteInput {
	action: "create" | "update";
	name: string;
	description: string;
	body: string;
}

interface JsonRpcResponse {
	result?: {
		content?: Array<{ type?: string; text?: string }>;
		isError?: boolean;
	};
	error?: { message?: string };
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

const ROCKY_SKILLS_HTTP_FALLBACK_ENV = "ROCKY_SKILLS_USE_HTTP";

function rockySkillsDir(): string {
	return process.env.ROCKY_SKILLS_DIR?.trim() || path.join(os.homedir(), ".rocky", "skills");
}

function skillFilePath(name: string): string {
	return path.join(rockySkillsDir(), `${sanitizeSkillName(name)}.md`);
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
	const filePath = skillFilePath(safeName);
	try {
		const content = await Bun.file(filePath).text();
		const { frontmatter, body } = parseFrontmatter(content, { source: filePath });
		if (frontmatter.enabled === false) return null;
		return {
			name: typeof frontmatter.name === "string" && frontmatter.name.trim() ? frontmatter.name.trim() : safeName,
			summary: frontmatterSummary(frontmatter),
			tags: frontmatterTags(frontmatter),
			body: body.trim(),
			version: frontmatterVersion(frontmatter),
		};
	} catch (error) {
		if (isEnoent(error)) return null;
		throw error;
	}
}

async function listLocalSkills(): Promise<SkillGetResult[]> {
	let entries: Array<import("node:fs").Dirent>;
	try {
		entries = await fs.readdir(rockySkillsDir(), { withFileTypes: true });
	} catch (error) {
		if (isEnoent(error)) return [];
		throw error;
	}
	const skills = await Promise.all(
		entries
			.filter(entry => entry.isFile() && !entry.name.startsWith(".") && entry.name.endsWith(".md"))
			.map(entry => readLocalSkill(path.basename(entry.name, ".md"))),
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

const ROCKY_SKILL_TAGS = ["amaze", "managed"];

function rockyApiBase(session: ToolSession): string | undefined {
	const configured = session.settings?.get("rocky.apiUrl") || process.env.ROCKY_API_URL;
	if (!configured) return undefined;
	return String(configured).replace(/\/+$/, "");
}

function rockyAuthHeaders(): Record<string, string> {
	const apiKey = process.env.ROCKY_API_KEY?.trim();
	return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

function parseToolPayload(result: MCPToolCallResult): unknown {
	const text = result.content.find(part => part.type === "text")?.text;
	if (result.isError) {
		throw new ToolError(text || "Rocky skill tool failed.");
	}
	if (!text) return null;
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

function parseJsonRpcPayload(payload: JsonRpcResponse): unknown {
	if (payload.error) {
		throw new ToolError(`Rocky MCP request failed: ${payload.error.message ?? JSON.stringify(payload.error)}`);
	}
	const text = payload.result?.content?.find(part => part.type === "text")?.text;
	if (payload.result?.isError) {
		throw new ToolError(text || "Rocky skill tool failed.");
	}
	if (!text) return null;
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

function isNotFoundError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /not found|does not exist|KeyError/i.test(message);
}

async function callRockySkillToolViaMCPManager(
	session: ToolSession,
	toolName: string,
	args: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<unknown | undefined> {
	const manager = session.mcpManager;
	if (!manager) return undefined;
	const tool = manager
		.getTools()
		.find(
			candidate =>
				candidate.mcpToolName === toolName &&
				candidate.mcpServerName !== undefined &&
				/rocky/i.test(candidate.mcpServerName),
		);
	if (!tool?.mcpServerName) return undefined;
	const connection = await manager.waitForConnection(tool.mcpServerName).catch(() => undefined);
	if (!connection) return undefined;
	const result = await callMCPTool(connection, toolName, args, { signal });
	return parseToolPayload(result);
}

async function callRockySkillToolViaHttp(
	session: ToolSession,
	toolName: string,
	args: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<unknown> {
	const baseUrl = rockyApiBase(session);
	if (!baseUrl) {
		throw new ToolError("Rocky skill management requires rocky.apiUrl or ROCKY_API_URL.");
	}
	const fetchImpl = session.fetch ?? fetch;
	const response = await fetchImpl(`${baseUrl}/mcp`, {
		method: "POST",
		headers: { "Content-Type": "application/json", ...rockyAuthHeaders() },
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: { name: toolName, arguments: args },
		}),
		signal,
	});
	const text = await response.text();
	if (!response.ok) {
		throw new ToolError(
			response.status === 401
				? "Rocky MCP authentication failed. Set ROCKY_API_KEY for the Rocky server."
				: `Rocky MCP request failed (${response.status}): ${text}`,
		);
	}
	return parseJsonRpcPayload(JSON.parse(text) as JsonRpcResponse);
}

async function callRockySkillToolViaLocalStore(toolName: string, args: Record<string, unknown>): Promise<unknown> {
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
	if (toolName === "skill_upsert") {
		const name = sanitizeSkillName(String(args.name ?? ""));
		const summary = sanitizeManagedDescription(String(args.summary ?? args.description ?? ""));
		const body = String(args.body ?? "").trim();
		const tags = Array.isArray(args.tags)
			? args.tags.filter((tag): tag is string => typeof tag === "string")
			: ROCKY_SKILL_TAGS;
		if (!summary) throw new ToolError(`Managed skill "${name}" needs a non-empty summary.`);
		if (!body) throw new ToolError(`Managed skill "${name}" needs a non-empty body.`);
		const existing = await readLocalSkill(name);
		const version = existing ? existing.version + 1 : 1;
		await fs.mkdir(rockySkillsDir(), { recursive: true });
		await fs.writeFile(skillFilePath(name), serializeLocalSkill({ name, summary, tags, version, body }));
		return { name, version, created: !existing };
	}
	if (toolName === "skill_delete") {
		const name = sanitizeSkillName(String(args.name ?? ""));
		try {
			await fs.unlink(skillFilePath(name));
			return { name, deleted: true };
		} catch (error) {
			if (isEnoent(error)) throw new ToolError(`Skill not found: ${name}`);
			throw error;
		}
	}
	throw new ToolError(`Unsupported local Rocky skill tool: ${toolName}`);
}

export async function callRockySkillTool(
	session: ToolSession,
	toolName: string,
	args: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<unknown> {
	const mcpResult = await callRockySkillToolViaMCPManager(session, toolName, args, signal);
	if (mcpResult !== undefined) return mcpResult;
	const localResult = await callRockySkillToolViaLocalStore(toolName, args);
	if (process.env[ROCKY_SKILLS_HTTP_FALLBACK_ENV]?.trim() === "1") {
		return await callRockySkillToolViaHttp(session, toolName, args, signal);
	}
	return localResult;
}

async function getRockyManagedSkill(
	session: ToolSession,
	name: string,
	signal?: AbortSignal,
): Promise<SkillGetResult | null> {
	try {
		return (await callRockySkillTool(session, "skill_get", { name }, signal)) as SkillGetResult;
	} catch (error) {
		if (isNotFoundError(error)) return null;
		throw error;
	}
}

function normalizeWriteInput(input: RockyManagedSkillWriteInput): { name: string; summary: string; body: string } {
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

export async function writeRockyManagedSkill(
	session: ToolSession,
	input: RockyManagedSkillWriteInput,
	signal?: AbortSignal,
): Promise<SkillMutationResult> {
	const normalized = normalizeWriteInput(input);
	const existing = await getRockyManagedSkill(session, normalized.name, signal);
	if (input.action === "create" && existing) {
		throw new Error(`Managed skill "${normalized.name}" already exists. Use action "update" to change it.`);
	}
	if (input.action === "update" && !existing) {
		throw new Error(`Managed skill "${normalized.name}" does not exist. Use action "create" to add it.`);
	}
	return (await callRockySkillTool(
		session,
		"skill_upsert",
		{ name: normalized.name, summary: normalized.summary, body: normalized.body, tags: ROCKY_SKILL_TAGS },
		signal,
	)) as SkillMutationResult;
}

export async function deleteRockyManagedSkill(
	session: ToolSession,
	name: string,
	signal?: AbortSignal,
): Promise<SkillMutationResult> {
	const safeName = sanitizeSkillName(name);
	const existing = await getRockyManagedSkill(session, safeName, signal);
	if (!existing) {
		throw new Error(`Managed skill "${safeName}" does not exist.`);
	}
	return (await callRockySkillTool(session, "skill_delete", { name: safeName }, signal)) as SkillMutationResult;
}
