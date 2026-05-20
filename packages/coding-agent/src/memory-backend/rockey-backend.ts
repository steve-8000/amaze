import type { AgentMessage } from "@amaze/agent-core";
import { logger } from "@amaze/utils";
import type { Settings } from "../config/settings";
import policyPrompt from "../prompts/memory/rockey-policy.md" with { type: "text" };
import { renderRockeyRecallBlock } from "../rockey/admission";
import { evaluateRockeyDoctor, persistRockeyDoctorResult } from "../rockey/doctor";
import { importPiHermesMemoryOnce } from "../rockey/migration";
import { reindexRockeySessions } from "../rockey/session-search";
import { RockeySessionState } from "../rockey/state";
import { RockeyStore } from "../rockey/store";
import type { AgentSession } from "../session/agent-session";
import type { MemoryBackend, MemoryBackendStartOptions } from "./types";

const sessionReindexStarted = new Set<string>();
const states = new WeakMap<AgentSession, RockeySessionState>();

export const rockeyBackend: MemoryBackend = {
	id: "rockey",

	async start(options: MemoryBackendStartOptions): Promise<void> {
		const { session, settings, agentDir, taskDepth } = options;
		if (taskDepth > 0) return;

		const previous = states.get(session);
		previous?.dispose();

		const store = new RockeyStore({ agentDir, cwd: session.sessionManager.getCwd() });
		try {
			await importPiHermesMemoryOnce(store);
			await store.renderArtifacts();
			const doctor = evaluateRockeyDoctor(settings, options.modelRegistry);
			persistRockeyDoctorResult(agentDir, doctor);
			if (doctor.status !== "PASS") {
				session.emitNotice(
					doctor.status === "WARN" ? "warning" : "error",
					`Rockey doctor status ${doctor.status} (${doctor.score.toFixed(1)}/10). Dynamic recall will stay conservative.`,
					"Rockey",
				);
			}
			if (!sessionReindexStarted.has(agentDir)) {
				sessionReindexStarted.add(agentDir);
				void reindexRockeySessions(agentDir).catch(err => {
					logger.debug("Rockey session bootstrap reindex failed", { error: String(err) });
				});
			}
		} catch (err) {
			logger.debug("Rockey startup import/render failed", { error: String(err) });
		} finally {
			store.close();
		}

		const state = new RockeySessionState({
			session,
			agentDir,
			autoCaptureCorrections: settings.get("rockey.correctionDetection") ?? true,
			indexSessions: true,
		});
		states.set(session, state);
		state.attach();
	},

	async buildDeveloperInstructions(_agentDir: string, settings: Settings): Promise<string | undefined> {
		if (settings.get("memory.backend") !== "rockey") return undefined;
		return policyPrompt.trim();
	},

	async beforeAgentStartPrompt(session: AgentSession, promptText: string): Promise<string | undefined> {
		if (!session.settings.get("rockey.autoRecall")) return undefined;
		const doctor = evaluateRockeyDoctor(session.settings);
		if (doctor.status === "FAIL" || doctor.status === "DEGRADED") return undefined;
		const query = promptText.trim();
		if (!query) return undefined;
		const store = new RockeyStore({ agentDir: session.settings.getAgentDir(), cwd: session.sessionManager.getCwd() });
		try {
			const entries = store.search({
				query,
				scope: store.scope,
				limit: session.settings.get("rockey.autoRecallLimit") ?? 5,
			});
			return renderRockeyRecallBlock(entries, session.settings);
		} finally {
			store.close();
		}
	},

	async preCompactionContext(
		messages: AgentMessage[],
		settings: Settings,
		session?: AgentSession,
	): Promise<string | undefined> {
		if (settings.get("memory.backend") !== "rockey") return undefined;
		const doctor = evaluateRockeyDoctor(settings);
		if (doctor.status === "FAIL") return undefined;
		if (!session) return undefined;
		const latestUser = findLatestUserText(messages);
		if (!latestUser) return undefined;
		const store = new RockeyStore({ agentDir: settings.getAgentDir(), cwd: session.sessionManager.getCwd() });
		try {
			const entries = store.search({
				query: latestUser,
				scope: store.scope,
				limit: settings.get("rockey.autoRecallLimit") ?? 5,
			});
			return renderRockeyRecallBlock(entries, settings);
		} finally {
			store.close();
		}
	},

	async clear(agentDir: string, cwd: string, session?: AgentSession): Promise<void> {
		const state = session ? states.get(session) : undefined;
		state?.dispose();
		if (session) states.delete(session);
		const store = new RockeyStore({ agentDir, cwd });
		try {
			store.clear();
			await store.renderArtifacts();
		} finally {
			store.close();
		}
	},

	async enqueue(agentDir: string, cwd: string): Promise<void> {
		const store = new RockeyStore({ agentDir, cwd });
		try {
			await importPiHermesMemoryOnce(store);
			await store.renderArtifacts();
		} finally {
			store.close();
		}
	},
};

function findLatestUserText(messages: AgentMessage[]): string | undefined {
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const message = messages[i];
		if (message.role !== "user") continue;
		const content = message.content;
		if (typeof content === "string") {
			const trimmed = content.trim();
			if (trimmed) return trimmed;
			continue;
		}
		if (!Array.isArray(content)) continue;
		const parts: string[] = [];
		for (const block of content) {
			if (!block || typeof block !== "object") continue;
			const maybeText = block as { type?: unknown; text?: unknown };
			if (maybeText.type === "text" && typeof maybeText.text === "string") parts.push(maybeText.text);
		}
		const text = parts.join("\n").trim();
		if (text) return text;
	}
	return undefined;
}
