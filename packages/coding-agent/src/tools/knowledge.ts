import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentTool, AgentToolResult } from "@amaze/agent-core";
import { untilAborted } from "@amaze/utils";
import * as z from "zod/v4";
import { createMCPToolName } from "../mcp/tool-bridge";
import { searchOkf } from "../okf/search";
import { DEFAULT_OKF_PATH, OkfStore, qualityIssuesForDocument, safePathInside } from "../okf/store";
import type { OkfDocument } from "../okf/types";
import type { ToolSession } from "./index";

const registrySchema = z.object({
	slug: z.string().optional().describe("Optional knowledge registry page slug. Defaults to knowledge.registrySlug."),
	fuzzy: z.boolean().optional().default(false).describe("Whether to allow fuzzy page lookup. Default false."),
});

const querySchema = z.object({
	query: z.string().describe("Scoped knowledge query."),
	client_source_id: z.string().optional().describe("Optional client/project source id overriding configured defaults."),
	limit: z.number().int().min(1).max(20).optional().describe("Maximum results to return, 1..20."),
});
const okfPageGetSchema = z
	.object({
		slug: z.string().optional().describe("OKF markdown page slug to read."),
		id: z.string().optional().describe("OKF document id to load when slug is absent."),
		fuzzy: z.boolean().optional().default(false).describe("Whether to allow fuzzy slug lookup."),
	})
	.refine(params => Boolean(params.slug?.trim() || params.id?.trim()), "slug or id is required");

const okfQuerySchema = z.object({
	query: z.string().describe("OKF claim/tag query."),
	source_id: z.string().optional().describe("Optional OKF source scope. __all__ disables source filtering."),
	limit: z.number().int().min(1).max(20).optional().describe("Maximum results to return, 1..20."),
	tags: z.array(z.string()).optional().describe("Tags that all matching OKF docs must include."),
});

const okfSourceKinds = ["mission", "task", "tool", "evidence", "verifier", "proposal", "provider", "human", "file", "url"] as const;

const okfRecordSchema = z.object({
	claim: z.string().describe("Claim text for the OKF document."),
	source_uri: z.string().describe("Source reference URI."),
	source_kind: z.enum(okfSourceKinds).optional().default("human").describe("Source reference kind. Default human."),
	scope: z.string().optional().default("global").describe("Knowledge scope. Default global."),
	confidence: z.string().optional().default("medium").describe("Knowledge confidence. Default medium."),
	tags: z.array(z.string()).optional().default([]).describe("OKF tags."),
	id: z.string().optional().describe("Optional OKF document id."),
	file_path: z.string().optional().describe("Optional workspace-relative file path."),
});

const okfToolMethodQuerySchema = z.object({
	query: z.string().describe("Tool-method query."),
	limit: z.number().int().min(1).max(20).optional().describe("Maximum results to return, 1..20."),
	tool: z.string().optional().describe("Optional tool name; requires tag tool:<tool>."),
});

const okfBenchmarkRecordSchema = z.object({
	suite: z.string().describe("Benchmark suite name."),
	case_id: z.string().describe("Benchmark case id."),
	passed: z.boolean().describe("Whether the benchmark case passed."),
	summary: z.string().describe("Benchmark result summary."),
	expected_tool: z.string().optional().describe("Expected tool name."),
	actual_tool: z.string().optional().describe("Actual tool name."),
	source_id: z.string().optional().describe("Optional source id tag."),
});

const okfHealthSchema = z.object({});


type RegistryParams = z.infer<typeof registrySchema>;
type QueryParams = z.infer<typeof querySchema>;
type OkfPageGetParams = z.infer<typeof okfPageGetSchema>;
type OkfQueryParams = z.infer<typeof okfQuerySchema>;
type OkfRecordParams = z.input<typeof okfRecordSchema>;
type OkfToolMethodQueryParams = z.infer<typeof okfToolMethodQuerySchema>;
type OkfBenchmarkRecordParams = z.infer<typeof okfBenchmarkRecordSchema>;

export interface KnowledgeToolDetails {
	mcpToolName?: string;
	sourceId?: string;
	error?: string;
	[key: string]: unknown;
}

type JsonSchemaObject = {
	type?: string | string[];
	enum?: unknown[];
	default?: unknown;
	properties?: Record<string, JsonSchemaObject>;
	required?: string[];
};
type QueryArgs = Record<string, string | number | boolean>;

type ExecutableTool = AgentTool & {
	execute: (...args: unknown[]) => Promise<AgentToolResult<unknown>>;
};

function textResult(
	text: string,
	details: KnowledgeToolDetails = {},
	isError = false,
): AgentToolResult<KnowledgeToolDetails> {
	return {
		content: [{ type: "text", text }],
		details,
		...(isError ? { isError: true } : {}),
	};
}

function getConfiguredServerName(session: ToolSession): string {
	const configured = session.settings.get("knowledge.mcpServer")?.trim();
	return configured || "memory-worker";
}

function getMcpTool(session: ToolSession, mcpToolName: "get_page" | "query"): { name: string; tool?: ExecutableTool } {
	const name = createMCPToolName(getConfiguredServerName(session), mcpToolName);
	const tool = session.getToolByName?.(name) as ExecutableTool | undefined;
	return { name, tool };
}

function getTextContent(result: AgentToolResult<unknown>): string {
	return result.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
		.map(part => part.text)
		.join("\n");
}

function withMcpError(
	result: AgentToolResult<unknown>,
	details: KnowledgeToolDetails,
): AgentToolResult<KnowledgeToolDetails> {
	return {
		content: [{ type: "text", text: getTextContent(result) }],
		details,
		...(result.isError ? { isError: true } : {}),
	};
}

async function executeMcpTool(
	tool: ExecutableTool,
	toolCallId: string,
	params: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<AgentToolResult<unknown>> {
	return await tool.execute(toolCallId, params, signal);
}

function isEnabled(session: ToolSession): boolean {
	return session.settings.get("knowledge.enabled") === true;
}

function okfRoot(session: ToolSession): string {
	return path.resolve(expandHome(session.settings.get("knowledge.okfPath") ?? DEFAULT_OKF_PATH));
}

function expandHome(value: string): string {
	return value === "~" || value.startsWith("~/") ? path.join(Bun.env.HOME ?? "", value.slice(2)) : value;
}

function slugCandidates(slug: string): string[] {
	const trimmed = slug.trim().replace(/^\/+|\/+$/g, "");
	if (!trimmed) return [];
	const encoded = encodeURIComponent(trimmed).replaceAll("%", "_");
	const candidates = [trimmed, encoded];
	return [...new Set(candidates.flatMap(candidate => [candidate, candidate.endsWith(".md") ? candidate : `${candidate}.md`]))];
}

function readOkfPage(rootDir: string, slug: string, fuzzy: boolean): string | undefined {
	for (const candidate of slugCandidates(slug)) {
		const targetPath = safePathInside(rootDir, path.join(rootDir, candidate));
		if (fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()) {
			return fs.readFileSync(targetPath, "utf8");
		}
	}
	if (!fuzzy) return undefined;

	const needle = slug.toLocaleLowerCase();
	for (const markdownPath of discoverMarkdownFiles(rootDir)) {
		const relative = path.relative(rootDir, markdownPath).replaceAll(path.sep, "/");
		const relativeWithoutExtension = relative.endsWith(".md") ? relative.slice(0, -3) : relative;
		if (
			relative.toLocaleLowerCase().includes(needle) ||
			relativeWithoutExtension.toLocaleLowerCase().includes(needle)
		) {
			return fs.readFileSync(markdownPath, "utf8");
		}
	}
	return undefined;
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

function okfQueryMatchesSource(document: OkfDocument, sourceId: string): boolean {
	if (sourceId === "__all__") return true;
	const sourceTag = normalizedOkfTag(sourceId);
	return document.tags.includes(sourceId) || document.tags.includes(sourceTag) || document.sourceRefs.some(ref => ref.uri === sourceId || ref.uri.startsWith(`${sourceId}:`));
}

function normalizeOkfBridgeError(message: string): string {
	return message.replace(/OKF tags must be a string array:/g, "OKF tags must be a valid string array:");
}

function normalizedOkfTag(tag: string): string {
	return tag.replaceAll(":", "-");
}


function formatOkfDocument(document: OkfDocument): string {
	const refs = document.sourceRefs.map(ref => `${ref.kind}:${ref.uri}`).join(", ");
	const tags = document.tags.length > 0 ? `\nTags: ${document.tags.join(", ")}` : "";
	const filePath = document.filePath ? `\nFile: ${document.filePath}` : "";
	return `${document.claim}\nID: ${document.id}\nScope: ${document.scope}\nConfidence: ${document.confidence}${filePath}${tags}\nSources: ${refs}`;
}

function formatOkfQueryResults(results: Array<{ document: OkfDocument; score: number }>, sourceId: string): string {
	if (results.length === 0) return `No OKF results for source_id ${sourceId}.`;
	return results
		.map((result, index) => `${index + 1}. ${formatOkfDocument(result.document)}\nScore: ${result.score}`)
		.join("\n\n");
}

function searchOkfScoped(
	store: OkfStore,
	params: { query: string; sourceId?: string; tags?: string[]; limit: number },
): Array<{ document: OkfDocument; score: number }> {
	const sourceId = params.sourceId ?? "__all__";
	const searchLimit = Math.max(1000, params.limit * 50);
	return searchOkf(store, {
		claimLike: params.query,
		activeOnly: true,
		tags: params.tags?.map(normalizedOkfTag),
		limit: searchLimit,
	})
		.filter(result => okfQueryMatchesSource(result.document, sourceId))
		.slice(0, params.limit);
}

function recordOkfDocument(store: OkfStore, params: OkfRecordParams): OkfDocument {
	const document = store.record({
		...(params.id?.trim() ? { id: params.id.trim() } : {}),
		claim: params.claim,
		scope: (params.scope || "global") as OkfDocument["scope"],
		confidence: (params.confidence || "medium") as OkfDocument["confidence"],
		filePath: params.file_path?.trim() || null,
		contentHash: null,
		supersedes: null,
		sourceRefs: [{ kind: (params.source_kind || "human") as OkfDocument["sourceRefs"][number]["kind"], uri: params.source_uri }],
		tags: params.tags ?? [],
	});
	return document;
}

export class OkfHealthTool implements AgentTool<typeof okfHealthSchema, KnowledgeToolDetails> {
	readonly name = "okf_health";
	readonly label = "OKF Health";
	readonly summary = "Check local OKF store health";
	readonly loadMode = "discoverable";
	readonly parameters = okfHealthSchema;
	readonly strict = true;
	readonly description = "Check configured OKF root, registry slug, markdown count, and malformed OKF documents.";

	constructor(private readonly session: ToolSession) {}

	static createIf(session: ToolSession): OkfHealthTool | null {
		return isEnabled(session) && getConfiguredServerName(session) === "memory-worker" ? new OkfHealthTool(session) : null;
	}

	async execute(_toolCallId: string, _params: {}, signal?: AbortSignal): Promise<AgentToolResult<KnowledgeToolDetails>> {
		return untilAborted(signal, async () => {
			const root = okfRoot(this.session);
			const registrySlug = this.session.settings.get("knowledge.registrySlug") || "okf/knowledge-registry";
			const rootExists = fs.existsSync(root) && fs.statSync(root).isDirectory();
			const markdownFiles = discoverMarkdownFiles(root);
			const invalid: Array<{ path: string; error: string }> = [];
			const qualityIssues: Array<{ id: string; severity: string; field: string; message: string }> = [];
			for (const markdownPath of markdownFiles) {
				const tempRoot = fs.mkdtempSync(path.join(Bun.env.TMPDIR ?? "/tmp", "okf-health-"));
				try {
					fs.copyFileSync(markdownPath, path.join(tempRoot, path.basename(markdownPath)));
					const documents = new OkfStore(tempRoot).query({ limit: 1000, activeOnly: false });
					for (const document of documents) qualityIssues.push(...qualityIssuesForDocument(document));
				} catch (error) {
					invalid.push({
						path: path.relative(root, markdownPath).replaceAll(path.sep, "/"),
						error: normalizeOkfBridgeError(error instanceof Error ? error.message : String(error)),
					});
				} finally {
					fs.rmSync(tempRoot, { recursive: true, force: true });
				}
			}
			const registryExists = readOkfPage(root, registrySlug, false) !== undefined;
			const details = {
				root,
				rootExists,
				registrySlug,
				registryExists,
				markdownCount: markdownFiles.length,
				invalidMarkdownCount: invalid.length,
				invalidMarkdown: invalid.slice(0, 10),
				qualityIssueCount: qualityIssues.length,
				qualityIssues: qualityIssues.slice(0, 10),
			};
			const invalidText =
				invalid.length === 0
					? "Invalid markdown: 0"
					: `Invalid markdown: ${invalid.length}\n${invalid
							.slice(0, 10)
							.map(item => `- ${item.path}: ${item.error}`)
							.join("\n")}`;
			const qualityText =
				qualityIssues.length === 0
					? "Quality warnings: 0"
					: `Quality warnings: ${qualityIssues.length}\n${qualityIssues
							.slice(0, 10)
							.map(item => `- ${item.id} ${item.field}: ${item.message}`)
							.join("\n")}`;
			return textResult(
				[
					`OKF root: ${root}`,
					`Root exists: ${rootExists}`,
					`Registry slug: ${registrySlug}`,
					`Registry exists: ${registryExists}`,
					`Markdown files: ${markdownFiles.length}`,
					invalidText,
					qualityText,
				].join("\n"),
				details,
			);
		});
	}
}

export class OkfPageGetTool implements AgentTool<typeof okfPageGetSchema, KnowledgeToolDetails> {
	readonly name = "okf_page_get";
	readonly label = "OKF Page Get";
	readonly summary = "Read an OKF page by slug or document id";
	readonly loadMode = "discoverable";
	readonly parameters = okfPageGetSchema;
	readonly strict = true;
	readonly description = "Read a raw OKF markdown page by slug, or a formatted OKF document by id.";

	constructor(private readonly session: ToolSession) {}

	static createIf(session: ToolSession): OkfPageGetTool | null {
		return isEnabled(session) && getConfiguredServerName(session) === "memory-worker" ? new OkfPageGetTool(session) : null;
	}

	async execute(_toolCallId: string, params: OkfPageGetParams, signal?: AbortSignal): Promise<AgentToolResult<KnowledgeToolDetails>> {
		return untilAborted(signal, async () => {
			try {
				const root = okfRoot(this.session);
				const slug = params.slug?.trim();
				if (slug) {
					const page = readOkfPage(root, slug, params.fuzzy ?? false);
					if (page === undefined) return textResult(`OKF page not found: ${slug}`, { error: "page_not_found" }, true);
					return textResult(page);
				}
				const id = params.id?.trim();
				if (!id) return textResult("slug or id is required.", { error: "missing_identifier" }, true);
				const document = new OkfStore(root).get(id);
				if (!document) return textResult(`OKF document not found: ${id}`, { error: "page_not_found" }, true);
				return textResult(formatOkfDocument(document));
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return textResult(`OKF page get failed: ${normalizeOkfBridgeError(message)}`, { error: "page_get_failed" }, true);
			}
		});
	}
}

export class OkfQueryTool implements AgentTool<typeof okfQuerySchema, KnowledgeToolDetails> {
	readonly name = "okf_query";
	readonly label = "OKF Query";
	readonly summary = "Search local OKF documents";
	readonly loadMode = "discoverable";
	readonly parameters = okfQuerySchema;
	readonly strict = true;
	readonly description = "Search active OKF docs with source and tag filters applied before final limiting.";

	constructor(private readonly session: ToolSession) {}

	static createIf(session: ToolSession): OkfQueryTool | null {
		return isEnabled(session) && getConfiguredServerName(session) === "memory-worker" ? new OkfQueryTool(session) : null;
	}

	async execute(_toolCallId: string, params: OkfQueryParams, signal?: AbortSignal): Promise<AgentToolResult<KnowledgeToolDetails>> {
		return untilAborted(signal, async () => {
			const query = params.query.trim();
			if (!query) return textResult("Query is required and must not be empty.", { error: "empty_query" }, true);
			const sourceId = params.source_id?.trim() || "__all__";
			try {
				const results = searchOkfScoped(new OkfStore(okfRoot(this.session)), {
					query,
					sourceId,
					tags: params.tags,
					limit: params.limit ?? 10,
				});
				return textResult(formatOkfQueryResults(results, sourceId), { sourceId });
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return textResult(`OKF query failed: ${normalizeOkfBridgeError(message)}`, { sourceId, error: "query_failed" }, true);
			}
		});
	}
}

export class OkfRecordTool implements AgentTool<typeof okfRecordSchema, KnowledgeToolDetails> {
	readonly name = "okf_record";
	readonly label = "OKF Record";
	readonly summary = "Record a local OKF document";
	readonly loadMode = "discoverable";
	readonly parameters = okfRecordSchema;
	readonly strict = true;
	readonly description = "Create a valid OKF document in the configured OKF store.";

	constructor(private readonly session: ToolSession) {}

	static createIf(session: ToolSession): OkfRecordTool | null {
		return isEnabled(session) && getConfiguredServerName(session) === "memory-worker" ? new OkfRecordTool(session) : null;
	}

	async execute(_toolCallId: string, params: OkfRecordParams, signal?: AbortSignal): Promise<AgentToolResult<KnowledgeToolDetails>> {
		return untilAborted(signal, async () => {
			try {
				const document = recordOkfDocument(new OkfStore(okfRoot(this.session)), params);
				return textResult(`Recorded OKF document.\nID: ${document.id}\nClaim: ${document.claim}`, { sourceId: params.source_uri });
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return textResult(`OKF record failed: ${normalizeOkfBridgeError(message)}`, { error: "record_failed" }, true);
			}
		});
	}
}

export class OkfToolMethodQueryTool implements AgentTool<typeof okfToolMethodQuerySchema, KnowledgeToolDetails> {
	readonly name = "okf_tool_method_query";
	readonly label = "OKF Tool Method Query";
	readonly summary = "Search OKF tool-method documents";
	readonly loadMode = "discoverable";
	readonly parameters = okfToolMethodQuerySchema;
	readonly strict = true;
	readonly description = "Query OKF docs tagged okf:type:tool-method and optionally tool:<tool>.";

	constructor(private readonly session: ToolSession) {}

	static createIf(session: ToolSession): OkfToolMethodQueryTool | null {
		return isEnabled(session) && getConfiguredServerName(session) === "memory-worker" ? new OkfToolMethodQueryTool(session) : null;
	}

	async execute(
		_toolCallId: string,
		params: OkfToolMethodQueryParams,
		signal?: AbortSignal,
	): Promise<AgentToolResult<KnowledgeToolDetails>> {
		return untilAborted(signal, async () => {
			const query = params.query.trim();
			if (!query) return textResult("Query is required and must not be empty.", { error: "empty_query" }, true);
			const tags = ["okf:type:tool-method", ...(params.tool?.trim() ? [`tool:${params.tool.trim()}`] : [])];
			try {
				const results = searchOkfScoped(new OkfStore(okfRoot(this.session)), {
					query,
					sourceId: "__all__",
					tags,
					limit: params.limit ?? 10,
				});
				return textResult(formatOkfQueryResults(results, "__all__"));
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return textResult(`OKF tool-method query failed: ${normalizeOkfBridgeError(message)}`, { error: "query_failed" }, true);
			}
		});
	}
}

export class OkfBenchmarkRecordTool implements AgentTool<typeof okfBenchmarkRecordSchema, KnowledgeToolDetails> {
	readonly name = "okf_benchmark_record";
	readonly label = "OKF Benchmark Record";
	readonly summary = "Record an OKF benchmark result";
	readonly loadMode = "discoverable";
	readonly parameters = okfBenchmarkRecordSchema;
	readonly strict = true;
	readonly description = "Store a benchmark result as a valid OKF document.";

	constructor(private readonly session: ToolSession) {}

	static createIf(session: ToolSession): OkfBenchmarkRecordTool | null {
		return isEnabled(session) && getConfiguredServerName(session) === "memory-worker"
			? new OkfBenchmarkRecordTool(session)
			: null;
	}

	async execute(
		_toolCallId: string,
		params: OkfBenchmarkRecordParams,
		signal?: AbortSignal,
	): Promise<AgentToolResult<KnowledgeToolDetails>> {
		return untilAborted(signal, async () => {
			const suite = params.suite.trim();
			const caseId = params.case_id.trim();
			if (!suite || !caseId) return textResult("suite and case_id are required.", { error: "missing_identifier" }, true);
			const tags = [
				normalizedOkfTag("okf:type:benchmark-result"),
				normalizedOkfTag(`benchmark:${suite}`),
				normalizedOkfTag(`result:${params.passed ? "pass" : "fail"}`),
				...(params.source_id?.trim() ? [normalizedOkfTag(params.source_id.trim())] : []),
			];
			const toolText = [
				params.expected_tool ? `Expected tool: ${params.expected_tool}` : undefined,
				params.actual_tool ? `Actual tool: ${params.actual_tool}` : undefined,
			]
				.filter(Boolean)
				.join("\n");
			try {
				const document = recordOkfDocument(new OkfStore(okfRoot(this.session)), {
					claim: [`Benchmark ${suite}/${caseId} ${params.passed ? "passed" : "failed"}: ${params.summary}`, toolText]
						.filter(Boolean)
						.join("\n"),
					source_uri: `benchmark:${suite}:${caseId}`,
					source_kind: "verifier",
					scope: "global",
					confidence: params.passed ? "high" : "medium",
					tags,
				});
				return textResult(`Recorded OKF benchmark result.\nID: ${document.id}\nClaim: ${document.claim}`);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return textResult(`OKF benchmark record failed: ${normalizeOkfBridgeError(message)}`, { error: "record_failed" }, true);
			}
		});
	}
}

export class MemoryWorkerGetPageTool implements AgentTool<typeof registrySchema, KnowledgeToolDetails> {
	readonly name = createMCPToolName("memory-worker", "get_page");
	readonly label = "memory-worker/get_page";
	readonly summary = "Read a local OKF markdown page";
	readonly loadMode = "discoverable";
	readonly parameters = registrySchema;
	readonly strict = true;
	readonly description = "Local built-in bridge for MemoryWorker get_page backed by the OKF markdown store.";

	constructor(private readonly session: ToolSession) {}

	static createIf(session: ToolSession): MemoryWorkerGetPageTool | null {
		return isEnabled(session) && getConfiguredServerName(session) === "memory-worker"
			? new MemoryWorkerGetPageTool(session)
			: null;
	}

	async execute(
		_toolCallId: string,
		params: RegistryParams,
		signal?: AbortSignal,
	): Promise<AgentToolResult<KnowledgeToolDetails>> {
		return untilAborted(signal, async () => {
			const slug = params.slug?.trim() || this.session.settings.get("knowledge.registrySlug") || "okf/knowledge-registry";
			try {
				const page = readOkfPage(okfRoot(this.session), slug, params.fuzzy ?? false);
				if (page === undefined) {
					return textResult(`OKF page not found: ${slug}`, { mcpToolName: this.name, error: "page_not_found" }, true);
				}
				return textResult(page, { mcpToolName: this.name });
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return textResult(`OKF page read failed: ${message}`, { mcpToolName: this.name, error: "page_read_failed" }, true);
			}
		});
	}
}

export class MemoryWorkerQueryTool implements AgentTool<typeof querySchema, KnowledgeToolDetails> {
	readonly name = createMCPToolName("memory-worker", "query");
	readonly label = "memory-worker/query";
	readonly summary = "Search local OKF knowledge";
	readonly loadMode = "discoverable";
	readonly parameters = querySchema;
	readonly strict = true;
	readonly description = "Local built-in bridge for MemoryWorker query backed by OKF search.";

	constructor(private readonly session: ToolSession) {}

	static createIf(session: ToolSession): MemoryWorkerQueryTool | null {
		return isEnabled(session) && getConfiguredServerName(session) === "memory-worker"
			? new MemoryWorkerQueryTool(session)
			: null;
	}

	async execute(_toolCallId: string, params: QueryParams, signal?: AbortSignal): Promise<AgentToolResult<KnowledgeToolDetails>> {
		return untilAborted(signal, async () => {
			const query = params.query.trim();
			if (!query) return textResult("Query is required and must not be empty.", { error: "empty_query" }, true);

			const sourceId = resolveSourceId(this.session, params.client_source_id ?? (params as { source_id?: string }).source_id);
			try {
				const root = okfRoot(this.session);
				const store = new OkfStore(root);
				const limit = params.limit ?? 10;
				const results = searchOkfScoped(store, { query, sourceId, limit });
				return textResult(formatOkfQueryResults(results, sourceId), { mcpToolName: this.name, sourceId });
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return textResult(`OKF query failed: ${normalizeOkfBridgeError(message)}`, { mcpToolName: this.name, sourceId, error: "query_failed" }, true);
			}
		});
	}
}

export class KnowledgeRegistryTool implements AgentTool<typeof registrySchema, KnowledgeToolDetails> {
	readonly name = "knowledge_registry";
	readonly label = "KnowledgeRegistry";
	readonly summary = "Read the configured OKF knowledge registry page";
	readonly loadMode = "discoverable";
	readonly parameters = registrySchema;
	readonly strict = true;
	readonly description =
		"Read the configured OKF/Gemma knowledge registry page. Uses the active MemoryWorker MCP get_page tool; unavailable unless knowledge.enabled is true.";

	constructor(private readonly session: ToolSession) {}

	static createIf(session: ToolSession): KnowledgeRegistryTool | null {
		return isEnabled(session) ? new KnowledgeRegistryTool(session) : null;
	}

	async execute(
		toolCallId: string,
		params: RegistryParams,
		signal?: AbortSignal,
	): Promise<AgentToolResult<KnowledgeToolDetails>> {
		return untilAborted(signal, async () => {
			const { name, tool } = getMcpTool(this.session, "get_page");
			if (!tool) {
				return textResult(
					`Knowledge registry MCP get_page tool is not active or available. Expected active tool: ${name}. Activate/configure the ${getConfiguredServerName(this.session)} MCP server get_page tool first.`,
					{ mcpToolName: name, error: "missing_mcp_tool" },
					true,
				);
			}

			const slug =
				params.slug?.trim() || this.session.settings.get("knowledge.registrySlug") || "okf/knowledge-registry";
			const result = await executeMcpTool(tool, toolCallId, { slug, fuzzy: params.fuzzy ?? false }, signal);
			return withMcpError(result, { mcpToolName: name });
		});
	}
}

function resolveSourceId(session: ToolSession, clientSourceId?: string): string {
	const explicit = clientSourceId?.trim();
	if (explicit) return explicit;
	const configuredClient = session.settings.get("knowledge.defaultClientSourceId")?.trim();
	return configuredClient || "__all__";
}

function schemaObject(value: unknown): JsonSchemaObject {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonSchemaObject) : {};
}

function schemaType(schema: JsonSchemaObject): string | undefined {
	return Array.isArray(schema.type) ? schema.type.find(type => type !== "null") : schema.type;
}

function enumString(schema: JsonSchemaObject, preferred: string[]): string | undefined {
	const values = schema.enum?.filter((value): value is string => typeof value === "string") ?? [];
	return preferred.find(value => values.includes(value)) ?? values[0];
}

function defaultValueForField(name: string, schema: JsonSchemaObject): string | number | boolean {
	if (
		typeof schema.default === "string" ||
		typeof schema.default === "number" ||
		typeof schema.default === "boolean"
	) {
		return schema.default;
	}

	const normalized = name.toLowerCase();
	const enumDefault =
		normalized.includes("mode") || normalized.includes("strategy")
			? enumString(schema, ["balanced", "semantic", "hybrid", "text", "off"])
			: normalized.includes("format")
				? enumString(schema, ["text", "markdown", "json"])
				: normalized.includes("rerank") || normalized.includes("expand")
					? enumString(schema, ["off", "false", "none"])
					: enumString(schema, []);
	if (enumDefault !== undefined) return enumDefault;

	const type = schemaType(schema);
	if (type === "boolean") return false;
	if (type === "number" || type === "integer") return 0;
	return "";
}

function buildKnowledgeQueryArgs(tool: ExecutableTool, query: string, sourceId: string, limit: number): QueryArgs {
	const args: QueryArgs = { query, source_id: sourceId, limit };
	const parameters = schemaObject(tool.parameters);
	const properties = parameters.properties ?? {};
	const required = new Set(Array.isArray(parameters.required) ? parameters.required : []);

	for (const [name, propertySchema] of Object.entries(properties)) {
		if (name in args) continue;
		const normalized = name.toLowerCase();
		if (normalized === "sourceid") {
			args[name] = sourceId;
			continue;
		}
		if (normalized === "q" || normalized === "question" || normalized === "prompt") {
			args[name] = query;
			continue;
		}
		if (normalized === "max_results" || normalized === "top_k" || normalized === "k") {
			args[name] = limit;
			continue;
		}

		const type = schemaType(propertySchema);
		const shouldDefault =
			required.has(name) ||
			type === "string" ||
			normalized.includes("mode") ||
			normalized.includes("format") ||
			normalized.includes("rerank") ||
			normalized.includes("filter") ||
			normalized.includes("context");
		if (shouldDefault) {
			args[name] = defaultValueForField(name, propertySchema);
		}
	}

	return args;
}

export class KnowledgeQueryTool implements AgentTool<typeof querySchema, KnowledgeToolDetails> {
	readonly name = "knowledge_query";
	readonly label = "KnowledgeQuery";
	readonly summary = "Query OKF knowledge through a configured source scope";
	readonly loadMode = "discoverable";
	readonly parameters = querySchema;
	readonly strict = true;
	readonly description =
		"Scoped wrapper for MemoryWorker knowledge query. Uses client_source_id or knowledge.defaultClientSourceId for source_id so agents do not need raw broad knowledge access.";

	constructor(private readonly session: ToolSession) {}

	static createIf(session: ToolSession): KnowledgeQueryTool | null {
		return isEnabled(session) ? new KnowledgeQueryTool(session) : null;
	}

	async execute(
		toolCallId: string,
		params: QueryParams,
		signal?: AbortSignal,
	): Promise<AgentToolResult<KnowledgeToolDetails>> {
		return untilAborted(signal, async () => {
			const query = params.query.trim();
			if (!query) {
				return textResult("Query is required and must not be empty.", { error: "empty_query" }, true);
			}

			const { name, tool } = getMcpTool(this.session, "query");
			if (!tool) {
				return textResult(
					`Knowledge query MCP tool is not active or available. Expected active tool: ${name}. Activate/configure the ${getConfiguredServerName(this.session)} MCP server query tool first.`,
					{ mcpToolName: name, error: "missing_mcp_tool" },
					true,
				);
			}

			const sourceId = resolveSourceId(this.session, params.client_source_id);
			const result = await executeMcpTool(
				tool,
				toolCallId,
				buildKnowledgeQueryArgs(tool, query, sourceId, params.limit ?? 10),
				signal,
			);
			return withMcpError(result, { mcpToolName: name, sourceId });
		});
	}
}
