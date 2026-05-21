/**
 * V3 T4-G integration — wires `runRevisionLoop` into the task tool's subagent execution path.
 *
 * Decouples the revision-loop logic from `task/index.ts` so it can be tested in isolation
 * and ship without rewriting the 1000+ line task tool execution pipeline. The task tool
 * passes in a single-shot `runOnce` callback (which wraps `runSubprocess`) plus a way to
 * capture filesystem diffs; this module orchestrates the verify-retry loop.
 *
 * Why not inline into runTask?
 *   - Keeps the existing single-pass path untouched for contract-less tasks (zero risk of
 *     regression to the dominant case).
 *   - The revision-loop is a SEAM — testable independently with a mock `runOnce` callback
 *     that returns scripted SingleResults. Acceptance assertions live next to the helper.
 *   - When/if we later swap the underlying execution mechanism (e.g. structured-output
 *     subagents, streaming returns), this module's contract stays stable.
 */

import {
	type RevisionRequest,
	renderRevisionRequest,
	runRevisionLoop,
	type SubagentCompletion,
	type SubagentContract,
} from "./contract";

/**
 * Minimal subset of `SingleResult` that the revision loop cares about. Keeping the surface
 * tight here means changes to executor.ts result shapes don't propagate noise into this
 * module's tests.
 */
export interface TaskAttemptResult {
	output: string;
	exitCode: number;
	aborted: boolean;
	/** Files the subagent's session reported as changed during this attempt. */
	changedFiles: string[];
	/** Working directory the subagent ran in (for verifier lookups). */
	cwd: string;
}

export interface ExecuteContractedTaskOptions {
	contract: SubagentContract;
	/**
	 * Drive ONE subagent execution. Called once for the initial attempt (revisionRequest=undefined)
	 * and again per retry with the structured failure list. Implementation typically wraps
	 * `runSubprocess` from `task/executor.ts`.
	 */
	runOnce: (input: {
		baseAssignment: string;
		revisionRequest: RevisionRequest | undefined;
		composedAssignment: string;
	}) => Promise<TaskAttemptResult>;
	/** The unrevised assignment from `task.assignment`. The loop prepends RevisionRequest on retry. */
	baseAssignment: string;
	/**
	 * How many retries are allowed. Default is the conservative 1 — auto-retry is a
	 * courtesy, not an open-ended fix-it loop. Set to 0 to disable retry (single-pass).
	 */
	maxRetries?: number;
}

export interface ExecuteContractedTaskOutcome {
	finalResult: TaskAttemptResult;
	finalVerdict: import("../goals/verifier").VerificationVerdict;
	attempts: Array<{
		result: TaskAttemptResult;
		verdict: import("../goals/verifier").VerificationVerdict;
	}>;
}

/**
 * Run a contracted task with verifier-driven retry. Composes the revision request into the
 * subagent assignment text — the retry attempt sees what failed and gets an explicit
 * instruction to iterate, not start over.
 */
export async function executeContractedTask(
	options: ExecuteContractedTaskOptions,
): Promise<ExecuteContractedTaskOutcome> {
	const { contract, runOnce, baseAssignment } = options;
	const maxRetries = options.maxRetries ?? 1;
	const perAttempt: Array<{ result: TaskAttemptResult; verdict: import("../goals/verifier").VerificationVerdict }> =
		[];

	let lastResult: TaskAttemptResult | undefined;

	const completionsToVerdicts = new WeakMap<SubagentCompletion, TaskAttemptResult>();

	const loopOutcome = await runRevisionLoop({
		contract,
		maxRetries,
		attempt: async revisionRequest => {
			const composedAssignment = revisionRequest
				? `${renderRevisionRequest(revisionRequest)}\n\n---\n\n${baseAssignment}`
				: baseAssignment;
			const result = await runOnce({ baseAssignment, revisionRequest, composedAssignment });
			lastResult = result;
			const completion: SubagentCompletion = {
				role: contract.role,
				cwd: result.cwd,
				changedFiles: result.changedFiles,
			};
			// Stash the attempt result so we can pair verdicts back to SingleResult-shapes on output.
			completionsToVerdicts.set(completion, result);
			return completion;
		},
	});

	for (const entry of loopOutcome.attempts) {
		const tied = completionsToVerdicts.get(entry.completion);
		if (tied) perAttempt.push({ result: tied, verdict: entry.verdict });
	}

	if (!lastResult) {
		// runRevisionLoop guarantees attempt() is called at least once, so this is unreachable
		// in practice — but the type system needs the fallback.
		throw new Error("executeContractedTask: revision loop produced no attempts");
	}

	return {
		finalResult: lastResult,
		finalVerdict: loopOutcome.finalVerdict,
		attempts: perAttempt,
	};
}

/**
 * git-diff-based snapshot helper used by the task tool to compute `changedFiles` between
 * before/after of a subagent attempt. Returns paths relative to `cwd` (porcelain format).
 *
 * Failure-mode: when git is unavailable or cwd is not a repo, returns empty list. The
 * verifier handles empty changedFiles gracefully (scope-* turn `uncertain`, file-* and
 * command-* still work).
 */
export async function snapshotGitChangedFiles(cwd: string): Promise<string[]> {
	try {
		const proc = Bun.spawn(["git", "status", "--porcelain=v1", "-z"], {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
		});
		const exitCode = await proc.exited;
		if (exitCode !== 0) return [];
		const raw = await new Response(proc.stdout).text();
		const paths = new Set<string>();
		for (const entry of raw.split("\0")) {
			if (entry.length < 4) continue;
			paths.add(entry.slice(3));
		}
		return [...paths];
	} catch {
		return [];
	}
}
