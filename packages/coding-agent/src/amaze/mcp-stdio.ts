import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { readdir, readFile, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { VERSION } from "../config.ts";

const execFileAsync = promisify(execFile);

type ToolMode = "minimal" | "standard" | "full";

interface JsonRpcRequest {
	jsonrpc?: "2.0";
	id?: string | number | null;
	method?: string;
	params?: unknown;
}

interface Tool {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	handler: (params: Record<string, unknown>) => Promise<string>;
}

const WORKSPACE_ROOT = resolve(process.cwd());
const TOOL_MODE = parseToolMode(process.env.AMAZE_MCP_TOOL_MODE);
const MAX_READ_BYTES = numberFromEnv("AMAZE_MCP_MAX_READ_BYTES", 80_000, 1_000, 500_000);
const MAX_OUTPUT_BYTES = numberFromEnv("AMAZE_MCP_MAX_OUTPUT_BYTES", 200_000, 10_000, 1_000_000);

function parseToolMode(value: string | undefined): ToolMode {
	if (value === "standard" || value === "full") return value;
	return "minimal";
}

function numberFromEnv(name: string, fallback: number, min: number, max: number): number {
	const value = Number(process.env[name] ?? fallback);
	if (!Number.isFinite(value)) return fallback;
	return Math.max(min, Math.min(max, Math.floor(value)));
}

function isSubpath(child: string, parent: string): boolean {
	const rel = relative(parent, child);
	return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep) && !resolve(rel).startsWith(".."));
}

function resolveWorkspacePath(input: unknown = "."): string {
	const raw = typeof input === "string" && input.trim() ? input : ".";
	const resolved = resolve(WORKSPACE_ROOT, raw);
	if (!isSubpath(resolved, WORKSPACE_ROOT)) {
		throw new Error(`Path escapes workspace: ${raw}`);
	}
	return resolved;
}

function relPath(abs: string): string {
	return relative(WORKSPACE_ROOT, abs) || ".";
}

function truncate(text: string, maxBytes = MAX_OUTPUT_BYTES): string {
	const bytes = Buffer.byteLength(text);
	if (bytes <= maxBytes) return text;
	return `${Buffer.from(text).subarray(0, maxBytes).toString("utf8")}\n\n[truncated ${bytes - maxBytes} bytes]`;
}

function redact(text: string): string {
	return text
		.replace(/\bsk-[A-Za-z0-9_-]{10,}\b/g, "[REDACTED_SECRET]")
		.replace(
			/\b[A-Za-z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PRIVATE[_-]?KEY)[A-Za-z0-9_]*\s*=\s*(?:"[^"\r\n]{12,}"|'[^'\r\n]{12,}'|`[^`\r\n]{12,}`|[A-Za-z0-9_./+=-]{20,})/gi,
			(match) => `${match.slice(0, Math.max(0, match.indexOf("="))).trimEnd()}= [REDACTED_SECRET]`,
		);
}

async function git(args: string[]): Promise<string> {
	try {
		const { stdout, stderr } = await execFileAsync("git", args, { cwd: WORKSPACE_ROOT, timeout: 5_000, maxBuffer: MAX_OUTPUT_BYTES });
		return truncate(redact(`${stdout}${stderr ? `\n[stderr]\n${stderr}` : ""}`));
	} catch (error) {
		return `git unavailable or failed: ${error instanceof Error ? error.message : String(error)}`;
	}
}

async function tree(root: string, maxDepth: number, maxEntries: number): Promise<string> {
	const lines: string[] = [];
	let count = 0;
	async function walk(dir: string, depth: number): Promise<void> {
		if (count >= maxEntries || depth > maxDepth) return;
		const entries = await readdir(dir, { withFileTypes: true });
		for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
			if (count >= maxEntries) break;
			if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "dist") continue;
			const abs = resolve(dir, entry.name);
			lines.push(`${"  ".repeat(depth)}${entry.isDirectory() ? "dir " : "file"} ${relPath(abs)}`);
			count++;
			if (entry.isDirectory()) await walk(abs, depth + 1);
		}
	}
	await walk(root, 0);
	if (count >= maxEntries) lines.push(`[truncated at ${maxEntries} entries]`);
	return lines.join("\n") || "(empty)";
}

async function readText(pathInput: unknown): Promise<string> {
	const abs = resolveWorkspacePath(pathInput);
	const info = await stat(abs);
	if (!info.isFile()) throw new Error(`Not a file: ${relPath(abs)}`);
	const buffer = await readFile(abs);
	if (buffer.subarray(0, Math.min(buffer.length, 4096)).includes(0)) throw new Error(`Refusing binary file: ${relPath(abs)}`);
	const text = buffer.subarray(0, Math.min(buffer.length, MAX_READ_BYTES)).toString("utf8");
	const suffix = buffer.length > MAX_READ_BYTES ? `\n\n[truncated ${buffer.length - MAX_READ_BYTES} bytes]` : "";
	return redact(`### ${relPath(abs)}\nsha256: ${createHash("sha256").update(buffer).digest("hex")}\nbytes: ${buffer.length}\n\n${text}${suffix}`);
}

async function textSearch(params: Record<string, unknown>): Promise<string> {
	const query = String(params.query ?? "");
	if (!query) throw new Error("query is required");
	const root = resolveWorkspacePath(params.path);
	const maxResults = Math.max(1, Math.min(200, Number(params.maxResults ?? 50)));
	const args = ["--line-number", "--color=never", "--hidden", "--glob", "!.git/**", "--glob", "!node_modules/**", "--glob", "!dist/**", "--", query, root];
	try {
		const { stdout } = await execFileAsync("rg", args, { cwd: WORKSPACE_ROOT, timeout: 10_000, maxBuffer: MAX_OUTPUT_BYTES });
		return truncate(redact(stdout.split("\n").slice(0, maxResults).join("\n")));
	} catch (error) {
		const anyError = error as { stdout?: string; code?: number };
		if (anyError.code === 1) return "(no matches)";
		if (typeof anyError.stdout === "string" && anyError.stdout) return truncate(redact(anyError.stdout.split("\n").slice(0, maxResults).join("\n")));
		throw error;
	}
}

const minimalTools: Tool[] = [
	{
		name: "server_config",
		description: "Show the amaze MCP bridge configuration without exposing secrets.",
		inputSchema: { type: "object", properties: {} },
		async handler() {
			return JSON.stringify({ name: "amaze-mcp", version: VERSION, workspaceRoot: WORKSPACE_ROOT, toolMode: TOOL_MODE, maxReadBytes: MAX_READ_BYTES, maxOutputBytes: MAX_OUTPUT_BYTES }, null, 2);
		},
	},
	{
		name: "workspace_snapshot",
		description: "Return a compact read-only workspace snapshot with git status and optional tree.",
		inputSchema: {
			type: "object",
			properties: {
				includeTree: { type: "boolean", description: "Include compact file tree." },
				maxDepth: { type: "number", description: "Tree depth, default 2." },
				maxEntries: { type: "number", description: "Tree entry limit, default 120." },
			},
		},
		async handler(params) {
			const statusText = await git(["status", "--short"]);
			const branch = await git(["branch", "--show-current"]);
			const parts = [`# Workspace Snapshot`, `Root: ${WORKSPACE_ROOT}`, `Branch: ${branch.trim() || "(unknown)"}`, "", "## Git Status", statusText.trim() || "(clean)"];
			if (params.includeTree === true) {
				parts.push("", "## Tree", await tree(WORKSPACE_ROOT, Number(params.maxDepth ?? 2), Number(params.maxEntries ?? 120)));
			}
			return truncate(parts.join("\n"));
		},
	},
	{
		name: "context_bundle",
		description: "Build a compact external-model context bundle from workspace metadata, git status, diff summary, and selected files.",
		inputSchema: {
			type: "object",
			properties: {
				paths: { type: "array", items: { type: "string" }, description: "Workspace-relative files to include." },
				includeDiff: { type: "boolean", description: "Include git diff --stat and diff --name-only." },
			},
		},
		async handler(params) {
			const paths = Array.isArray(params.paths) ? params.paths.slice(0, 12) : [];
			const parts = ["# amaze Context Bundle", "", "## Workspace", WORKSPACE_ROOT, "", "## Git Status", await git(["status", "--short"])];
			if (params.includeDiff === true) {
				parts.push("", "## Git Diff Summary", await git(["diff", "--stat"]), "", "## Changed Files", await git(["diff", "--name-only"]));
			}
			for (const item of paths) {
				parts.push("", await readText(item));
			}
			return truncate(parts.join("\n"));
		},
	},
];

const standardTools: Tool[] = [
	...minimalTools,
	{
		name: "read_file",
		description: "Read one text file inside the workspace with byte limits and secret redaction.",
		inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
		async handler(params) {
			return readText(params.path);
		},
	},
	{
		name: "text_search",
		description: "Run a bounded literal ripgrep search inside the workspace. Prefer amaze semantic/AST tools in native amaze sessions.",
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string" },
				path: { type: "string" },
				maxResults: { type: "number" },
			},
			required: ["query"],
		},
		handler: textSearch,
	},
];

function activeTools(): Tool[] {
	return TOOL_MODE === "minimal" ? minimalTools : standardTools;
}

function result(id: JsonRpcRequest["id"], value: unknown): void {
	process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result: value })}\n`);
}

function error(id: JsonRpcRequest["id"], code: number, message: string): void {
	process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
}

async function handle(request: JsonRpcRequest): Promise<void> {
	if (request.id === undefined || request.id === null) return;
	if (request.method === "initialize") {
		result(request.id, {
			protocolVersion: "2024-11-05",
			capabilities: { tools: {} },
			serverInfo: { name: "amaze-mcp", version: VERSION },
		});
		return;
	}
	if (request.method === "tools/list") {
		result(request.id, { tools: activeTools().map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
		return;
	}
	if (request.method === "tools/call") {
		const params = request.params as { name?: string; arguments?: Record<string, unknown> } | undefined;
		const tool = activeTools().find((candidate) => candidate.name === params?.name);
		if (!tool) {
			error(request.id, -32602, `Unknown tool: ${params?.name ?? "(missing)"}`);
			return;
		}
		const text = await tool.handler(params?.arguments ?? {});
		result(request.id, { content: [{ type: "text", text }] });
		return;
	}
	error(request.id, -32601, `Method not found: ${request.method ?? "(missing)"}`);
}

export async function runMcpStdio(): Promise<void> {
	const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
	for await (const line of rl) {
		if (!line.trim()) continue;
		try {
			await handle(JSON.parse(line) as JsonRpcRequest);
		} catch (err) {
			error(null, -32000, err instanceof Error ? err.message : String(err));
		}
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	runMcpStdio().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
