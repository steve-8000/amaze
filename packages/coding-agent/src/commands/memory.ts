/**
 * Manage memory storage and diagnostics.
 */
import { Args, Command, Flags } from "@amaze/utils/cli";
import {
	type MemoryMigrateLegacyArgs,
	runMemoryMigrateLegacyCommand,
	runMemorySearchCommand,
	runMemoryTransitionCommand,
} from "../cli/memory";

const ACTIONS = ["migrate-legacy", "doctor", "search", "mark-superseded", "quarantine"] as const;
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
		value: Args.string({
			description: "Legacy origin, search query, or memory id",
			required: false,
		}),
	};

	static flags = {
		"dry-run": Flags.boolean({ description: "Show migration actions without writing memory" }),
		advanced: Flags.boolean({ description: "Allow raw FTS5 operator syntax for memory search" }),
		scope: Flags.string({
			description: "Search scope",
			options: ["current_project", "global", "knowledge", "failure", "session", "all"],
		}),
		limit: Flags.integer({ description: "Maximum search results", default: 8 }),
		json: Flags.boolean({ description: "Output JSON" }),
		reason: Flags.string({ description: "Reason for status transition" }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(Memory);
		const action = (args.action ?? "doctor") as MemoryAction;

		if (action === "doctor") {
			const { runMemoryDoctorCommand } = await import("../cli/memory");
			runMemoryDoctorCommand();
			return;
		}

		if (action === "search") {
			const query = args.value;
			if (!query) throw new Error("memory search requires a query");
			runMemorySearchCommand({
				query,
				advanced: flags.advanced,
				scope: flags.scope as
					| "current_project"
					| "global"
					| "knowledge"
					| "failure"
					| "session"
					| "all"
					| undefined,
				limit: flags.limit,
				json: flags.json,
			});
			return;
		}

		if (action === "mark-superseded" || action === "quarantine") {
			const id = args.value;
			if (!id) throw new Error(`memory ${action} requires an id`);
			runMemoryTransitionCommand({ action, id, reason: flags.reason, json: flags.json });
			return;
		}

		const from = args.value as MemoryMigrateLegacyArgs["from"] | undefined;
		if (!from || !LEGACY_ORIGINS.includes(from)) {
			throw new Error("memory migrate-legacy requires --from <rockey|hindsight> or a positional origin");
		}

		await runMemoryMigrateLegacyCommand({ from, dryRun: flags["dry-run"] });
	}
}
