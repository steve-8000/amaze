/**
 * Lane C1 — ToolGateway Skeleton (workplan §9.3).
 *
 * Pure type surface describing a tool to the registry/gateway. This is a NEW,
 * additive layer: it does NOT alter the existing `AgentTool` contract or any
 * existing call path. Tools are described here so the gateway can classify and
 * police them; no tool is forced through the gateway yet.
 */

/**
 * Functional domain a tool belongs to. Used by the risk classifier and for
 * grouping/observability. Kept intentionally coarse.
 */
export type ToolDomain = "filesystem" | "shell" | "search" | "network" | "vcs" | "memory" | "meta" | "unknown";

/**
 * Coarse risk band for a tool invocation (workplan §9.4).
 * - LOW: pure reads / inspection, no side effects.
 * - MEDIUM: reads that reach the network or external systems.
 * - HIGH: mutates the local workspace (write/edit/delete).
 * - CRITICAL: mutates remote/shared state or executes arbitrary commands.
 */
export type ToolRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

/**
 * Lifecycle classification of a descriptor.
 * - "legacy": wraps a pre-existing tool implementation unchanged.
 * - "native": authored directly against the registry contract.
 */
export type ToolClass = "legacy" | "native";

/**
 * Result of a gateway-mediated tool execution.
 *
 * This is deliberately decoupled from the app-level `AgentToolResult` so the
 * registry/gateway layer stays portable. Legacy descriptors carry the original
 * tool payload in `output`; `raw` may hold the untouched upstream result.
 */
export interface ToolResult<T = unknown> {
	/** Whether execution succeeded (no thrown error / non-error result). */
	ok: boolean;
	/** Structured output produced by the tool. */
	output: T;
	/** Optional error captured when `ok` is false. */
	error?: Error;
	/** Optional untouched upstream result (e.g. an `AgentToolResult`). */
	raw?: unknown;
	/** Resolved timeout (ms) actually applied to this call. */
	timeoutMs?: number;
	/** Risk level the gateway classified this call as. */
	riskLevel?: ToolRiskLevel;
}

/**
 * Context threaded into a descriptor's `execute`. Intentionally minimal; apps
 * can pass the concrete tool session through `session` without this layer
 * depending on its shape.
 */
export interface ToolExecutionContext {
	/** Working directory for the invocation, when known. */
	cwd?: string;
	/** Abort signal forwarded from the caller. */
	signal?: AbortSignal;
	/** Stable id of the originating tool call, when available. */
	toolCallId?: string;
	/**
	 * Opaque host/session object. Legacy descriptors that need to construct the
	 * underlying tool read it from here. The gateway never inspects it.
	 */
	session?: unknown;
	/** Declared mutation scope the caller is permitted to touch (e.g. globs). */
	mutationScope?: readonly string[];
	/** Whether the caller has been granted approval for risky/mutating tools. */
	approvalGranted?: boolean;
}

/**
 * JSON-schema-ish handles for a tool's input/output. Kept as `unknown` so the
 * registry does not couple to a specific schema library; descriptors may carry
 * Zod/TypeBox/JTD handles as needed.
 */
export interface ToolSchema<TInput, TOutput> {
	input?: unknown;
	output?: unknown;
	/** Phantom carriers so generics are not erased structurally. */
	readonly __input?: TInput;
	readonly __output?: TOutput;
}

/**
 * Canonical description of a tool for the registry/gateway (workplan §9.3).
 */
export interface ToolDescriptor<TInput = unknown, TOutput = unknown> {
	/** Unique tool name (registry key). */
	name: string;
	/** Human-readable label. */
	label?: string;
	/** Lifecycle classification. */
	toolClass: ToolClass;
	/** Functional domain. */
	domain: ToolDomain;
	/** Declared risk band (the classifier may confirm/override). */
	riskLevel: ToolRiskLevel;
	/** Whether the tool mutates the local workspace. */
	mutatesWorkspace: boolean;
	/** Whether the tool requires explicit approval before running. */
	requiresApproval: boolean;
	/** Whether the tool supports rollback of its effects. */
	supportsRollback: boolean;
	/** Default timeout in milliseconds (undefined ⇒ policy default). */
	timeoutMs?: number;
	/** Input/output schema handles. */
	schema?: ToolSchema<TInput, TOutput>;
	/** Execute the tool. Should never throw for expected failures — return ok:false. */
	execute(input: TInput, ctx: ToolExecutionContext): Promise<ToolResult<TOutput>>;
}
