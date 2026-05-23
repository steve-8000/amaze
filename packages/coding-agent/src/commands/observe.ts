/**
 * Inspect observability event streams.
 */
import { Args, Command, Flags } from "@amaze/utils/cli";

const ACTIONS = ["tail", "export"] as const;
type ObserveAction = (typeof ACTIONS)[number];

export default class Observe extends Command {
	static description = "Inspect observability events";

	static args = {
		action: Args.string({ description: "Observe action", required: true, options: [...ACTIONS] }),
	};

	static flags = {
		filter: Flags.string({ description: "Only include events with this type" }),
		session: Flags.string({ description: "Session id to export" }),
		since: Flags.string({ description: "Only include events at or after this timestamp" }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(Observe);
		const action = args.action as ObserveAction;

		if (action === "tail") {
			const { runObserveTailCommand } = await import("../cli/observe");
			runObserveTailCommand({ filter: flags.filter });
			return;
		}

		const { runObserveExportCommand } = await import("../cli/observe");
		await runObserveExportCommand({
			session: flags.session ?? "",
			filter: flags.filter,
			since: parseOptionalNumber(flags.since, "--since"),
		});
	}
}

function parseOptionalNumber(value: string | undefined, label: string): number | undefined {
	if (value === undefined) return undefined;
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) throw new Error(`${label} must be a finite number`);
	return parsed;
}
