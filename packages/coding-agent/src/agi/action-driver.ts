import type { AgiControlActionKind } from "./store";
import type { AgiActionDriver, AgiActionDriverResult } from "./supervisor";
import { CliAgiActionDriver } from "./supervisor";
import type { AgiGatewayAction, AgiMonitoredSession } from "./store";

/**
 * Handler for a single structured control-action kind. Returns the same shape as the legacy
 * driver so the supervisor's `runPendingActions` accounting is uniform across action types.
 */
export type StructuredActionHandler = (
	action: AgiGatewayAction,
	session: AgiMonitoredSession,
) => Promise<AgiActionDriverResult>;

export interface CompositeAgiActionDriverOptions {
	/** Executes a legacy prompt-only follow-up. Defaults to {@link CliAgiActionDriver}. */
	legacy?: AgiActionDriver;
	/** Drives an AGI runtime tick for the action's mission (lease → sandbox → verifier). */
	runtimeTick?: StructuredActionHandler;
	/** Spawns the mandated subagent roles for a mission plan. */
	spawnSubagents?: StructuredActionHandler;
	/** Re-runs evidence verification for a runtime action. */
	verifyEvidence?: StructuredActionHandler;
	/** Records a human-approval request for a high-risk mutation. */
	requestApproval?: StructuredActionHandler;
}

/**
 * Routes a queued {@link AgiGatewayAction} to the right executor based on its structured
 * `payload.kind`. The defining rule of the AGI control plane lives here:
 *
 * - A legacy (payload-less) action, or an explicit `legacy_follow_up_turn`, runs the prompt
 *   re-injection path. This is the ONLY path that re-prompts a model.
 * - Every other kind requires a wired handler. If one is not configured, the action FAILS
 *   CLOSED — it never falls back to prompt re-injection. This is what prevents a control
 *   stall ("next priority …") from being laundered into another prompt: the stall produces a
 *   `runtime_tick`, and an unwired runtime surfaces as a failure (retry → block), not a re-prompt.
 */
export class CompositeAgiActionDriver implements AgiActionDriver {
	readonly #legacy: AgiActionDriver;
	readonly #handlers: Partial<Record<AgiControlActionKind, StructuredActionHandler>>;

	constructor(options: CompositeAgiActionDriverOptions = {}) {
		this.#legacy = options.legacy ?? new CliAgiActionDriver();
		this.#handlers = {
			...(options.runtimeTick ? { runtime_tick: options.runtimeTick } : {}),
			...(options.spawnSubagents ? { spawn_subagents: options.spawnSubagents } : {}),
			...(options.verifyEvidence ? { verify_evidence: options.verifyEvidence } : {}),
			...(options.requestApproval ? { request_human_approval: options.requestApproval } : {}),
		};
	}

	async run(action: AgiGatewayAction, session: AgiMonitoredSession): Promise<AgiActionDriverResult> {
		const kind = action.payload?.kind;
		if (kind === undefined || kind === "legacy_follow_up_turn") {
			return this.#legacy.run(action, session);
		}
		const handler = this.#handlers[kind];
		if (!handler) {
			return {
				exitCode: 1,
				stdout: "",
				stderr: `No driver wired for structured AGI action "${kind}"; refusing to fall back to prompt re-injection.`,
			};
		}
		return handler(action, session);
	}
}
