import { ObjectiveStore } from "../autonomy/store";
import type { Objective } from "../autonomy/types";
import { ProposalStore } from "../learning/store";
import type { LearningProposal, ProposalStatus } from "../learning/types";
import { ResearchStore } from "../research/store";
import type {
	ConfidenceLevel,
	CritiqueRecord,
	DecisionRecord,
	EvidenceCard,
	ResearchBrief,
	SynthesisRecord,
} from "../research/types";
import { type MissionProjectionView, projectMissionView } from "./projection";
import { MissionStore } from "./store";
import type {
	Mission,
	MissionContractRecord,
	MissionLaneRun,
	MissionRollbackRecord,
	MissionState,
	MissionVerificationRecord,
	ResearchRun,
} from "./types";

const MISSION_PROPOSAL_STATUSES: ProposalStatus[] = ["pending", "approved", "applied", "rejected", "rolled-back"];

export interface MissionProposalSummary {
	id: string;
	type: LearningProposal["type"];
	status: LearningProposal["status"];
	gate: LearningProposal["gate"];
	createdAt: number;
	updatedAt: number;
	objectiveId: string | null;
}

export interface MissionObjectiveSummary {
	id: string;
	title: string;
	status: Objective["status"];
	updatedAt: number;
}

export interface MissionDecisionSummary {
	id: string;
	confidence: ConfidenceLevel;
	createdAt: number;
	evidenceRefs: string[];
	hypothesis: string;
}

export interface MissionInspectorTarget {
	taskId: string | null;
	sessionFile: string | null;
	source: "contract" | "lane-run";
}

export interface MissionView extends MissionProjectionView {
	objective: MissionObjectiveSummary | null;
	decisionSummary: MissionDecisionSummary | null;
	proposals: MissionProposalSummary[];
	contracts: MissionContractRecord[];
	latestVerification: MissionVerificationRecord | null;
	rollbacks: MissionRollbackRecord[];
	researchRun: ResearchRun | null;
	evidenceCards: EvidenceCard[];
	latestSynthesis: SynthesisRecord | null;
	latestCritique: CritiqueRecord | null;
	inspectorTarget: MissionInspectorTarget | null;
}

export function buildMissionView(input: {
	mission: Mission;
	brief: ResearchBrief | undefined;
	decision: DecisionRecord | undefined;
	evidence: EvidenceCard[];
	laneRuns: MissionLaneRun[];
	objective: Objective | undefined;
	proposals: LearningProposal[];
	contracts: MissionContractRecord[];
	latestVerification: MissionVerificationRecord | undefined;
	rollbacks: MissionRollbackRecord[];
	researchRun: ResearchRun | undefined;
	latestSynthesis?: SynthesisRecord | undefined;
	latestCritique?: CritiqueRecord | undefined;
}): MissionView {
	const projection = projectMissionView({
		mission: input.mission,
		brief: input.brief,
		decision: input.decision,
		evidence: input.evidence,
		laneRuns: input.laneRuns,
	});

	const inspectorTarget = getMissionInspectorTarget(input.contracts, input.laneRuns);

	return {
		...projection,
		objective: input.objective
			? {
					id: input.objective.id,
					title: input.objective.title,
					status: input.objective.status,
					updatedAt: getObjectiveUpdatedAt(input.objective),
				}
			: null,
		decisionSummary: input.decision
			? {
					id: input.decision.id,
					confidence: input.decision.confidence,
					createdAt: input.decision.createdAt,
					evidenceRefs: [...input.decision.evidenceRefs],
					hypothesis: input.decision.hypothesis,
				}
			: null,
		proposals: [...input.proposals]
			.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
			.map(proposal => ({
				id: proposal.id,
				type: proposal.type,
				status: proposal.status,
				gate: proposal.gate,
				createdAt: proposal.createdAt,
				updatedAt: getProposalUpdatedAt(proposal),
				objectiveId: getProposalObjectiveId(proposal),
			})),
		evidenceCards: [...input.evidence].sort((a, b) => b.capturedAt - a.capturedAt || b.id.localeCompare(a.id)),
		contracts: [...input.contracts],
		latestVerification: input.latestVerification ?? null,
		researchRun: input.researchRun ?? null,
		latestSynthesis: input.latestSynthesis ?? null,
		latestCritique: input.latestCritique ?? null,
		rollbacks: [...input.rollbacks],
		inspectorTarget,
	};
}

function getMissionInspectorTarget(
	contracts: MissionContractRecord[],
	laneRuns: MissionLaneRun[],
): MissionInspectorTarget | null {
	for (const contract of [...contracts].reverse()) {
		if (contract.taskId || contract.sessionFile) {
			return { taskId: contract.taskId, sessionFile: contract.sessionFile, source: "contract" };
		}
	}
	for (const laneRun of [...laneRuns].reverse()) {
		if (laneRun.taskId) {
			return { taskId: laneRun.taskId, sessionFile: null, source: "lane-run" };
		}
	}
	return null;
}

export class MissionReadModel {
	readonly #missions: MissionStore;
	readonly #research: ResearchStore;
	readonly #objectives: ObjectiveStore;
	readonly #proposals: ProposalStore;

	constructor(opts: { dbPath?: string } = {}) {
		this.#missions = new MissionStore(opts.dbPath);
		this.#research = new ResearchStore(opts.dbPath);
		this.#objectives = new ObjectiveStore(opts.dbPath);
		this.#proposals = new ProposalStore(opts.dbPath);
	}

	close(): void {
		this.#proposals.close();
		this.#objectives.close();
		this.#research.close();
		this.#missions.close();
	}

	getMissionView(missionId: string): MissionView | undefined {
		const mission = this.#missions.getMission(missionId);
		return mission ? this.#buildViewForMission(mission) : undefined;
	}

	listMissionViews(opts: { objectiveId?: string; briefId?: string; state?: MissionState } = {}): MissionView[] {
		return this.#missions.listMissions(opts).map(mission => this.#buildViewForMission(mission));
	}

	getPreferredMissionView(
		opts: { objectiveId?: string; briefId?: string; title?: string } = {},
	): MissionView | undefined {
		const mission = this.#missions.getPreferredMission(opts);
		return mission ? this.#buildViewForMission(mission) : undefined;
	}

	#buildViewForMission(mission: Mission): MissionView {
		const brief = mission.briefId ? this.#research.getBrief(mission.briefId) : undefined;
		const decision = brief ? this.#getDecisionForMission(mission, brief.id) : undefined;
		const evidence = brief ? this.#research.listEvidence(brief.id) : [];
		const laneRuns = this.#missions.listLaneRuns(mission.id);
		const objective = mission.objectiveId ? this.#objectives.get(mission.objectiveId) : undefined;
		const proposals = mission.objectiveId ? this.#listProposalsForObjective(mission.objectiveId) : [];
		const contracts = this.#missions.listContracts(mission.id);
		const latestVerification = this.#missions.getLatestVerification(mission.id);
		const rollbacks = this.#missions.listRollbacks(mission.id);
		const researchRun = this.#missions.getLatestResearchRunForMission(mission.id);
		const latestSynthesis = brief ? this.#research.getLatestSynthesis(brief.id) : undefined;
		const latestCritique = brief ? this.#research.getLatestCritique(brief.id) : undefined;

		return buildMissionView({
			mission,
			brief,
			decision,
			evidence,
			laneRuns,
			objective,
			proposals,
			contracts,
			latestVerification,
			rollbacks,
			researchRun,
			latestSynthesis,
			latestCritique,
		});
	}

	#getDecisionForMission(mission: Mission, briefId: string): DecisionRecord | undefined {
		const decisions = this.#research.listDecisions(briefId);
		if (mission.decisionId) {
			const exact = decisions.find(decision => decision.id === mission.decisionId);
			if (exact) return exact;
		}
		return decisions.at(-1);
	}

	#listProposalsForObjective(objectiveId: string): LearningProposal[] {
		return MISSION_PROPOSAL_STATUSES.flatMap(status => this.#proposals.listByStatus(status)).filter(
			proposal => getProposalObjectiveId(proposal) === objectiveId,
		);
	}
}

function getProposalObjectiveId(proposal: LearningProposal): string | null {
	const provenance = proposal.provenance as LearningProposal["provenance"] & { objectiveId?: unknown };
	return typeof provenance.objectiveId === "string" ? provenance.objectiveId : null;
}

function getProposalUpdatedAt(proposal: LearningProposal): number {
	const row = proposal as unknown as { updatedAt?: unknown };
	return typeof row.updatedAt === "number" ? row.updatedAt : proposal.createdAt;
}

function getObjectiveUpdatedAt(objective: Objective): number {
	const row = objective as unknown as { updatedAt?: unknown };
	return typeof row.updatedAt === "number" ? row.updatedAt : 0;
}
