import { Args, Command, Flags } from "@amaze/utils/cli";

const ACTIONS = ["run"] as const;
type AgiEvalAction = (typeof ACTIONS)[number];

export default class AgiEval extends Command {
	static description = "Run AGI substrate evals";

	static args = {
		action: Args.string({ description: "AGI eval action", required: false, options: [...ACTIONS] }),
	};

	static flags = {
		manifest: Flags.string({ description: "Path to AGI eval manifest", default: "evals/agi/manifest.json" }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(AgiEval);
		const { runAgiEvalCommand } = await import("../cli/agi-eval");
		await runAgiEvalCommand({ action: (args.action ?? "run") as AgiEvalAction, manifest: flags.manifest });
	}
}
