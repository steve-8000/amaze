# V3 Coordination Layer — Measurement & Prune Thresholds

This doc is the **honest** companion to `v2-prompt-caching.md`. The v3 coordination layer (SubagentContract, Closing Audit, Verifier extensions, LLM judge, Auto revision loop) was shipped on architectural confidence — not on usage data. Until usage data arrives, every primitive in v3 is a **bet**.

This document defines:
1. What we measure (the telemetry surface that's now wired in)
2. The thresholds that decide **keep / fix / prune** for each feature
3. The protocol for ending measure mode and either committing or rolling back

Read this **before** writing any new v3 code.

---

## What gets measured

A live amaze session aggregates V3 events via `AgentSession.v3Telemetry` (singleton per session). The aggregator is read-only via:

```ts
session.v3Telemetry.getStats()           // structured V3Stats
session.formatV3TelemetrySummary()       // human-readable summary
session.v3Telemetry.getForceRate()       // derived: forced / total completions
session.v3Telemetry.getInterviewFireRate() // derived: fired / (fired + already_captured)
```

Events recorded today (instrumentation already wired into production code paths):

| Source | Event | Method |
| --- | --- | --- |
| `ask` tool | every invocation | `recordDesignInterviewCall(classification)` |
| `goal({op:"complete"})` | every completion (pass / fail / force) | `recordClosingAudit(outcome)` |
| `goal({op:"complete"})` | per criterion | `recordVerifierResult(checkType, status)` |
| `task` tool | every subagent spawn (with/without contract) | `recordSubagentSpawn(withContract)` |

Events **not yet** instrumented (deliberate — keep surface tight):

- LLM judge invocations (will be added when `ProductionLlmJudgeRunner` is wired to a real `chat`)
- Auto revision-loop iterations (will be added when `executeContractedTask` is observed in prod)
- Per-block cache hit ratio (currently aggregate via `cache_hit_ratio` segment)

---

## User-facing V3 mechanics

V3 is not only telemetry. The shipped runtime exposes three user-visible coordination surfaces:

1. **Goal lifecycle** through the hidden `goal` tool:
   - `create` starts an objective and optional token budget.
   - `get` returns the current goal.
   - `update` patches objective, token budget, design answers, or structured `acceptance_criteria`.
   - `complete` runs the closing audit. `force: true` skips the audit and is counted as a forced completion.
2. **Design Interview capture** through `ask`: the first qualifying ask call for an active goal stores answers such as `scope`, `constraints`, `approach`, and `acceptance` on the goal. The active goal block is then rendered into the dynamic prompt tail on every rebuild.
3. **Subagent contracts** through `task({ tasks: [{ contract }] })`: contracted subagents receive a rendered contract, have edit/write scope guarded, and are verified against success criteria on completion. Failed criteria trigger one bounded revision attempt in the non-isolated path.

Structured goal and subagent criteria share the same check families:

| Check | Behavior |
| --- | --- |
| `scope-include` / `scope-exclude` | Checks changed-file paths against required or forbidden glob sets. |
| `file-exists` | Requires a path to exist. |
| `command-exit` | Runs a command and compares exit code. |
| `command-output` | Runs a command and checks exit code/stdout/stderr patterns plus forbidden output patterns. |
| `lsp-clean` | Uses LSP diagnostics where a provider is available; otherwise reports uncertain. |
| `llm-judged` | Reserved for model judgement; reports uncertain until a production judge is wired. |
| `manual` | Always uncertain; it surfaces a human decision point and does not itself fail the audit. |

A failed deterministic criterion blocks `goal({ op: "complete" })` unless completion is forced. Uncertain criteria are surfaced in the completion report so the operator can replace them with deterministic checks or force completion deliberately.


## Thresholds — when to keep, fix, or prune

The numbers below assume **≥ 5 real coding sessions** of varied length (≥ 30 minutes each). With fewer sessions, every conclusion is statistical noise — wait.

### Subagent Contract (`task({contract: ...})`)

**Metric**: `stats.subagent.withContract / stats.subagent.totalSpawned`

| Adoption rate | Verdict | Action |
| --- | --- | --- |
| ≥ 30% | **Keep + invest** | Contract layer is earning its keep. Consider tightening prompt instructions to push toward 50%. |
| 5–29% | **Keep + observe** | Borderline. Identify which roles/tasks use contracts vs not — there may be a natural split where contracts only fit certain delegation patterns. |
| 1–4% | **Fix or prune** | Model rarely chooses to use contracts even when guidance is present. Either (a) make contracts MUCH easier to author (template defaults, fewer required fields), or (b) prune the Tool-A/B/C wiring and keep only the verifier piece. |
| < 1% | **Prune.** | Delete `task` schema's `contract` field, `subagent/contract.ts`, `subagent/task-revision-loop.ts`, `Phase 2.1/2.2/3` instrumentation. Saves ~1500 LoC + cognitive overhead. |

### Closing Audit (`goal({op:"complete"})` verifier)

**Metric A**: `force-rate = stats.closingAudit.forced / stats.closingAudit.totalCompletions`

| Force rate | Verdict | Action |
| --- | --- | --- |
| < 10% | **Calibrated well** | Closing audit catches real issues and isn't over-eager. |
| 10–30% | **Calibrated mid** | Some friction. Review which criteria types drive forces — likely `manual` or overly strict `command-output` patterns. |
| 30–60% | **Mis-calibrated**. | Criteria are too strict in practice. Default to looser criteria OR allow per-criterion `force` instead of all-or-nothing. |
| ≥ 60% | **Verifier is dead weight**. | If most completions need force, closing audit IS the obstacle, not a guard. Consider making it opt-in via setting, or remove. |

**Metric B**: completions with criteria vs without — `stats.closingAudit.totalCompletions` vs goals that completed without `acceptanceCriteria` set (not currently tracked but can be derived).

If ≥ 80% of goals complete without ever setting `acceptanceCriteria`, the closing audit feature is theoretical only. Either teach the model harder OR remove.

### Design Interview

**Metric**: `getInterviewFireRate()` and `byClassification.no_goal` count

| Pattern | Verdict | Action |
| --- | --- | --- |
| Fire rate ≥ 70% on non-`no_goal` calls | **Working as intended** | Model correctly identifies goal entries. |
| Fire rate 30–70% | **Skip clause noisy** | Tune the skip heuristic — likely the "single-file <30 LoC" rule is interpreted too liberally. Make it concrete (line count threshold, explicit file count). |
| Fire rate < 30% | **Skip is the default** | Either drop the interview entirely OR make it explicit (require user to type `/interview` to trigger). The current "MUST" wording isn't being honored. |
| no_goal calls ≫ goal calls | **`ask` tool used for clarification, not interview** | Fine. The telemetry just confirms the surface is dual-purpose. |

### Verifier criterion types (per check-type)

**Metric**: `stats.verifier.criterionResults[kind].pass / fail / uncertain`

For each check kind:

| Kind | Keep if | Prune if |
| --- | --- | --- |
| `scope-include`/`scope-exclude` | Used + catches violations | Always `uncertain` (zero `changedFiles` always) — caller isn't supplying diff context, fix that |
| `file-exists` | Used + sometimes fails | Used but always passes — vacuous criterion, nothing to verify |
| `command-exit` | Used | Same |
| `command-output` | Used + uncertainCount low | Always `fail` due to flaky commands — switch to artifact-based checks |
| `lsp-clean` | LSP provider wired AND used | Always `uncertain` (no provider configured) — disable until LSP integration ships |
| `llm-judged` | `chat` wired AND used | Always `uncertain` (NULL runner) — remove from criterion schema until ready |
| `manual` | Used sparingly | Used everywhere — operator is using this as an escape hatch, fix the deterministic backends |

### Cache health (orthogonal but related)

**Metric**: `cache_hit_ratio` status-line segment value over rolling 10 turns

| Ratio | Verdict | Action |
| --- | --- | --- |
| ≥ 80% | v2 cache layout working | No action |
| 30–79% | Cache thrash mid-tier | Investigate which block is invalidating — see `cache thrash` warning |
| < 30% | v2 layout broken | STABLE_CORE is changing mid-session; revisit variable audit (P0.1 from v2) |

---

## Protocol for ending measure mode

Measure mode ends when **one** of:

1. **Hard prune trigger**: Any feature hits a "Prune" verdict above on ≥ 5 sessions of real use. Action: open a PR removing the feature, link this doc and the telemetry data.

2. **Confidence vote**: Adoption rates exceed "Keep + invest" thresholds across the top 3 features (Subagent Contract, Closing Audit, Design Interview). Action: graduate from measure mode; commit to ongoing investment.

3. **Time bound**: 3 weeks of real use without enough data to decide. Action: features still in `< 1%` get pruned regardless. "Insufficient evidence" is a prune verdict, not a hold.

### What measure mode forbids

- Writing **any** new v3 feature code
- Adding new telemetry surfaces (the four current sources cover all primitive types)
- Tuning prompt instructions for v3 (drift the data; calibrate later)
- Building dashboards or UI on top of telemetry beyond the existing `formatV3TelemetrySummary`

### What measure mode allows

- Bug fixes if a v3 primitive throws / crashes
- Documentation improvements (this file)
- Reading the telemetry, drawing conclusions
- Removing v3 features when data indicates

---

## Why this document exists

v3 was built on conviction. Conviction without measurement is religion, not engineering. This doc is the protocol to convert v3 from religion to evidence — or to honestly admit that some of v3 was built for a future that hasn't arrived and roll it back without ego.

The hardest engineering decisions are about **what to remove**. Measure mode is the discipline that makes those decisions possible.
