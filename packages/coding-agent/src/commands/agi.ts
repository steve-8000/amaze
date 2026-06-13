import { Args, Command, Flags } from "@amaze/utils/cli";

const ACTIONS = ["tui", "status", "events", "actions", "add", "run", "pause", "resume", "unblock", "remove"] as const;
type AgiAction = (typeof ACTIONS)[number];

export default class Agi extends Command {
	static description = "Open the AGI gateway TUI and manage monitored sessions";

	static args = {
		action: Args.string({ description: "AGI action", required: false, options: [...ACTIONS] }),
	};

	static flags = {
		db: Flags.string({ description: "Path to AGI gateway SQLite database" }),
		session: Flags.string({ description: "Session id or .jsonl path to add/control/filter" }),
		cwd: Flags.string({ description: "Current project directory for local session preference" }),
		"tick-ms": Flags.integer({ description: "AGI supervisor polling interval in milliseconds" }),
		once: Flags.boolean({ description: "Run exactly one AGI supervisor tick" }),
		mission: Flags.string({ description: "Mission id to bind when adding an AGI session" }),
		objective: Flags.string({ description: "Mission objective for AGI session goal derivation" }),
		"objective-contract": Flags.string({ description: "Objective contract id for AGI session binding" }),
		criteria: Flags.string({
			description: "Acceptance criterion for mission-bound AGI sessions; repeat or separate with newlines",
			multiple: true,
		}),
		"legacy-trust-self-report": Flags.boolean({
			description: "Compatibility mode: allow AGI structured self-report completion without verifier evidence",
		}),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(Agi);
		const action = (args.action ?? "tui") as AgiAction;
		const { runAgiCommand } = await import("../cli/agi");
		await runAgiCommand({
			action,
			db: flags.db,
			session: flags.session,
			cwd: flags.cwd,
			tickMs: flags["tick-ms"],
			once: flags.once,
			mission: flags.mission,
			objective: flags.objective,
			objectiveContract: flags["objective-contract"],
			criteria: normalizeCriteriaFlags(flags.criteria),
			legacyTrustSelfReport: flags["legacy-trust-self-report"],
		});
	}
}

function normalizeCriteriaFlags(values: string[] | string | undefined): string[] | undefined {
	if (!values) return undefined;
	const raw = Array.isArray(values) ? values : [values];
	const criteria = raw
		.flatMap(value => value.split(/\r?\n/))
		.map(value => value.trim())
		.filter(Boolean);
	return criteria.length > 0 ? criteria : undefined;
}
