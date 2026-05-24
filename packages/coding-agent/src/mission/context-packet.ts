import type { MissionView } from "./read-model";

const MAX_EVIDENCE_CLAIMS = 5;
const MAX_NEXT_ACTIONS = 5;
const MAX_CONTRACT_INCLUDES = 3;
const MAX_CONTRACT_CRITERIA = 5;

export interface ActiveMissionPacket {
	objective: string;
	state: MissionView["mission"]["state"];
	decision: {
		hypothesis: string;
		kind: NonNullable<MissionView["decisionSummary"]>["kind"];
		confidence: NonNullable<MissionView["decisionSummary"]>["confidence"];
		evidenceRefs: string[];
	} | null;
	activeContract: {
		role: string;
		scopeIncludes: string[];
		successCriteria: string[];
		mustProduce: string[];
	} | null;
	evidenceClaims: Array<{ id: string; lane: string; grade: string; claim: string }>;
	blockingCritique: {
		verdict: string;
		blockingCount: number;
		summary: string;
	} | null;
	nextActions: string[];
	omitted: {
		evidenceClaims: number;
		evidenceCards: number;
		contracts: number;
		contractIncludes: number;
		contractCriteria: number;
		nextActions: number;
	};
}

export function buildActiveMissionPacket(view: MissionView): ActiveMissionPacket {
	const activeContract = view.contracts.at(-1) ?? null;
	const evidenceClaims = view.evidenceCards.flatMap(card =>
		card.claims.map(claim => ({ id: card.id, lane: card.lane, grade: card.grade, claim })),
	);
	const nextActions = view.decision?.nextActions ?? [];
	const blockingCritique = view.latestCritique?.blockingCount
		? {
				verdict: view.latestCritique.verdict,
				blockingCount: view.latestCritique.blockingCount,
				summary: view.latestCritique.summary,
			}
		: null;

	return {
		objective: view.objective?.title ?? view.mission.title,
		state: view.mission.state,
		decision: view.decisionSummary
			? {
					hypothesis: view.decisionSummary.hypothesis,
					kind: view.decisionSummary.kind,
					confidence: view.decisionSummary.confidence,
					evidenceRefs: [...view.decisionSummary.evidenceRefs],
				}
			: null,
		activeContract: activeContract
			? {
					role: activeContract.role,
					scopeIncludes: activeContract.include.slice(0, MAX_CONTRACT_INCLUDES),
					successCriteria: activeContract.successCriteria.slice(0, MAX_CONTRACT_CRITERIA),
					mustProduce: [...activeContract.mustProduce],
				}
			: null,
		evidenceClaims: evidenceClaims.slice(0, MAX_EVIDENCE_CLAIMS),
		blockingCritique,
		nextActions: nextActions.slice(0, MAX_NEXT_ACTIONS),
		omitted: {
			evidenceClaims: Math.max(0, evidenceClaims.length - MAX_EVIDENCE_CLAIMS),
			evidenceCards: Math.max(0, view.evidenceCards.length - MAX_EVIDENCE_CLAIMS),
			contracts: Math.max(0, view.contracts.length - (activeContract ? 1 : 0)),
			contractIncludes: activeContract ? Math.max(0, activeContract.include.length - MAX_CONTRACT_INCLUDES) : 0,
			contractCriteria: activeContract
				? Math.max(0, activeContract.successCriteria.length - MAX_CONTRACT_CRITERIA)
				: 0,
			nextActions: Math.max(0, nextActions.length - MAX_NEXT_ACTIONS),
		},
	};
}

export function renderActiveMissionPacket(packet: ActiveMissionPacket | null | undefined): string {
	if (!packet) return "";
	const lines = [
		"<active-mission>",
		`Objective: ${packet.objective}`,
		`State: ${packet.state}`,
		`Decision: ${packet.decision ? `${packet.decision.confidence} confidence — ${packet.decision.hypothesis}` : "<none>"}`,
	];
	if (packet.activeContract) {
		lines.push(
			`Active contract: ${packet.activeContract.role}; scope ${formatList(packet.activeContract.scopeIncludes)}; criteria ${formatList(packet.activeContract.successCriteria)}; must produce ${formatList(packet.activeContract.mustProduce)}`,
		);
	}
	if (packet.evidenceClaims.length > 0) {
		lines.push("Top evidence claims:");
		for (const claim of packet.evidenceClaims) {
			lines.push(`- ${claim.id} [${claim.lane}/${claim.grade}]: ${claim.claim}`);
		}
	}
	if (packet.blockingCritique) {
		lines.push(
			`Blocking critique: ${packet.blockingCritique.verdict}; ${packet.blockingCritique.blockingCount} blocking — ${packet.blockingCritique.summary}`,
		);
	}
	if (packet.nextActions.length > 0) {
		lines.push(`Next actions: ${formatList(packet.nextActions)}`);
	}
	lines.push(
		`Omitted: ${packet.omitted.evidenceClaims} evidence claims, ${packet.omitted.evidenceCards} evidence cards, ${packet.omitted.contracts} older contracts, ${packet.omitted.contractIncludes} contract includes, ${packet.omitted.contractCriteria} contract criteria, ${packet.omitted.nextActions} next actions.`,
		"</active-mission>",
	);
	return lines.join("\n");
}

function formatList(values: string[]): string {
	return values.length > 0 ? values.join("; ") : "<none>";
}
