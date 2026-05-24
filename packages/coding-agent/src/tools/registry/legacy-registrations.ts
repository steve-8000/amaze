/**
 * Lane C1 — ToolGateway Skeleton.
 *
 * Registers a handful of existing tools as LEGACY descriptors that WRAP the
 * current implementations without changing any call path. These descriptors
 * exist purely so the registry/gateway has something to classify and police;
 * nothing in the production pipeline routes through them yet (Wave 3 / Lane H).
 *
 * The wrappers lazily construct the underlying tool from `ctx.session` (a
 * `ToolSession`) and delegate to its `execute`. We import ONLY types from the
 * existing tool modules where possible and the runtime tool factories from
 * `../index`; we do not modify any existing file.
 */
import type { AgentToolResult } from "@amaze/agent-core";
import { executeReadUrl } from "../fetch";
import { BUILTIN_TOOLS, type ToolSession } from "../index";
import type { ToolDescriptor, ToolExecutionContext, ToolResult } from "./tool-descriptor";
import type { ToolRegistry } from "./tool-registry";

/** Coerce an unknown ctx.session into a ToolSession, throwing a clear error. */
function requireSession(ctx: ToolExecutionContext, tool: string): ToolSession {
	if (!ctx.session) {
		throw new Error(`legacy tool "${tool}" requires ctx.session (ToolSession) to execute`);
	}
	return ctx.session as ToolSession;
}

/** Wrap an AgentToolResult as a gateway ToolResult. */
function fromAgentResult<T>(result: AgentToolResult<T>): ToolResult<T> {
	return {
		ok: !result.isError,
		output: (result.details ?? undefined) as T,
		raw: result,
	};
}

/**
 * Build a legacy descriptor that constructs the named BUILTIN tool from the
 * session and calls its `execute`. The descriptor's static policy fields are
 * fixed here; the gateway's risk classifier may escalate them.
 */
function legacyBuiltinDescriptor<TInput = unknown, TOutput = unknown>(
	builtinName: string,
	meta: Omit<ToolDescriptor<TInput, TOutput>, "execute" | "toolClass">,
): ToolDescriptor<TInput, TOutput> {
	return {
		...meta,
		toolClass: "legacy",
		async execute(input, ctx) {
			const session = requireSession(ctx, meta.name);
			const factory = BUILTIN_TOOLS[builtinName];
			if (!factory) {
				throw new Error(`legacy tool "${meta.name}": no builtin factory "${builtinName}"`);
			}
			const tool = await factory(session);
			if (!tool) {
				throw new Error(`legacy tool "${meta.name}": builtin factory "${builtinName}" returned null`);
			}
			const result = (await tool.execute(
				ctx.toolCallId ?? "",
				input as never,
				ctx.signal,
				undefined,
				undefined,
			)) as AgentToolResult<TOutput>;
			return fromAgentResult(result);
		},
	};
}

/** Create all legacy descriptors (registration-only; no behavior change). */
export function createLegacyDescriptors(): ToolDescriptor<any, any>[] {
	return [
		legacyBuiltinDescriptor("read", {
			name: "read",
			label: "Read",
			domain: "filesystem",
			riskLevel: "LOW",
			mutatesWorkspace: false,
			requiresApproval: false,
			supportsRollback: false,
		}),
		legacyBuiltinDescriptor("write", {
			name: "write",
			label: "Write",
			domain: "filesystem",
			riskLevel: "HIGH",
			mutatesWorkspace: true,
			requiresApproval: true,
			supportsRollback: true,
		}),
		legacyBuiltinDescriptor("bash", {
			name: "bash",
			label: "Bash",
			domain: "shell",
			riskLevel: "CRITICAL",
			mutatesWorkspace: true,
			requiresApproval: true,
			supportsRollback: false,
			timeoutMs: 300_000,
		}),
		legacyBuiltinDescriptor("repo_search", {
			name: "repo_search",
			label: "Repo Search",
			domain: "search",
			riskLevel: "LOW",
			mutatesWorkspace: false,
			requiresApproval: false,
			supportsRollback: false,
		}),
		legacyBuiltinDescriptor("github", {
			name: "gh",
			label: "GitHub",
			domain: "vcs",
			riskLevel: "MEDIUM",
			mutatesWorkspace: false,
			requiresApproval: false,
			supportsRollback: false,
		}),
		// fetch is not a BUILTIN_TOOLS entry; it is the read-url path. Wrap it directly.
		{
			name: "fetch",
			label: "Fetch",
			toolClass: "legacy",
			domain: "network",
			riskLevel: "MEDIUM",
			mutatesWorkspace: false,
			requiresApproval: false,
			supportsRollback: false,
			timeoutMs: 20_000,
			async execute(input, ctx) {
				const session = requireSession(ctx, "fetch");
				const result = await executeReadUrl(session, input as { path: string; raw?: boolean }, ctx.signal);
				return fromAgentResult(result);
			},
		} satisfies ToolDescriptor<{ path: string; raw?: boolean }, unknown>,
	];
}

/** Register all legacy descriptors into the given registry. */
export function registerLegacyTools(registry: ToolRegistry): ToolRegistry {
	return registry.registerAll(createLegacyDescriptors());
}
