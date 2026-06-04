/**
 * Manage memory storage and diagnostics.
 */
import { Args, Command, Flags } from "@amaze/utils/cli";

const ACTIONS = ["doctor", "sync", "migrate"] as const;

type MemoryAction = (typeof ACTIONS)[number];

const MIGRATE_SOURCES = ["pi-hermes"] as const;

export default class Memory extends Command {
	static description = "Manage memory storage and diagnostics";

	static args = {
		action: Args.string({
			description: "Memory action",
			required: false,
			options: [...ACTIONS],
		}),
		rest: Args.string({
			description: "Migration arguments",
			required: false,
			multiple: true,
		}),
	};

	static flags = {
		from: Flags.string({ description: "Migration source", options: [...MIGRATE_SOURCES] }),
		"dry-run": Flags.boolean({ description: "Inventory migration without writing" }),
		apply: Flags.boolean({ description: "Apply migration writes" }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(Memory);
		const action = (args.action ?? "doctor") as MemoryAction;

		const { runMemoryCommand } = await import("../cli/memory");
		await runMemoryCommand({
			action,
			from: (flags.from as "pi-hermes" | undefined) ?? parseFromArg(Array.isArray(args.rest) ? args.rest : []),
			dryRun: flags["dry-run"],
			apply: flags.apply,
		});
	}
}

function parseFromArg(args: string[]): "pi-hermes" | undefined {
	const fromIndex = args.indexOf("--from");
	if (fromIndex >= 0 && args[fromIndex + 1] === "pi-hermes") return "pi-hermes";
	return undefined;
}
