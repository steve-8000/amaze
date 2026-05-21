# v2 Prompt Caching & Goal Integration

This doc captures the design of the `[STABLE_CORE, DYNAMIC_TAIL]` system prompt layout and the Goal/Design Interview integration that rides on top of it. Read this before changing any of: `system-prompt.ts`, `prompts/system/system-prompt.md`, `prompts/system/project-static.md`, `prompts/system/project-live.md`, `goals/runtime.ts`, or `ai/providers/anthropic.ts` cache control logic.

## TL;DR

- System prompt is shipped as **two ordered blocks**. The first block (STABLE_CORE) gets `cache_control` and never changes turn-to-turn. The second (DYNAMIC_TAIL) carries volatile per-turn context and stays uncached.
- The Anthropic provider honors a caller-provided `systemPromptCacheBreakpointIndex` hint and skips its default auto-placement so the dynamic tail can churn without invalidating the prefix.
- Active goal state is rendered into DYNAMIC_TAIL as a deterministic `<goal>` block. Design Interview answers (captured automatically when the `ask` tool fires against an active goal) live inside that block.
- Goal status transitions (`complete`/`dropped`) and answer key changes are included in the rebuild signature so the prompt re-renders and the cache invalidates at the right moment.
- Subagents inherit the parent goal block through `formatCompactContext`; their token usage rolls back into the parent goal via `addExternalUsage`.

## Why two blocks

The Anthropic API allows up to 4 `cache_control` breakpoints per request. Cumulative prefix caching means a single breakpoint covers everything before it; spreading breakpoints across N blocks wastes slots for no benefit. The interesting axis is therefore **content stability**, not block count.

In v1, the system prompt was one or two blocks with the breakpoint pinned to the last block. That worked when the prompt was effectively static but failed the moment any per-turn data (workspace tree, cwd, today's date, an active goal) crept in — every turn was a cache miss.

In v2 we split by volatility:

| Block | Origin | Volatility | Cache breakpoint |
| --- | --- | --- | --- |
| `STABLE_CORE` | `system-prompt.md` + `project-static.md` (workstation env, context files, harness contract, custom append prompt) | Session-invariant | `cache_control: ephemeral` (default 5m, 1h opt-in) |
| `DYNAMIC_TAIL` | `project-live.md` (agentsMd hits, workspace tree, date, cwd, goal block, future todo block) | Per-turn | Uncached |

Anything that mutates between turns lives in DYNAMIC_TAIL. The cache hit on STABLE_CORE is preserved as long as the contents of that block don't change byte-for-byte across turns — and our variable audit (see `packages/coding-agent/src/system-prompt.ts:561-602`) classifies every templated variable into one of the two tiers.

### What's in STABLE_CORE

- The identity/role preamble, RFC conventions, communication rules, tool inventory & priority lists, workflow, CONTRACT, completeness/yielding rules — i.e. all of `system-prompt.md`.
- Generic rules (`alwaysApply: true`), domain rules listing, skills list — snapshotted at session start.
- `project-static.md`: `<workstation>` env, AGENTS.md `<context>` files, `<critical>` invariants, optional `appendPrompt`.

### What's in DYNAMIC_TAIL

- `<dir-context>` agentsMd file hits (derived from workspace tree, so volatile).
- `<workspace-tree>` (mtime-sorted, reshuffles on any file write).
- `Today is …, cwd is …` line (date rolls at midnight, cwd changes on `cd`).
- `<goal>` block (changes on goal lifecycle / pivot / design answers).
- Future: `<todo>` board.

### Custom prompt path

When the caller passes `customPrompt` (i.e. `--system-prompt`), the harness deliberately collapses to a **single block** with no auto-injection — the caller asked for *exactly* their prompt. Goal/todo/workspace context is not silently merged.

## Cache breakpoint plumbing

`buildSystemPrompt` returns `{ systemPrompt: string[], systemPromptCacheBreakpointIndex?: number }`. The index is 0-based against `systemPrompt` (i.e. against the caller's array, not the final wire blocks).

The provider layer threads this through `Context.systemPromptCacheBreakpointIndex` into `buildAnthropicSystemBlocks`, which:

1. Optionally prepends OAuth-only billing header + Claude Code system instruction blocks.
2. Optionally prepends `extraInstructions` blocks.
3. Appends the caller's sanitized prompts.
4. Records the offset at which the caller's prompts began (`callerPromptOffset`).
5. Translates the caller-relative `cacheBreakpointIndex` into the absolute output index by adding `callerPromptOffset`.
6. Pre-places `cache_control` on that block.

`applyPromptCaching` then runs and, on detecting any pre-existing `cache_control` in `params.system`, **skips** its default last-block placement (per-section opt-out). The pre-existing breakpoint counts against the 4-cap so messages-level breakpoints don't push the request over.

The messages kill-switch (any pre-existing `cache_control` on `params.messages` disables all auto-placement) is preserved unchanged.

## Cache TTL economics

Anthropic pricing (1M tokens):
- Base input: $3.00
- 5m cache write: $3.75 (1.25× base)
- 1h cache write: $6.00 (2× base)
- Cache read: $0.30 (0.1× base)

For a session of length `L` with `N` turns:
- 5m TTL cost ≈ `1.25 × ceil(L / 5min) × write` + `(N - writes) × 0.1 × read`
- 1h TTL cost ≈ `2 × ceil(L / 60min) × write` + `(N - writes) × 0.1 × read`

Result: 1h wins for sessions ≥ ~5 min. 5m wins only when the session completes within 5 min. The repo defaults to "long" via `resolveCacheRetention` (with `AMAZE_CACHE_RETENTION=short` env override). Subagent fan-out is forced to long when `prompt.cache.subagentPrefixReuse` is enabled — sibling subagents share STABLE_CORE byte-for-byte so the write amortizes across many reads.

Real measured STABLE_CORE size with full tool set: ~2,176 tokens. DYNAMIC_TAIL: ~77 tokens. A 20-turn session saves ~81% on system prompt input under 1h TTL.

## Goal integration

### Lifecycle and the `<goal>` block

`renderGoalBlock(goal | null)` is the only blessed serializer. Contract:

- `null` / `undefined` / `complete` / `dropped` → emits `<goal status="none"/>`. The sentinel is constant so the prompt structure stays byte-identical across goal-active and no-goal turns (no cache thrash on lifecycle transitions).
- Active goal → emits `<goal id="…" status="…" budget="…" remaining="…">` with the objective and any captured design answers.
- Design answers are walked in **insertion order**, never sorted. The interview captures answers in a canonical order (scope, constraints, approach, acceptance) that mirrors the question sequence; sorting would scramble that semantic ordering.

`buildSystemPrompt` accepts an `activeGoal` option. `sdk.ts` reads `session.getGoalModeState()?.goal` at every rebuild and threads it through.

### Design Interview capture (one-shot)

When the model calls `ask` against an active goal that has not yet recorded `designAnswers`, the result triggers `GoalRuntime.captureDesignAnswers`. The method is one-shot — the first valid call wins, subsequent calls are no-ops. This implements "exactly one Design Interview per goal" without requiring a special-purpose tool.

Answers are keyed by question id. The system prompt instructs the model to use `scope` / `constraints` / `approach` / `acceptance` as ids in the Design Interview ask call; any caller-defined keys are accepted, though.

Telemetry: every `ask` invocation emits a `design_interview.ask` info-level log with a classification (`fired`, `already_captured`, `no_goal`, `capture_failed`). Use these to tune skip thresholds from real data.

### Pivot via `goal({op: "update"})`

Mid-goal scope changes go through `GoalRuntime.updateGoal`. The patch is a partial merge:
- `objective` revises the objective.
- `tokenBudget` revises the budget (`null` clears it, invalid values are ignored).
- `designAnswers` MERGES into existing answers; passing a key with empty-string value removes it.

The goal tool exposes this as `op: "update"`. Use this whenever the user redirects scope — do not call `complete` to "reset" a goal.

### Subagent contract propagation

`formatCompactContext` (called by `task` when handing off to a subagent) prepends a `## Parent Goal` section containing `renderGoalBlock(parentGoal)` when the parent has an active goal. Subagents do NOT inherit goal mode (no goal state on the child session, no design interview firing on the child) — they just see the parent's contract as context.

### Subagent token rollup

When a `task` invocation completes, the task tool computes the delta `input + cacheWrite + output` (excluding `cacheRead` per `goalTokenDelta` convention) from the aggregated subagent usage and calls `GoalRuntime.addExternalUsage(delta)` on the parent's goal runtime. This bumps the parent's `tokensUsed`, flips status to `budget-limited` if the threshold is crossed, and emits the standard budget-limit steer message. Without this hop, a fan-out of N subagents could burn arbitrary tokens with no impact on the parent goal's budget.

## Cache invalidation triggers

The session rebuilds the system prompt only when `#computeAppliedToolSignature` produces a value different from the last applied signature. The signature includes:

- Tool name list (order-preserving).
- Tool descriptions and labels.
- MCP discovery registry (sorted).
- MCP server instructions (sorted by server name).
- Today's date (calendar rollover invalidation).
- Active goal triple `id|status|designAnswer keys` — lifecycle transitions and answer-key additions invalidate.

Token counters (`tokensUsed`) are deliberately **excluded** from the signature: they change every turn and would thrash. The `<goal>` block renders tokens through `budget` / `remaining` attributes, which are accepted as DYNAMIC_TAIL churn.

## Observability

- **Cache hit ratio segment** (`cache_hit_ratio` in `status-line/segments.ts`): renders `cacheRead / (cacheRead + cacheWrite)` as a percentage with green ≥80%, amber ≥30%, warning < 30%. Hidden until at least one write or read has been observed.
- **Cache thrash auto-warning**: after the first observed cache write, three consecutive turns with zero `cacheRead` delta triggers a single `logger.warn` (`"Prompt cache thrash detected"`). Episode resets after any non-zero read.
- **Design Interview telemetry**: every `ask` invocation logs `design_interview.ask` with `classification` field.

## Calibration knobs

| Setting / Env | Purpose | Default |
| --- | --- | --- |
| `prompt.cache.orchestratorRetention` | Orchestrator TTL: `default` / `long` / `short` / `none` | `default` (provider-policy) |
| `prompt.cache.subagentRetention` | Subagent TTL (when prefix reuse off) | `short` |
| `prompt.cache.subagentPrefixReuse` | When true, forces subagent retention to `long` | false |
| `AMAZE_CACHE_RETENTION=short` | Global env override, restores 5m behavior | unset (= long) |

## What v2 does NOT do (deliberate)

- It does not place breakpoints on more than one system-level block. Multi-block caching with multiple breakpoints is wasted under prefix-cache semantics.
- It does not split `applyPromptCaching`'s messages kill-switch into per-message opt-out. Existing all-or-nothing contract preserved.
- It does not auto-detect mid-goal scope pivots. The user (or model on user instruction) must explicitly invoke `goal({op: "update"})`. Detecting pivots heuristically would generate false positives that quietly scramble the contract.
- It does not promote subagent retention to 1h unless `prompt.cache.subagentPrefixReuse` is set. Orphan subagent fan-out without prefix reuse pays the 1h write premium for nothing.
- It does not pre-count tokens against the budget. Goal budget tracking is post-hoc via observed usage; pre-counting against a session that may never fire is wasted work.

## Future work

- E2E dogfood with live API: verify `cache_creation_input_tokens > 0` on turn 1 and `cache_read_input_tokens > 0` on subsequent turns under a realistic agent run.
- Surface `design_interview.ask` telemetry to a dashboard so the skip clause can be tuned from data, not vibes.
- Per-block hit/miss attribution. Today we see cumulative read/write but can't tell which segment of STABLE_CORE caused a miss.
- Idle-detection that promotes 5m → 1h when inter-turn gap suggests a long-running session.
