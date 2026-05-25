import {
	runMissionDecisionCommand,
	runMissionEvidenceCommand,
	runMissionRollbackCommand,
	runMissionShowCommand,
	runMissionStreamCommand,
	runMissionVerifyCommand,
} from "../../cli/mission";

/**
 * Canonical `/mission` subcommands, per the parallel workplan §18 surface.
 *
 * `create`, `show`, `stream`, `evidence`, `decision`, `verify`, `complete`,
 * `rollback`. The read-model / mission CLI backs the read-only inspection verbs
 * (`show`, `stream`, `evidence`, `decision`, `verify`, `rollback`). The
 * mutating verbs (`create`, `complete`) are still owned by the goal runtime and
 * have no standalone mission write surface yet — they return an explicit
 * "not yet available" stub that points the operator at the `/goal` alias rather
 * than faking behavior.
 */
export const MISSION_SUBCOMMANDS = [
	{ name: "create", description: "Create a mission (not yet available; use /goal set)", usage: "<objective>" },
	{ name: "show", description: "Show mission details", usage: "<missionId>" },
	{ name: "stream", description: "Show or follow the mission event log", usage: "<missionId> [--follow]" },
	{ name: "evidence", description: "List mission evidence", usage: "<missionId>" },
	{ name: "decision", description: "Show the mission decision", usage: "<missionId>" },
	{ name: "verify", description: "Show mission verification status", usage: "<missionId>" },
	{ name: "approve", description: "Approve the active mission's plan as its proposal (unblocks mutations)" },
	{ name: "complete", description: "Complete a mission (not yet available; use /goal complete)" },
	{ name: "rollback", description: "Show mission rollback candidates", usage: "<missionId>" },
] as const;

const READ_VERBS = new Set(["show", "stream", "evidence", "decision", "verify", "rollback"]);

const USAGE = "Usage: /mission <create|show|stream|evidence|decision|verify|complete|rollback> <missionId> [args]";

/** Capture `process.stdout.write` for the duration of `fn`, returning what was written. */
async function captureStdout(fn: () => Promise<void>): Promise<string> {
	let out = "";
	const original = process.stdout.write;
	process.stdout.write = ((chunk: string | Uint8Array) => {
		out += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
		return true;
	}) as typeof process.stdout.write;
	try {
		await fn();
	} finally {
		process.stdout.write = original;
	}
	return out.replace(/\n$/, "");
}

export interface MissionCommandResult {
	/** Text to surface to the operator. */
	output: string;
	/** True when the verb has no backing write surface yet (stubbed). */
	stub: boolean;
}

/**
 * Run a parsed `/mission` invocation against the mission read-model surface.
 *
 * Pure with respect to the session — it only reads the autonomy DB / event log
 * and returns text. Mutating verbs return a stub message instead of side
 * effects. Used by both the slash-command handler and tests.
 */
export async function runMissionSlashCommand(args: string): Promise<MissionCommandResult> {
	const trimmed = args.trim();
	if (!trimmed) return { output: USAGE, stub: false };
	const spaceIdx = trimmed.search(/\s/);
	const verb = (spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)).toLowerCase();
	const rest = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1).trim();

	if (verb === "create") {
		return {
			output:
				"`/mission create` is not yet available — mission creation is still owned by goal mode. " +
				"Use `/goal set <objective>` (the legacy alias) to start an objective that records a mission.",
			stub: true,
		};
	}
	if (verb === "complete") {
		return {
			output:
				"`/mission complete` is not yet available — mission completion is still driven by goal mode. " +
				"Use `/goal complete` (the legacy alias) to run the closing acceptance verification.",
			stub: true,
		};
	}
	if (!READ_VERBS.has(verb)) {
		return { output: USAGE, stub: false };
	}

	const tokens = rest.split(/\s+/).filter(Boolean);
	const id = tokens.find(token => !token.startsWith("-"));
	if (!id) {
		return { output: `Usage: /mission ${verb} <missionId>`, stub: false };
	}
	const follow = tokens.includes("--follow") || tokens.includes("-f");

	try {
		const output = await captureStdout(async () => {
			switch (verb) {
				case "show":
					await runMissionShowCommand({ id });
					return;
				case "stream":
					await runMissionStreamCommand({ id, follow, once: follow });
					return;
				case "evidence":
					await runMissionEvidenceCommand({ id });
					return;
				case "decision":
					await runMissionDecisionCommand({ id });
					return;
				case "verify":
					await runMissionVerifyCommand({ id });
					return;
				case "rollback":
					await runMissionRollbackCommand({ id });
					return;
			}
		});
		return { output, stub: false };
	} catch (error) {
		return { output: error instanceof Error ? error.message : String(error), stub: false };
	}
}
