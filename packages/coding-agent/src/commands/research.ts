import { Args, Command, Flags } from "@amaze/utils/cli";

const ACTIONS = [
	"brief",
	"list",
	"show",
	"add-evidence",
	"list-evidence",
	"decide",
	"score",
	"synthesize",
	"critique",
] as const;
type ResearchAction = (typeof ACTIONS)[number];

export default class Research extends Command {
	static description =
		"Complementary research protocol — briefs, evidence cards, decision records, complementarity scoring.";

	static args = {
		action: Args.string({ description: "Research action", required: false, options: [...ACTIONS] }),
		id: Args.string({
			description: "Brief id (for show/score/add-evidence/list-evidence/decide/synthesize/critique)",
			required: false,
		}),
	};

	static flags = {
		db: Flags.string({ description: "Path to autonomy SQLite database (default ~/.amaze/autonomy/autonomy.db)" }),
		objective: Flags.string({ description: "Objective id (filter for list; link for brief)" }),
		question: Flags.string({ description: "Research question (required for brief)" }),
		lanes: Flags.string({ description: "Lanes for brief; comma-separated subset of repo,source,social,memory" }),
		risk: Flags.string({ description: "Risk level for brief: low|medium|high" }),
		required: Flags.string({ description: "Required evidence keywords (comma-separated)" }),
		disallowed: Flags.string({ description: "Disallowed evidence keywords (comma-separated)" }),
		stop: Flags.string({ description: "Stop criteria for brief (semicolon-separated)" }),
		lane: Flags.string({ description: "Single lane for add-evidence" }),
		grade: Flags.string({ description: "Evidence grade A|B|C|D|E" }),
		source: Flags.string({ description: "Evidence source ref (url or path)" }),
		excerpt: Flags.string({ description: "Evidence excerpt" }),
		claim: Flags.string({ description: "Evidence claims (comma-separated)" }),
		directness: Flags.string({ description: "Evidence directness 0..1 (default 0.5)" }),
		specificity: Flags.string({ description: "Evidence specificity 0..1 (default 0.5)" }),
		recency: Flags.string({ description: "Evidence recency 0..1 (default 0.5)" }),
		reproducibility: Flags.string({ description: "Evidence reproducibility 0..1 (default 0.5)" }),
		hypothesis: Flags.string({ description: "Decision hypothesis" }),
		confidence: Flags.string({ description: "Decision confidence: low|medium|high" }),
		rationale: Flags.string({ description: "Decision rationale" }),
		evidence: Flags.string({ description: "Evidence ids backing the decision (comma-separated)" }),
		next: Flags.string({ description: "Next actions (semicolon-separated)" }),
		rejected: Flags.string({ description: "Rejected options: 'id:reason;id:reason'" }),
		synthesis: Flags.string({ description: "Inline synthesis text for critique" }),
		synthesisFile: Flags.string({ description: "File containing synthesis text for critique" }),
		json: Flags.boolean({ description: "Output JSON" }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(Research);
		if (!args.action) {
			process.stdout.write(
				"usage: amaze research <brief|list|show|add-evidence|list-evidence|decide|score|synthesize|critique> [...]\n",
			);
			return;
		}
		const action = args.action as ResearchAction;

		if (action === "brief") {
			if (!flags.question) throw new Error("research brief requires --question <text>");
			const { runResearchBriefCommand } = await import("../cli/research");
			await runResearchBriefCommand({
				db: flags.db,
				question: flags.question,
				objectiveId: flags.objective,
				lanes: flags.lanes,
				risk: flags.risk,
				required: flags.required,
				disallowed: flags.disallowed,
				stop: flags.stop,
				json: flags.json,
			});
			return;
		}

		if (action === "list") {
			const { runResearchListCommand } = await import("../cli/research");
			await runResearchListCommand({ db: flags.db, objectiveId: flags.objective, json: flags.json });
			return;
		}

		const id = args.id;
		if (!id) throw new Error(`research ${action} requires <brief-id>`);

		if (action === "show") {
			const { runResearchShowCommand } = await import("../cli/research");
			await runResearchShowCommand({ db: flags.db, id, json: flags.json });
			return;
		}

		if (action === "add-evidence") {
			if (!flags.lane) throw new Error("research add-evidence requires --lane <lane>");
			if (!flags.grade) throw new Error("research add-evidence requires --grade <grade>");
			if (!flags.source) throw new Error("research add-evidence requires --source <source>");
			if (!flags.excerpt) throw new Error("research add-evidence requires --excerpt <text>");
			const { runResearchAddEvidenceCommand } = await import("../cli/research");
			await runResearchAddEvidenceCommand({
				db: flags.db,
				briefId: id,
				lane: flags.lane,
				grade: flags.grade,
				source: flags.source,
				excerpt: flags.excerpt,
				claim: flags.claim,
				directness: parseFloatFlag(flags.directness, 0.5),
				specificity: parseFloatFlag(flags.specificity, 0.5),
				recency: parseFloatFlag(flags.recency, 0.5),
				reproducibility: parseFloatFlag(flags.reproducibility, 0.5),
				json: flags.json,
			});
			return;
		}

		if (action === "list-evidence") {
			const { runResearchListEvidenceCommand } = await import("../cli/research");
			await runResearchListEvidenceCommand({ db: flags.db, briefId: id, json: flags.json });
			return;
		}

		if (action === "decide") {
			if (!flags.hypothesis) throw new Error("research decide requires --hypothesis <text>");
			if (!flags.confidence) throw new Error("research decide requires --confidence <level>");
			if (!flags.rationale) throw new Error("research decide requires --rationale <text>");
			const { runResearchDecideCommand } = await import("../cli/research");
			await runResearchDecideCommand({
				db: flags.db,
				briefId: id,
				hypothesis: flags.hypothesis,
				confidence: flags.confidence,
				rationale: flags.rationale,
				evidence: flags.evidence,
				next: flags.next,
				rejected: flags.rejected,
				json: flags.json,
			});
			return;
		}

		if (action === "score") {
			const { runResearchScoreCommand } = await import("../cli/research");
			await runResearchScoreCommand({ db: flags.db, briefId: id, json: flags.json });
			return;
		}

		if (action === "synthesize") {
			const { runResearchSynthesizeCommand } = await import("../cli/research");
			await runResearchSynthesizeCommand({ db: flags.db, briefId: id });
			return;
		}

		const { runResearchCritiqueCommand } = await import("../cli/research");
		await runResearchCritiqueCommand({
			db: flags.db,
			briefId: id,
			synthesis: flags.synthesis,
			synthesisFile: flags.synthesisFile,
		});
	}
}

function parseFloatFlag(value: string | undefined, fallback: number): number {
	if (value === undefined) return fallback;
	const parsed = Number(value);
	if (Number.isNaN(parsed)) throw new Error(`Invalid float: ${value}`);
	return parsed;
}
