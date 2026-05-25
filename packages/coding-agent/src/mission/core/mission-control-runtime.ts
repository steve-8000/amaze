import { inferIntent, MISSION_INTENT_REQUIRES_MISSION, type MissionIntent } from "../policy";
import type { MissionStore } from "../store";
import type { Mission } from "./mission";
import { MissionRuntimeImpl } from "./mission-runtime";

const TERMINAL_LIFECYCLES = new Set<Mission["lifecycle"]>(["completed", "cancelled", "blocked"]);

export interface MissionControlDeps {
	store: MissionStore;
	setActiveMissionId: (id: string | undefined) => void;
	getActiveMissionId: () => string | undefined;
	now?: () => number;
	newId?: () => string;
}

export interface EnsureMissionInput {
	content: string;
	mode?: string;
}

export interface EnsureMissionResult {
	missionId: string | undefined;
	intent: MissionIntent;
	created: boolean;
}

export class MissionControlRuntime {
	readonly #deps: MissionControlDeps;
	readonly #runtime: MissionRuntimeImpl;

	constructor(deps: MissionControlDeps) {
		this.#deps = deps;
		this.#runtime = new MissionRuntimeImpl({ store: deps.store, now: deps.now });
	}

	async ensureActiveMission(input: EnsureMissionInput): Promise<EnsureMissionResult> {
		const activeId = this.#deps.getActiveMissionId();
		if (activeId) {
			const mission = this.#runtime.tryGet(activeId);
			if (mission && !TERMINAL_LIFECYCLES.has(mission.lifecycle)) {
				return { missionId: activeId, intent: mission.intent ?? safeInferIntent(input), created: false };
			}
		}

		const intent = safeInferIntent(input);
		if (!MISSION_INTENT_REQUIRES_MISSION.has(intent)) {
			return { missionId: undefined, intent, created: false };
		}

		const mission = await this.#runtime.create({
			...(this.#deps.newId ? { id: this.#deps.newId() } : {}),
			title: deriveTitle(input.content),
			objective: input.content.slice(0, 240),
			mode: "auto",
			riskLevel: "medium",
			intent,
		});
		this.#deps.setActiveMissionId(mission.id);
		return { missionId: mission.id, intent, created: true };
	}

	async promoteFromAmbient(input: { triggeringTool: string; objective?: string }): Promise<Mission> {
		const active = this.getActiveMission();
		if (active) return active;

		const objective = (input.objective?.trim() || `<mutation via ${input.triggeringTool}>`).slice(0, 240);
		const inferred = safeInferIntent({ content: objective });
		const intent = MISSION_INTENT_REQUIRES_MISSION.has(inferred) ? inferred : "code_change";
		const mission = await this.#runtime.create({
			...(this.#deps.newId ? { id: this.#deps.newId() } : {}),
			title: deriveTitle(objective),
			objective,
			mode: "auto",
			riskLevel: "medium",
			intent,
		});
		this.#deps.setActiveMissionId(mission.id);
		return mission;
	}

	async ensureMissionScopeOrPromote(triggeringTool: string): Promise<Mission | undefined> {
		const active = this.getActiveMission();
		if (active) return active;
		return this.promoteFromAmbient({ triggeringTool });
	}

	getActiveMission(): Mission | undefined {
		const activeId = this.#deps.getActiveMissionId();
		return activeId ? this.#runtime.tryGet(activeId) : undefined;
	}

	recordTaskUsage(missionId: string, delta: number): void {
		if (!Number.isFinite(delta) || delta <= 0) return;
		const mission = this.#runtime.tryGet(missionId);
		if (!mission) return;
		mission.budget.tokensUsed = (mission.budget.tokensUsed ?? 0) + delta;
		mission.updatedAt = this.#deps.now?.() ?? Date.now();
	}

	clearActiveMission(): void {
		this.#deps.setActiveMissionId(undefined);
	}
}

function safeInferIntent(input: EnsureMissionInput): MissionIntent {
	try {
		return inferIntent({ objective: input.content, mode: input.mode });
	} catch {
		return "conversation";
	}
}

function deriveTitle(content: string): string {
	const trimmed = content.trim();
	if (!trimmed) return "Untitled mission";
	const sentenceEnd = trimmed.search(/[.!?。！？]\s|[.!?。！？]$/u);
	const firstSentence = sentenceEnd >= 0 ? trimmed.slice(0, sentenceEnd + 1).trim() : trimmed;
	return firstSentence.slice(0, 80).trim() || "Untitled mission";
}
