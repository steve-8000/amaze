import * as fs from "node:fs";
import { renderCriticPrompt, renderSynthesizerPrompt } from "../research/prompts";
import { scoreComplementarity } from "../research/scoring";
import { ResearchStore } from "../research/store";
import {
	CONFIDENCE_LEVELS,
	type ConfidenceLevel,
	EVIDENCE_GRADES,
	type EvidenceGrade,
	RESEARCH_LANES,
	type ResearchLane,
	RISK_LEVELS,
	type RiskLevel,
} from "../research/types";

export interface ResearchCommandOptionsBase {
	db?: string;
}

export async function runResearchBriefCommand(
	opts: ResearchCommandOptionsBase & {
		question: string;
		objectiveId?: string;
		lanes?: string;
		risk?: string;
		required?: string;
		disallowed?: string;
		stop?: string;
		json?: boolean;
	},
): Promise<void> {
	const store = new ResearchStore(opts.db);
	try {
		const lanes = opts.lanes ? parseList(opts.lanes) : [...RESEARCH_LANES];
		for (const lane of lanes) validateLane(lane);
		const riskLevel = opts.risk ?? "medium";
		validateRisk(riskLevel);
		const brief = store.createBrief({
			objectiveId: opts.objectiveId ?? null,
			question: opts.question,
			lanes: lanes as ResearchLane[],
			requiredEvidence: parseList(opts.required),
			disallowedEvidence: parseList(opts.disallowed),
			riskLevel: riskLevel as RiskLevel,
			stopCriteria: parseSemicolonList(opts.stop),
		});
		if (opts.json) {
			writeJson(brief);
			return;
		}
		process.stdout.write(
			`created brief: ${brief.id}\nquestion: ${brief.question}\nlanes: ${brief.lanes.join(",")}\nrisk: ${brief.riskLevel}\n`,
		);
	} finally {
		store.close();
	}
}

export async function runResearchListCommand(
	opts: ResearchCommandOptionsBase & {
		objectiveId?: string;
		json?: boolean;
	},
): Promise<void> {
	const store = new ResearchStore(opts.db);
	try {
		const briefs = store.listBriefs({ objectiveId: opts.objectiveId });
		if (opts.json) {
			writeJson(briefs);
			return;
		}
		const lines = [
			"id  risk  question",
			...briefs.map(brief => `${brief.id}  ${brief.riskLevel}  ${truncate(brief.question, 60)}`),
		];
		process.stdout.write(`${lines.join("\n")}\n`);
	} finally {
		store.close();
	}
}

export async function runResearchShowCommand(
	opts: ResearchCommandOptionsBase & {
		id: string;
		json?: boolean;
	},
): Promise<void> {
	const store = new ResearchStore(opts.db);
	try {
		const brief = requireBrief(store, opts.id);
		const evidence = store.listEvidence(brief.id);
		const decision = store.getDecision(brief.id);
		if (opts.json) {
			writeJson({ brief, evidence, decision });
			return;
		}
		const lines = [
			`id: ${brief.id}`,
			`question: ${brief.question}`,
			`objective: ${brief.objectiveId ?? "<none>"}`,
			`lanes: ${brief.lanes.join(",")}`,
			`risk: ${brief.riskLevel}`,
			`required: ${brief.requiredEvidence.join(",")}`,
			`disallowed: ${brief.disallowedEvidence.join(",")}`,
			`stop: ${brief.stopCriteria.join("; ")}`,
			``,
			`evidence (${evidence.length}):`,
			...evidence.map(
				card =>
					`  ${card.id}  ${card.lane}/${card.grade}  ${card.sourceRef}  excerpt: ${truncate(card.excerpt, 80)}`,
			),
			``,
		];
		if (decision) {
			lines.push(
				"decision:",
				`  hypothesis: ${decision.hypothesis}`,
				`  confidence: ${decision.confidence}`,
				`  rationale: ${decision.rationale}`,
				`  evidenceRefs: ${decision.evidenceRefs.join(",")}`,
			);
		} else {
			lines.push("decision: <none>");
		}
		process.stdout.write(`${lines.join("\n")}\n`);
	} finally {
		store.close();
	}
}

export async function runResearchAddEvidenceCommand(
	opts: ResearchCommandOptionsBase & {
		briefId: string;
		lane: string;
		grade: string;
		source: string;
		excerpt: string;
		claim?: string;
		directness?: number;
		specificity?: number;
		recency?: number;
		reproducibility?: number;
		json?: boolean;
	},
): Promise<void> {
	validateLane(opts.lane);
	validateGrade(opts.grade);
	const store = new ResearchStore(opts.db);
	try {
		const evidence = store.addEvidence({
			briefId: opts.briefId,
			lane: opts.lane as ResearchLane,
			grade: opts.grade as EvidenceGrade,
			sourceRef: opts.source,
			excerpt: opts.excerpt,
			claims: parseList(opts.claim),
			directness: opts.directness ?? 0.5,
			specificity: opts.specificity ?? 0.5,
			recency: opts.recency ?? 0.5,
			reproducibility: opts.reproducibility ?? 0.5,
		});
		if (opts.json) {
			writeJson(evidence);
			return;
		}
		process.stdout.write(`added evidence: ${evidence.id} to brief ${opts.briefId}\n`);
	} finally {
		store.close();
	}
}

export async function runResearchListEvidenceCommand(
	opts: ResearchCommandOptionsBase & {
		briefId: string;
		json?: boolean;
	},
): Promise<void> {
	const store = new ResearchStore(opts.db);
	try {
		requireBrief(store, opts.briefId);
		const evidence = store.listEvidence(opts.briefId);
		if (opts.json) {
			writeJson(evidence);
			return;
		}
		const lines = [
			"id  lane/grade  source",
			...evidence.map(card => `${card.id}  ${card.lane}/${card.grade}  ${card.sourceRef}`),
		];
		process.stdout.write(`${lines.join("\n")}\n`);
	} finally {
		store.close();
	}
}

export async function runResearchDecideCommand(
	opts: ResearchCommandOptionsBase & {
		briefId: string;
		hypothesis: string;
		confidence: string;
		rationale: string;
		evidence?: string;
		next?: string;
		rejected?: string;
		json?: boolean;
	},
): Promise<void> {
	validateConfidence(opts.confidence);
	const store = new ResearchStore(opts.db);
	try {
		const decision = store.recordDecision({
			briefId: opts.briefId,
			hypothesis: opts.hypothesis,
			rationale: opts.rationale,
			confidence: opts.confidence as ConfidenceLevel,
			evidenceRefs: parseList(opts.evidence),
			rejectedOptions: parseRejected(opts.rejected),
			nextActions: parseSemicolonList(opts.next),
		});
		if (opts.json) {
			writeJson(decision);
			return;
		}
		process.stdout.write(`recorded decision: ${decision.id} on brief ${opts.briefId}\n`);
	} finally {
		store.close();
	}
}

export async function runResearchScoreCommand(
	opts: ResearchCommandOptionsBase & {
		briefId: string;
		json?: boolean;
	},
): Promise<void> {
	const store = new ResearchStore(opts.db);
	try {
		const brief = requireBrief(store, opts.briefId);
		const evidence = store.listEvidence(brief.id);
		const score = scoreComplementarity(brief, evidence);
		if (opts.json) {
			writeJson(score);
			return;
		}
		process.stdout.write(
			`${[
				`total: ${score.total}`,
				`laneCoverage: ${score.laneCoverage}`,
				`sourceQuality: ${score.sourceQuality}`,
				`contradictionPenalty: ${score.contradictionPenalty}`,
				`stalenessPenalty: ${score.stalenessPenalty}`,
				`socialOverweightPenalty: ${score.socialOverweightPenalty}`,
				"breakdown:",
				...score.breakdown.map(
					item => `  ${item.lane}: cards=${item.cardCount} avgGradeWeight=${item.avgGradeWeight}`,
				),
			].join("\n")}\n`,
		);
	} finally {
		store.close();
	}
}

export async function runResearchSynthesizeCommand(
	opts: ResearchCommandOptionsBase & {
		briefId: string;
	},
): Promise<void> {
	const store = new ResearchStore(opts.db);
	try {
		const brief = requireBrief(store, opts.briefId);
		const evidence = store.listEvidence(brief.id);
		process.stdout.write(`${renderSynthesizerPrompt(brief, evidence)}\n`);
	} finally {
		store.close();
	}
}

export async function runResearchCritiqueCommand(
	opts: ResearchCommandOptionsBase & {
		briefId: string;
		synthesisFile?: string;
		synthesis?: string;
	},
): Promise<void> {
	const store = new ResearchStore(opts.db);
	try {
		const brief = requireBrief(store, opts.briefId);
		const evidence = store.listEvidence(brief.id);
		const synthesis = resolveSynthesis(opts.synthesis, opts.synthesisFile);
		process.stdout.write(`${renderCriticPrompt(brief, evidence, synthesis)}\n`);
	} finally {
		store.close();
	}
}

function requireBrief(store: ResearchStore, id: string) {
	const brief = store.getBrief(id);
	if (!brief) throw new Error(`Research brief not found: ${id}`);
	return brief;
}

function writeJson(value: unknown): void {
	process.stdout.write(`${JSON.stringify(value)}\n`);
}

function parseList(value: string | undefined): string[] {
	return value
		? value
				.split(",")
				.map(item => item.trim())
				.filter(Boolean)
		: [];
}

function parseSemicolonList(value: string | undefined): string[] {
	return value
		? value
				.split(";")
				.map(item => item.trim())
				.filter(Boolean)
		: [];
}

function parseRejected(value: string | undefined): Array<{ id: string; reason: string }> {
	return parseSemicolonList(value).map(item => {
		const index = item.indexOf(":");
		const id = index === -1 ? item.trim() : item.slice(0, index).trim();
		const reason = index === -1 ? "" : item.slice(index + 1).trim();
		return { id, reason };
	});
}

function resolveSynthesis(inline: string | undefined, file: string | undefined): string {
	if (inline !== undefined) return inline;
	if (file !== undefined) return fs.readFileSync(file, "utf8");
	throw new Error("critique requires --synthesis <text> or --synthesis-file <path>");
}

function validateLane(value: string): void {
	if (!RESEARCH_LANES.includes(value as ResearchLane)) throw new Error(`Invalid lane: ${value}`);
}

function validateGrade(value: string): void {
	if (!EVIDENCE_GRADES.includes(value as EvidenceGrade)) throw new Error(`Invalid grade: ${value}`);
}

function validateRisk(value: string): void {
	if (!RISK_LEVELS.includes(value as RiskLevel)) throw new Error(`Invalid risk: ${value}`);
}

function validateConfidence(value: string): void {
	if (!CONFIDENCE_LEVELS.includes(value as ConfidenceLevel)) throw new Error(`Invalid confidence: ${value}`);
}

function truncate(value: string, length: number): string {
	return value.length <= length ? value : value.slice(0, length);
}
