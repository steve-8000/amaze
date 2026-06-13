/**
 * SubagentWorker — execution-backend seam for subagent runs.
 *
 * The orchestration path (TaskTool / MissionTaskRunner) delegates the actual run
 * through this interface so the in-process executor ({@link runSubprocess}) is one
 * backend among possible others (subprocess, remote worker) rather than a hard
 * dependency of the scheduling/contract/merge logic. Behavior of the default
 * backend is identical to calling `runSubprocess` directly.
 */

import { type ExecutorOptions, runSubprocess } from "./executor";
import type { SingleResult } from "./types";

export interface SubagentWorker {
	/** Backend identifier surfaced in telemetry/debug output. */
	readonly backend: string;
	/** Execute a single subagent run to completion. */
	run(options: ExecutorOptions): Promise<SingleResult>;
}

/** Default backend: runs the subagent on the main thread via {@link runSubprocess}. */
export class InProcessSubagentWorker implements SubagentWorker {
	readonly backend = "in-process";
	run(options: ExecutorOptions): Promise<SingleResult> {
		return runSubprocess(options);
	}
}
