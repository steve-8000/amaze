import type { AgentToolResult } from "@amaze/pi-agent-core";
import { type } from "arktype";
import type { ToolSession } from ".";
import { ToolError } from "./tool-errors";

type CodebaseProfileDetails = {
	serverName: "rocky";
	endpoint: string;
};

const scopeSchema = type('"cwd" | "workspace" | "parent_1" | "parent_2" | "explicit_roots"');

const planSchema = type({
	profile: type("string").describe("Rocky codebase profile, e.g. bug_investigation, find_definition, trace_impact"),
	query: type("string").describe("task-oriented codebase query"),
	"scope?": scopeSchema.describe("explicit Rocky search scope"),
	"roots?": type("string").array().describe("explicit roots when scope is explicit_roots"),
	"max_primary_points?": type("number").describe("maximum returned primary read points"),
	"max_primary_files?": type("number").describe("maximum files represented in primary read points"),
	"max_primary_lines?": type("number").describe("maximum total primary snippet lines"),
	"max_deferred_clusters?": type("number").describe("maximum deferred cluster manifests"),
	"max_total_response_chars?": type("number").describe("hard response character budget"),
	"include_tests?": type("boolean").describe("whether Rocky may include test files in returned read points"),
	"prefer_changed_files?": type("boolean").describe(
		"whether Rocky should rank changed files ahead of equally relevant files",
	),
	"allow_lexical_fallback?": type("boolean").describe(
		"whether Rocky may use lexical fallback when structured collectors miss",
	),
	"allow_llm_summary?": type("boolean").describe(
		"whether Rocky may summarize bounded evidence with an LLM when configured",
	),
	"changed_files?": type("string").array().describe("relative or absolute changed files to rank first"),
});

const readSchema = type({
	plan_id: type("string").describe("Rocky codebase plan id"),
	"point_ids?": type("string").array().describe("specific read point ids; omit to read all primary points"),
});

const expandSchema = type({
	plan_id: type("string").describe("Rocky codebase plan id"),
	cluster_id: type("string").describe("deferred cluster id to expand"),
	"max_primary_points?": type("number").describe("maximum returned points for this expansion"),
	"max_primary_lines?": type("number").describe("maximum returned snippet lines for this expansion"),
});

type ProfileToolKind = "plan" | "read" | "expand" | "validate";

function rockyBaseUrl(session: ToolSession): string {
	const configured = session.settings?.get("rocky.apiUrl") || process.env.ROCKY_API_URL;
	if (!configured) {
		throw new ToolError("Rocky codebase profile tools require rocky.apiUrl or ROCKY_API_URL.");
	}
	return String(configured).replace(/\/+$/, "");
}

function projectRoots(session: ToolSession, params: Record<string, unknown>): string[] {
	if (Array.isArray(params.roots) && params.roots.every(root => typeof root === "string")) {
		return params.roots;
	}
	const projectPath = session.settings?.get("rocky.projectPath") || process.env.ROCKY_PROJECT_PATH || session.cwd;
	return [String(projectPath)];
}

function budgetFrom(params: Record<string, unknown>): Record<string, number> {
	const budget: Record<string, number> = {};
	for (const key of [
		"max_primary_points",
		"max_primary_files",
		"max_primary_lines",
		"max_deferred_clusters",
		"max_total_response_chars",
	]) {
		const value = params[key];
		if (typeof value === "number" && Number.isFinite(value)) budget[key] = Math.floor(value);
	}
	return budget;
}

function constraintsFrom(params: Record<string, unknown>): Record<string, unknown> {
	const constraints: Record<string, unknown> = {};
	for (const key of ["include_tests", "prefer_changed_files", "allow_lexical_fallback", "allow_llm_summary"]) {
		const value = params[key];
		if (typeof value === "boolean") constraints[key] = value;
	}
	if (Array.isArray(params.changed_files) && params.changed_files.every(file => typeof file === "string")) {
		constraints.changed_files = params.changed_files;
	}
	return constraints;
}

async function postRocky(
	session: ToolSession,
	endpoint: string,
	body: unknown,
	signal?: AbortSignal,
): Promise<AgentToolResult<CodebaseProfileDetails>> {
	const base = rockyBaseUrl(session);
	const url = `${base}${endpoint}`;
	const fetchImpl = session.fetch ?? fetch;
	const response = await fetchImpl(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
		signal,
	});
	const text = await response.text();
	if (!response.ok) throw new ToolError(`Rocky codebase profile failed (${response.status}): ${text}`);
	return {
		content: [{ type: "text", text }],
		details: { serverName: "rocky", endpoint },
	};
}

class CodebaseProfileTool<TSchema> {
	readonly strict = true;
	readonly approval = "read" as const;
	readonly loadMode = "essential" as const;

	constructor(
		private readonly session: ToolSession,
		readonly name: string,
		readonly label: string,
		readonly description: string,
		readonly parameters: TSchema,
		private readonly kind: ProfileToolKind,
	) {}

	async execute(
		_toolCallId: string,
		params: Record<string, unknown>,
		signal?: AbortSignal,
	): Promise<AgentToolResult<CodebaseProfileDetails>> {
		if (this.kind === "plan") {
			const scope = typeof params.scope === "string" ? params.scope : "workspace";
			return await postRocky(
				this.session,
				"/v1/rocky/codebase/plan",
				{
					profile: params.profile,
					query: params.query,
					scope: { kind: scope, cwd: this.session.cwd, roots: projectRoots(this.session, params) },
					budget: budgetFrom(params),
					constraints: constraintsFrom(params),
				},
				signal,
			);
		}
		if (this.kind === "read") {
			return await postRocky(this.session, "/v1/rocky/codebase/read", params, signal);
		}
		if (this.kind === "validate") {
			return await postRocky(this.session, "/v1/rocky/codebase/validate_points", params, signal);
		}
		return await postRocky(
			this.session,
			"/v1/rocky/codebase/expand",
			{
				plan_id: params.plan_id,
				cluster_id: params.cluster_id,
				budget: budgetFrom(params),
			},
			signal,
		);
	}
}

export class CodebasePlanTool extends CodebaseProfileTool<typeof planSchema> {
	constructor(session: ToolSession) {
		super(
			session,
			"codebase_plan",
			"CodebasePlan",
			"Ask Rocky for a bounded profile-driven codebase read plan with snippets, hashes, clusters, and expansion handles.",
			planSchema,
			"plan",
		);
	}
}

export class CodebaseReadTool extends CodebaseProfileTool<typeof readSchema> {
	constructor(session: ToolSession) {
		super(
			session,
			"codebase_read",
			"CodebaseRead",
			"Read bounded Rocky codebase plan points by id.",
			readSchema,
			"read",
		);
	}
}

export class CodebaseExpandTool extends CodebaseProfileTool<typeof expandSchema> {
	constructor(session: ToolSession) {
		super(
			session,
			"codebase_expand",
			"CodebaseExpand",
			"Expand one deferred Rocky codebase cluster from a prior plan.",
			expandSchema,
			"expand",
		);
	}
}

export class CodebaseValidateTool extends CodebaseProfileTool<typeof readSchema> {
	constructor(session: ToolSession) {
		super(
			session,
			"codebase_validate",
			"CodebaseValidate",
			"Validate Rocky codebase plan point freshness before trusting snippets.",
			readSchema,
			"validate",
		);
	}
}
