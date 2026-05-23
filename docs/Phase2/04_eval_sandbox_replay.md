# T11.4 — Sandbox-replay eval gate

## Current state (grounded)

`packages/coding-agent/src/learning/eval/replay.ts` `replaySession({ sessionId, baseDir, events?, memoryPatch? })` reads JSONL events, extracts `goal.complete.verdict` and `subagent.end.verdict`, returns `ReplayReport` with `networkCalls: 0` and zero command execution. It is event-decision recompute, not state replay.

`evaluateProposal()` (`packages/coding-agent/src/learning/eval/pipeline.ts`) wires provenance → contradiction → replay gates against this event-only replay.

## Acceptance

1. New module `packages/coding-agent/src/learning/eval/sandbox-replay.ts` exporting `runSandboxReplay(proposal, opts)`:
   - Creates an ephemeral worktree under `~/.amaze/eval/sandboxes/<proposalId>/` (or OS temp).
   - Applies the proposal's snapshot patch in dry-run-then-apply fashion using existing `learning/apply/snapshots.ts` primitives.
   - Runs every entry in `proposal.regressionCommands` (new field below) as `argv` with a per-command timeout (default 120s, cap 600s).
   - Captures `{ command, exit, stdout, stderr, durationMs }` per command.
   - Reverts via snapshot on completion or error.
   - Returns `SandboxReplayReport { ok: boolean; perCommand: [...]; revertedCleanly: boolean }`.
2. `LearningProposal` (in `learning/types.ts`) gains optional `regressionCommands?: Array<{ argv: string[]; cwd?: string; timeoutMs?: number; expected?: number }>`.
3. `evaluateProposal()` invokes `runSandboxReplay` when:
   - `proposal.regressionCommands?.length > 0`, AND
   - prior gates (provenance, contradiction) returned non-fail.
   The report is included in the returned `EvalReport.sandbox`.
4. When sandbox fails any command, the overall eval verdict is `fail`.
5. `proposal.gate === "auto"` requires a successful sandbox replay; `proposal.gate === "human-required"` does not block on missing replay.
6. Tests in `packages/coding-agent/test/learning/sandbox-replay.test.ts`:
   - Settings-type proposal with a passing `echo` regression command → `ok: true`.
   - Settings-type proposal with a failing `exit 1` regression command → `ok: false`, eval verdict `fail`.
   - Worktree cleanup happens even when a command throws (assert temp dir is gone).
   - Timeout (`timeoutMs: 100`, command `sleep 5`) yields `exit !== 0` and surfaces a timeout reason.

## Implementation outline

```ts
// learning/eval/sandbox-replay.ts
export interface SandboxReplayReport {
  ok: boolean;
  perCommand: Array<{ command: string; argv: string[]; exit: number | null; stdout: string; stderr: string; durationMs: number; timedOut: boolean }>;
  revertedCleanly: boolean;
}

export async function runSandboxReplay(
  proposal: LearningProposal,
  opts: { workspaceRoot: string; tmpRoot?: string },
): Promise<SandboxReplayReport> { /* ... */ }
```

Reuse `learning/apply/snapshots.ts` for snapshot capture/restore; do NOT duplicate atomic-write logic.

Use `Bun.spawn` with `signal: AbortSignal.timeout(timeoutMs)` for command execution. Capture stdout/stderr via `Bun.readableStreamToText`.

Snapshot restore is guaranteed via `try { ... } finally { restore() }`.

## Boundaries

- Touch: `src/learning/eval/sandbox-replay.ts` (new), `src/learning/eval/pipeline.ts`, `src/learning/eval/index.ts` (re-export), `src/learning/types.ts` (field add), `test/learning/sandbox-replay.test.ts` (new).
- Do not modify `src/learning/eval/replay.ts` (it stays as event-decision replay for that orthogonal purpose).
- Do not modify `applyProposal` directly — T11.7 owns the apply-side gate.

## Verification

- `bun --cwd packages/coding-agent test test/learning/sandbox-replay.test.ts` exit 0.
- `bun --cwd packages/coding-agent test test/learning` sweep exit 0.
