/**
 * Memory backend abstraction.
 *
 * Durable memory integrations were removed; the remaining backend is a no-op
 * adapter kept so session lifecycle call sites do not need special cases.
 */

import type { AgentEvent, AgentMessage } from "@amaze/agent-core";
import type { ModelRegistry } from "../config/model-registry";
import type { Settings } from "../config/settings";
import type { AgentSession } from "../session/agent-session";

export type MemoryBackendId = "off" | "mem0" | "hermes";

export interface MemoryBackendStartOptions {
	session: AgentSession;
	settings: Settings;
	modelRegistry: ModelRegistry;
	agentDir: string;
	taskDepth: number;
}

export interface MemoryBackend {
	readonly id: MemoryBackendId;

	/**
	 * Wire any background work or session subscriptions for this backend.
	 *
	 * Called once per agent session at startup. Implementations MUST be
	 * non-throwing: failures should be logged and swallowed so a misconfigured
	 * memory backend cannot break the agent loop.
	 */
	start(options: MemoryBackendStartOptions): void | Promise<void>;

	/**
	 * Markdown injected as the system-prompt append section.
	 * Returned on every prompt rebuild via `refreshBaseSystemPrompt()`.
	 */
	buildDeveloperInstructions(
		agentDir: string,
		settings: Settings,
		session?: AgentSession,
	): Promise<string | undefined>;

	/** Wipe all persisted state for this backend (slash `/memory clear`). */
	clear(agentDir: string, cwd: string, session?: AgentSession): Promise<void>;

	/** Force consolidation/retain to happen now (slash `/memory enqueue`). */
	enqueue(agentDir: string, cwd: string, session?: AgentSession): Promise<void>;

	/**
	 * Optional hook to inject a backend-specific block into the current turn's
	 * system prompt before the agent starts generating.
	 *
	 * This is the only place a backend can affect the very first answer of a
	 * fresh session. The returned text is appended to the already-built base
	 * system prompt for this turn only; callers may separately cache it and
	 * surface it through `buildDeveloperInstructions()` on later rebuilds.
	 */
	beforeAgentStartPrompt?(session: AgentSession, promptText: string): Promise<string | undefined>;

	/**
	 * Optional hook to splice extra context into a compaction summarization.
	 *
	 * Called from the compaction call site before the LLM summary is requested.
	 * Returning a string appends one entry to the compaction's `extraContext`
	 * list (which becomes part of the summarization prompt). Return `undefined`
	 * to inject nothing.
	 */
	preCompactionContext?(
		messages: AgentMessage[],
		settings: Settings,
		session?: AgentSession,
	): Promise<string | undefined>;

	/**
	 * Optional fire-and-forget hook invoked after a turn boundary. Backends use
	 * this for online consolidation so memory can learn during a session instead
	 * of waiting for the next startup scan.
	 */
	onTurnEnd?(session: AgentSession, event: AgentEvent): void | Promise<void>;
}
