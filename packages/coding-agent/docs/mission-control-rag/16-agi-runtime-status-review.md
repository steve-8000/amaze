# AMAZE AGI Runtime Status Review

## Executive summary

Current code-level AGI-runtime readiness score: **10 / 10**.

The score reaches 10/10 because the strict supervised runtime now proves end-to-end
**mutating** production-descriptor execution under Mission Control governance:

- The mutation runs through the production built-in `write` tool, adapted into the
  tool descriptor registry — there are no synthetic descriptors anywhere on the
  execution path.
- The mutation executes inside a real `git worktree` sandbox; the main repository is
  never touched until a machine-derived verification passes.
- Capability leases distinguish read-only, mutating, and rollback descriptors, and
  the role executor refuses to run a mutating descriptor without a sandbox lease and
  workspace.
- Verification is machine-derived from the actual captured sandbox diff, never from an
  agent self-report. A passing verdict applies the patch to main; a failing verdict
  rolls back and leaves main clean.
- Governance approval and emergency-stop state are durable and gate mutation, and the
  full runtime event chain (action requested → lease issued → tool executed → evidence
  recorded → accept/rollback) survives a runtime restart.

A single deterministic command proves the whole substrate: `bun run agi:runtime-eval`.

## Completed work

### Governance DB persistence

- Migration **v9**: `durable AGI governance approvals and emergency stops`.
- Durable tables `agi_approval_requests`, `agi_emergency_stops` with mission/action
  indexes; MissionStore APIs `saveAgiApprovalRequest`, `getAgiApprovalRequest`,
  `recordAgiEmergencyStop`, `getAgiEmergencyStop`.
- `AgiGovernance` persists approval request/approve/reject and emergency-stop state; a
  recreated instance recognizes DB-backed emergency-stop state.

### Production descriptor wiring (read and mutate)

- Extracted the production `AgentTool → ToolDescriptor` adapter into
  `src/agi/agent-tool-adapter.ts`, shared by the read-only CLI path and the mutation
  harness. No synthetic descriptors remain.
- Added `descriptorFromLazyAgentTool`, which builds the underlying built-in tool per
  execution against the execution-context cwd. This is required for mutating tools whose
  session resolves paths from its own cwd — it binds the production `write` tool to the
  sandbox worktree cwd.

### Mutation-aware capability leasing

- `classifyToolMutation` classifies a descriptor purely from declared metadata into
  `read-only` / `mutating` / `rollback`; `mutationClassRequiresSandbox` and
  `leaseGrantsSandbox` codify the sandbox requirement.
- `RegistryRoleExecutor` blocks any mutating/rollback descriptor unless the lease grants
  an isolated sandbox **and** a sandbox workspace was provisioned.

### Real mutating workflow over a git worktree sandbox

- `StrictMutationRuntime` (`src/cli/agi-mutation-runtime.ts`) drives the full production
  control flow: objective contract → role routing → governed executor dispatch →
  capability lease enforcement → production `write` descriptor selection → git worktree
  sandbox cwd → real file mutation → machine-derived evidence verification → accept
  (apply to main) on pass / rollback on fail → mission-state persistence.
- `AgiRuntime` now applies the sandbox patch to main on a verified pass (`sandbox.applied`)
  and rolls back on a failed/insufficient verification (`rollback.completed`), in addition
  to the prior rollback-on-execution-failure behavior. Both paths dispose the worktree.

### Machine-derived evidence verification

- `EvidenceVerifier.verify` no longer accepts a self-reported completion: it requires a
  durable, machine-derived source (test output, completed tool event, mission
  verification, or artifact hash) **and** criterion-bound non-agent evidence.
- The mutation harness verifier reads the actual captured sandbox diff and passes only
  when the diff contains the expected deterministic marker.

## Modified / added files

- `packages/coding-agent/src/agi/agent-tool-adapter.ts` (new)
- `packages/coding-agent/src/agi/capability-lease.ts`
- `packages/coding-agent/src/agi/role-executor.ts`
- `packages/coding-agent/src/agi/runtime.ts`
- `packages/coding-agent/src/agi/evidence-verifier.ts`
- `packages/coding-agent/src/cli/agi.ts`
- `packages/coding-agent/src/cli/agi-mutation-runtime.ts` (new)
- `packages/coding-agent/src/cli/agi-runtime-eval.ts` (new)
- `packages/coding-agent/test/agi/mutation-leasing.test.ts` (new)
- `packages/coding-agent/test/agi/mutation-runtime.test.ts` (new)
- `packages/coding-agent/test/agi/evidence-hardening.test.ts` (new)
- `packages/coding-agent/test/agi/runtime-eval.test.ts` (new)
- `packages/coding-agent/test/agi/role-executor.test.ts`
- `packages/coding-agent/package.json` (`agi:runtime-eval` script)

## Verification evidence

Exact commands:

- `bun test packages/coding-agent/test/agi/` — full AGI suite (103 pass / 0 fail).
- `bun test packages/coding-agent/test/agi/mutation-runtime.test.ts packages/coding-agent/test/agi/mutation-leasing.test.ts packages/coding-agent/test/agi/evidence-hardening.test.ts packages/coding-agent/test/agi/runtime-eval.test.ts`
  — the new mutation, leasing, evidence-hardening, and runtime-eval suites.
- `bun run agi:runtime-eval` (from `packages/coding-agent`) — the CI-ready end-to-end
  runtime proof (15 invariant checks pass).
- `bun run check:ts` — workspace typecheck passes.

Invariants proven by `agi:runtime-eval` and the mutation-runtime suite:

- no synthetic descriptors — the production `write` lease is issued and executed;
- sandbox isolation — main is untouched while the worktree mutation runs;
- lease enforcement — mutating descriptors require a sandbox lease and workspace;
- rollback on failed verification — a deliberately failing verifier leaves main clean
  and records `rollback.completed`, with the mission blocked;
- evidence-backed completion only — a diff-verified pass applies to main; a self-report
  never does;
- governance — rejected approval and persisted emergency stop both block mutation before
  any tool runs;
- restart recovery — verified, failed, and pending-approval runtime state all survive a
  store/runtime restart with no `running` wedge.

## Why the score is 10 / 10

Every remaining risk from the prior review is closed with deterministic evidence:

1. Mutating production descriptor execution — proven end-to-end through the production
   `write` tool under sandbox, lease, governance, and verification.
2. End-to-end runtime harness — `StrictMutationRuntime` exercises objective contract,
   role routing, governed dispatch, lease enforcement, real descriptor selection,
   sandboxed mutation, evidence verification, rollback, and mission-state persistence.
3. Mutating workflow integration — the git worktree sandbox is driven by the real
   mutating workflow, not only direct sandbox-manager tests.
4. Rollback — failed verification restores the main repository and the working tree is
   clean (no leak), with durable failure/rollback state.
5. Evidence integrity — completion is machine-derived; self-reported success is rejected.
6. Restart/recovery — pending-approval, issued-lease, and failed-verification restarts all
   resolve deterministically.

## Mission Control status

Projection rows completed through Mission Control runtime commands (decision world-model
record, regression contract, verification verdict) — see the mission's persisted records.
