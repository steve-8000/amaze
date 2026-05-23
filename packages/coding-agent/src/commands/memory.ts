/**
 * Manage memory storage and diagnostics.
 */
import { Args, Command, Flags } from "@amaze/utils/cli";
import { type MemoryMigrateLegacyArgs, runMemoryMigrateLegacyCommand } from "../cli/memory";

const ACTIONS = ["migrate-legacy", "doctor"] as const;
const LEGACY_ORIGINS = ["rockey", "hindsight"] as const;

type MemoryAction = (typeof ACTIONS)[number];

export default class Memory extends Command {
	static description = "Manage memory storage and diagnostics";

	static args = {
		action: Args.string({
			description: "Memory action",
			required: false,
			options: [...ACTIONS],
		}),
		from: Args.string({
			description: "Legacy backend to migrate from",
			required: false,
			options: [...LEGACY_ORIGINS],
		}),
	};

	static flags = {
		"dry-run": Flags.boolean({ description: "Show migration actions without writing memory" }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(Memory);
		const action = (args.action ?? "doctor") as MemoryAction;

		if (action === "doctor") {
			const { runDoctor } = await import("../cli/memory");
			await runDoctor();
			return;
		}

		const from = args.from as MemoryMigrateLegacyArgs["from"] | undefined;
		if (!from) {
			throw new Error("memory migrate-legacy requires --from <rockey|hindsight> or a positional origin");
		}

		await runMemoryMigrateLegacyCommand({ from, dryRun: flags["dry-run"] });
	}
}
