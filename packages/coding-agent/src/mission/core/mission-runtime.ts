import type { ConfidenceLevel, RiskLevel } from "../../research/types";
import type { MissionEventBus } from "../event-bus";
import { defaultMissionClassifier, toCoreRiskLevel } from "../policy";
import { MissionStore } from "../store";
import type { MissionState as LegacyMissionState } from "../types";
import type { AcceptanceCriterion } from "./acceptance-criteria";
import { templateFor } from "./lifecycle-template";
import type {
	Mission,
	MissionLifecycleState,
	MissionPlan,
	MissionPlanStep,
	MissionTask,
	MissionVerification,
} from "./mission";
import type { MissionInput, MissionMode } from "./mission-input";
import type {
	MissionBlockOptions,
	MissionCancelOptions,
	MissionClassifyOptions,
	MissionClassifyResult,
	MissionCompleteOptions,
	MissionEventUnsubscribe,
	MissionExecuteOptions,
	MissionExecuteResult,
	MissionPlanOptions,
	MissionPlanResult,
	MissionRuntime,
	MissionRuntimeEvent,
	MissionVerifyOptions,
	MissionVerifyResult,
} from "./mission-runtime.iface";
import { MissionTaskDispatcher } from "./mission-task-dispatcher";

const MAX_TITLE_LENGTH = 4_000;
const DEFAULT_TOKEN_BUDGET = 0;
const DEFAULT_MAX_CONTEXT_TOKENS = 0;

/**
 * Token usage snapshot consumed by {@link missionTokenDelta}. Mirrors the
 * `GoalTokenUsage` shape used by ObjectiveRuntimeImpl so callers can pass the same
 * provider-reported counters into either runtime.
 */
export interface MissionTokenUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

/**
 * Per-tool token accounting event accepted by {@link MissionRuntimeImpl.accountTokens}.
 */
export interface MissionTokenAccountInput {
	usage: MissionTokenUsage;
	baseline?: MissionTokenUsage;
	taskId?: string | null;
	tool?: string;
	toolCallId?: string;
}

/**
 * Thrown by {@link MissionRuntimeImpl.complete} when acceptance verification surfaces a
 * failing verdict. Mirrors `GoalAcceptanceFailureError` so callers get the same structured
 * `verification` payload (per-criterion id/description/satisfied) and the mission stays
 * uncompleted. Bypass with `complete(..., { force: true })`.
 */
export class MissionAcceptanceFailureError extends Error {
	readonly verification: MissionVerification;
	readonly failedCriteria: AcceptanceCriterion[];
	constructor(verification: MissionVerification, failedCriteria: AcceptanceCriterion[], message?: string) {
		const summary = failedCriteria.map(c => `- [${c.id}] ${c.description}`).join("\n");
		super(
			message ??
				`Mission acceptance verification blocked completion: ${verification.failedCount ?? failedCriteria.length} of ${
					verification.failedCount ?? 0
				} criteria failed.\n${summary}\n\nResolve the failing criteria before completing the mission, or complete with force.`,
		);
		this.name = "MissionAcceptanceFailureError";
		this.verification = verification;
		this.failedCriteria = failedCriteria;
	}
}

/**
 * Token accounting model shared with `goalTokenDelta`.
 *
 * Counts input + cacheWrite + output and excludes cacheRead: cache writes are billed new
 * work (rotating a 1h ephemeral cache or re-anchoring a changed system prompt can write
 * 100K+ tokens) while cache reads are reused prefix, not new consumption.
 */
export function missionTokenDelta(current: MissionTokenUsage, baseline: MissionTokenUsage): number {
	return (
		Math.max(0, current.input - baseline.input) +
		Math.max(0, current.cacheWrite - baseline.cacheWrite) +
		Math.max(0, current.output - baseline.output)
	);
}

function validateTitle(value: string): string {
	const title = value.trim();
	if (!title) throw new Error("title is required when creating a mission");
	let count = 0;
	for (const _ of title) {
		count++;
		if (count > MAX_TITLE_LENGTH) {
			throw new Error(
				`Mission title is too long: ${count.toLocaleString()} characters. Limit: ${MAX_TITLE_LENGTH.toLocaleString()}.`,
			);
		}
	}
	return title;
}

function validateTokenBudget(tokenBudget: number | undefined): void {
	if (tokenBudget !== undefined && (!Number.isInteger(tokenBudget) || tokenBudget < 0)) {
		throw new Error("mission token budget must be a non-negative integer when provided");
	}
}

/** Map a core lifecycle state to a legacy {@link LegacyMissionState} for store persistence. */
function lifecycleToStoreState(lifecycle: MissionLifecycleState): LegacyMissionState {
	switch (lifecycle) {
		case "researching":
		case "critiquing":
		case "executing":
		case "verifying":
		case "completed":
		case "rolled_back":
		case "blocked":
		case "cancelled":
			return lifecycle;
		case "contracting":
			return "contracted";
		default:
			return "drafting";
	}
}

function cloneCriterion(criterion: AcceptanceCriterion): AcceptanceCriterion {
	return {
		...criterion,
		...(criterion.evidenceRefs ? { evidenceRefs: [...criterion.evidenceRefs] } : {}),
	};
}

export type MissionRuntimeImplOptions = {
	store?: MissionStore;
	dbPath?: string;
	eventBus?: MissionEventBus;
	now?: () => number;
	dispatcher?: MissionTaskDispatcher;
};

/**
 * Concrete implementation of the canonical {@link MissionRuntime} contract.
 *
 * Owns:
 *   - the rich core {@link Mission} aggregate per mission (held in memory),
 *   - a durable thin record via {@link MissionStore} (lifecycle mapped to legacy state),
 *   - a per-mission token budget + accounting (mirrors ObjectiveRuntimeImpl semantics) tracked on
 *     `mission.budget`,
 *   - canonical lifecycle event emission via the {@link MissionEventBus} (and therefore the
 *     jsonl sink).
 *
 * Runs in parallel with ObjectiveRuntimeImpl; nothing here mutates goal state.
 */
export class MissionRuntimeImpl implements MissionRuntime {
	readonly #store: MissionStore;
	readonly #ownsStore: boolean;
	readonly #bus: MissionEventBus | undefined;
	readonly #now: () => number;
	readonly #missions = new Map<string, Mission>();
	readonly #runtimeEvents: MissionRuntimeEvent[] = [];
	readonly #subscribers = new Set<(event: MissionRuntimeEvent) => void>();
	readonly #dispatcher: MissionTaskDispatcher | undefined;

	constructor(options: MissionRuntimeImplOptions = {}) {
		if (options.store) {
			this.#store = options.store;
			this.#ownsStore = false;
		} else {
			this.#store = new MissionStore(options.dbPath, options.eventBus);
			this.#ownsStore = true;
		}
		this.#bus = options.eventBus;
		this.#now = options.now ?? (() => Date.now());
		this.#dispatcher = options.dispatcher;
	}

	close(): void {
		if (this.#ownsStore) this.#store.close();
	}

	#emit(event: Parameters<MissionEventBus["emit"]>[0]): void {
		this.#bus?.emit(event);
	}

	tryGet(missionId: string): Mission | undefined {
		return this.#missions.get(missionId);
	}

	#require(missionId: string): Mission {
		const mission = this.#missions.get(missionId);
		if (!mission) throw new Error(`Mission not found: ${missionId}`);
		return mission;
	}

	#advance(mission: Mission, lifecycle: MissionLifecycleState): Mission {
		mission.lifecycle = lifecycle;
		mission.updatedAt = this.#now();
		this.#store.updateMission(mission.id, { state: lifecycleToStoreState(lifecycle) });
		return mission;
	}

	async create(input: MissionInput): Promise<Mission> {
		const title = validateTitle(input.title);
		const objective = input.objective?.trim();
		if (!objective) throw new Error("objective is required when creating a mission");
		validateTokenBudget(input.budget?.tokenBudget);
		const riskLevel: RiskLevel = input.riskLevel ?? "medium";
		const mode: MissionMode = input.mode ?? "interactive";
		const createdAt = this.#now();

		const record = this.#store.createMission({
			...(input.id ? { id: input.id } : {}),
			title,
			objectiveId: input.projectId ?? null,
			briefId: null,
			decisionId: null,
			riskLevel,
			state: "drafting",
			confidence: null,
			snapshotRef: null,
		});

		const mission: Mission = {
			id: record.id,
			title,
			objective,
			mode,
			lifecycle: "created",
			riskLevel,
			...(input.intent ? { intent: input.intent } : {}),
			constraints: input.constraints ? [...input.constraints] : [],
			acceptanceCriteria: input.acceptanceCriteria ? input.acceptanceCriteria.map(cloneCriterion) : [],
			budget: {
				tokenBudget: input.budget?.tokenBudget ?? DEFAULT_TOKEN_BUDGET,
				tokensUsed: input.budget?.tokensUsed ?? 0,
				...(input.budget?.timeBudgetMs !== undefined ? { timeBudgetMs: input.budget.timeBudgetMs } : {}),
				...(input.budget?.taskBudget !== undefined ? { taskBudget: input.budget.taskBudget } : {}),
			},
			contextBudget: {
				maxContextTokens: input.contextBudget?.maxContextTokens ?? DEFAULT_MAX_CONTEXT_TOKENS,
				contextTokensUsed: input.contextBudget?.contextTokensUsed ?? 0,
				...(input.contextBudget?.compactionThreshold !== undefined
					? { compactionThreshold: input.contextBudget.compactionThreshold }
					: {}),
			},
			tasks: [],
			evidenceRefs: [],
			createdAt: record.createdAt,
			updatedAt: record.updatedAt,
		};
		if (input.projectId !== undefined) mission.projectId = input.projectId;
		if (input.sessionId !== undefined) mission.sessionId = input.sessionId;
		if (input.parentMissionId !== undefined) mission.parentMissionId = input.parentMissionId;
		if (input.scopeGuard !== undefined) mission.scopeGuard = input.scopeGuard;
		this.#missions.set(mission.id, mission);

		this.#emit({
			type: "mission.created",
			missionId: mission.id,
			title: mission.title,
			objectiveId: mission.projectId ?? null,
			riskLevel: mission.riskLevel,
			ts: createdAt,
		});
		return mission;
	}

	async classify(missionId: string, options: MissionClassifyOptions = {}): Promise<MissionClassifyResult> {
		void options;
		const mission = this.#require(missionId);
		this.#advance(mission, "classified");
		const decision = defaultMissionClassifier.classify(mission);
		mission.intent = decision.intent;
		mission.riskLevel = toCoreRiskLevel(decision.riskLevel);
		const confidence: ConfidenceLevel | null = mission.riskLevel === "low" ? "high" : null;
		this.#emit({
			type: "mission.classified",
			missionId: mission.id,
			riskLevel: mission.riskLevel,
			confidence,
			ts: mission.updatedAt,
		});
		return { riskLevel: mission.riskLevel, intent: mission.intent, rationale: decision.rationale };
	}

	async plan(missionId: string, options: MissionPlanOptions = {}): Promise<MissionPlanResult> {
		const mission = this.#require(missionId);
		const maxSteps = options.maxSteps ?? Number.POSITIVE_INFINITY;
		const steps: MissionPlanStep[] = mission.plan?.steps ? mission.plan.steps.slice(0, maxSteps) : [];
		const plan: MissionPlan = mission.plan ?? { steps };
		plan.steps = steps;
		mission.plan = plan;
		// Seed tasks from plan steps when none exist yet.
		if (mission.tasks.length === 0) {
			mission.tasks = steps.map<MissionTask>((step, index) => ({
				id: `${mission.id}-task-${index + 1}`,
				title: step.description,
				status: "pending",
				planStepId: step.id,
			}));
		}
		this.#advance(mission, "planning");
		this.#emit({
			type: "mission.planned",
			missionId: mission.id,
			taskCount: plan.steps.length,
			ts: mission.updatedAt,
		});
		return { plan };
	}

	async execute(missionId: string, options: MissionExecuteOptions = {}): Promise<MissionExecuteResult> {
		const mission = this.#require(missionId);
		this.#advance(mission, "executing");
		const dispatcher = this.#dispatcher ?? new MissionTaskDispatcher();
		const targetIds = options.taskIds ? new Set(options.taskIds) : undefined;
		const tasks = mission.tasks.filter(t => !targetIds || targetIds.has(t.id));
		const result = await dispatcher.run(tasks, {
			scopeGuard: mission.scopeGuard,
			evidenceRefs: mission.evidenceRefs,
			recordAttempt: (taskId, verdict, note) => {
				this.#emit({
					type: "mission.task.attempt",
					missionId,
					taskId,
					verdict,
					note,
					ts: this.#now(),
				});
			},
		});
		for (const id of result.completedTaskIds) {
			const task = mission.tasks.find(t => t.id === id);
			if (task) task.status = "completed";
			this.#emit({
				type: "mission.task.completed",
				missionId: mission.id,
				taskId: id,
				status: "completed",
				ts: this.#now(),
			});
		}
		for (const id of result.failedTaskIds) {
			const task = mission.tasks.find(t => t.id === id);
			if (task) task.status = "failed";
			this.#emit({
				type: "mission.task.failed",
				missionId: mission.id,
				taskId: id,
				status: "failed",
				ts: this.#now(),
			});
		}
		mission.updatedAt = this.#now();
		return result;
	}

	async verify(missionId: string, options: MissionVerifyOptions = {}): Promise<MissionVerifyResult> {
		const mission = this.#require(missionId);
		this.#advance(mission, "verifying");
		const verification = this.#evaluateAcceptance(mission, options.force ?? false);
		mission.verification = verification;
		const verificationRecord = this.#store.recordVerification({
			missionId: mission.id,
			status: verification.status,
			failedCount: verification.failedCount ?? 0,
			uncertainCount: verification.uncertainCount ?? 0,
			summary: verification.summary,
		});
		this.#emit({
			type: "mission.verification.completed",
			missionId: mission.id,
			verificationId: verificationRecord.id,
			status: verification.status === "force" ? "pass" : verification.status,
			failedCount: verification.failedCount ?? 0,
			uncertainCount: verification.uncertainCount ?? 0,
			ts: mission.updatedAt,
		});
		return { verification };
	}

	/**
	 * Evaluate the mission's acceptance criteria from their `satisfied` flags.
	 * Unsatisfied criteria with no verification method are treated as `uncertain`
	 * (a human/llm-judged item) rather than a hard fail; unsatisfied criteria that
	 * declare a verification method are `fail`. `force` collapses to a `force` verdict.
	 */
	#evaluateAcceptance(mission: Mission, force: boolean): MissionVerification {
		const criteria = mission.acceptanceCriteria;
		if (force) {
			return {
				status: "force",
				verdict: "pass",
				summary: "Mission verification forced.",
				failedCount: 0,
				uncertainCount: 0,
			};
		}
		if (criteria.length === 0) {
			return {
				status: "pass",
				verdict: "pass",
				summary: "No acceptance criteria.",
				failedCount: 0,
				uncertainCount: 0,
			};
		}
		const failed: AcceptanceCriterion[] = [];
		const uncertain: AcceptanceCriterion[] = [];
		for (const criterion of criteria) {
			if (criterion.satisfied) continue;
			if (criterion.verificationMethod) failed.push(criterion);
			else uncertain.push(criterion);
		}
		const failedCount = failed.length;
		const uncertainCount = uncertain.length;
		const status: MissionVerification["status"] =
			failedCount > 0 ? "fail" : uncertainCount > 0 ? "uncertain" : "pass";
		return {
			status,
			verdict: status === "pass" ? "pass" : status === "fail" ? "fail" : "pending",
			summary: `${failedCount} failed; ${uncertainCount} uncertain; ${
				criteria.length - failedCount - uncertainCount
			} passed.`,
			failedCount,
			uncertainCount,
		};
	}

	async complete(missionId: string, options: MissionCompleteOptions): Promise<Mission> {
		const mission = this.#require(missionId);
		const template = templateFor(mission.intent ?? "conversation");
		const missing: string[] = [];
		if (template.requireDecisionRecord && !mission.decisionId) missing.push("decisionId");
		if (template.requireRegressionContract && !mission.regressionContractId) missing.push("regressionContractId");
		if (
			template.requireVerification &&
			(mission.verification?.verdict ?? mission.verification?.status ?? "pending") !== "pass"
		) {
			missing.push("verification.verdict=pass");
		}
		if (missing.length) {
			throw new MissionAcceptanceFailureError(
				{
					status: "fail",
					verdict: "fail",
					summary: `Mission "${mission.id}" cannot complete: missing ${missing.join(", ")}`,
					failedCount: missing.length,
					uncertainCount: 0,
				},
				[],
				`Mission "${mission.id}" cannot complete: missing ${missing.join(", ")}`,
			);
		}
		const force = mission.verification?.status === "force";
		let verification = mission.verification;
		if (!force && !verification) {
			verification = this.#evaluateAcceptance(mission, false);
			mission.verification = verification;
			if (verification.status === "fail") {
				const failedCriteria = mission.acceptanceCriteria.filter(c => !c.satisfied && c.verificationMethod);
				throw new MissionAcceptanceFailureError(verification, failedCriteria);
			}
		}
		mission.outcome = options.outcome;
		this.#advance(mission, "completed");
		this.#emit({
			type: "mission.completed",
			missionId: mission.id,
			finalState: lifecycleToStoreState("completed"),
			ts: mission.updatedAt,
		});
		return mission;
	}

	async block(missionId: string, options: MissionBlockOptions): Promise<Mission> {
		const mission = this.#require(missionId);
		if (options.evidenceRefs) {
			mission.evidenceRefs = [...mission.evidenceRefs, ...options.evidenceRefs];
		}
		this.#advance(mission, "blocked");
		this.#emit({
			type: "mission.blocked",
			missionId: mission.id,
			reason: options.reason,
			ts: mission.updatedAt,
		});
		return mission;
	}

	async cancel(missionId: string, options: MissionCancelOptions = {}): Promise<Mission> {
		const mission = this.#require(missionId);
		this.#advance(mission, "cancelled");
		this.#emit({
			type: "mission.cancelled",
			missionId: mission.id,
			reason: options.reason ?? null,
			ts: mission.updatedAt,
		});
		return mission;
	}

	/**
	 * Record a runtime event and notify subscribers. Per the canonical contract this
	 * doubles as a subscription seam: when called with a listener-bearing detail it
	 * registers and returns an unsubscribe; otherwise it records the event and returns
	 * undefined.
	 */
	emit(event: MissionRuntimeEvent): MissionEventUnsubscribe | undefined {
		const listener = (event.detail as { listener?: (e: MissionRuntimeEvent) => void } | undefined)?.listener;
		if (typeof listener === "function") {
			this.#subscribers.add(listener);
			let active = true;
			return () => {
				if (!active) return;
				active = false;
				this.#subscribers.delete(listener);
			};
		}
		this.#runtimeEvents.push(event);
		for (const subscriber of [...this.#subscribers]) {
			subscriber(event);
		}
		return undefined;
	}

	/** Drain the runtime events recorded via {@link emit}. Test/inspection aid. */
	runtimeEvents(): readonly MissionRuntimeEvent[] {
		return this.#runtimeEvents;
	}

	async get(missionId: string): Promise<Mission | undefined> {
		return this.#missions.get(missionId);
	}

	/**
	 * Account for tokens consumed by a tool call against the mission budget, mirroring
	 * ObjectiveRuntimeImpl's `goalTokenDelta` semantics. Adds the delta to `budget.tokensUsed` and
	 * emits a `mission.tool.completed` lifecycle event. Returns the delta applied.
	 */
	accountTokens(missionId: string, input: MissionTokenAccountInput): number {
		const mission = this.#require(missionId);
		const baseline = input.baseline ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
		const delta = missionTokenDelta(input.usage, baseline);
		if (delta > 0) {
			mission.budget.tokensUsed += delta;
			mission.updatedAt = this.#now();
		}
		this.#emit({
			type: "mission.tool.completed",
			missionId: mission.id,
			taskId: input.taskId ?? null,
			toolCallId: input.toolCallId ?? `${mission.id}-tool-${this.#now()}`,
			tool: input.tool ?? "unknown",
			status: "ok",
			ts: this.#now(),
		});
		return delta;
	}
}
