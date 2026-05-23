# Phase1 Closing Report

## Summary

Phase1 tickets 46/46 implemented across 1A/1B/1C/1D/1E/1Ω; 1회차 integration sweep completed; final `bun run check:ts` status: FAIL (exit 1, 22 errors; Class A=0, B/C=22).

## Typecheck

- Command: `bun run check:ts`
- Exit code: 1
- Error count: 22 errors (`check:tools` stopped before workspace checks), plus 7 warnings and 2 infos.
- Full capture: `artifact://341`
- Expanded diagnostic capture: `artifact://343`

### Baseline comparison

Baseline `docs/Phase1/integration-typecheck-report.md` recorded 32 errors: Class A=8, Class B=24, Class C=0. The prior Class A set was limited to Phase1-modified `packages/coding-agent/src/tools/*` import ordering. Current run shows no diagnostics in that prior A file set, so Class A is considered gone.

Current classification under the same rule:

| Class | Count | Notes |
|---|---:|---|
| A | 0 | No remaining diagnostics in the prior Phase1 A path set (`packages/coding-agent/src/tools/code-callees.ts`, `code-callers.ts`, `code-def.ts`, `code-refs.ts`, `index.ts`, `nexus-memory-explain.ts`, `repo-search.ts`, `session-search.ts`). |
| B/C | 22 | Remaining errors are outside that prior A set or pre-existing external cleanup areas. |

Current error files from expanded diagnostics:

- `packages/agent/src/compaction/compaction.ts` — organize-imports blank-line error.
- `packages/agent/test/compaction-reasoning.test.ts` — import name ordering.
- `packages/coding-agent/scripts/nexus-behavioral-ab.ts` — import ordering and `forEach` callback return.
- `packages/coding-agent/scripts/nexus-cold-quantitative.ts` — `forEach` callback return.
- `packages/coding-agent/src/modes/acp/acp-agent.ts` — import ordering.
- `packages/coding-agent/src/modes/components/settings-defs.ts` — unused `Settings` import.
- `packages/coding-agent/src/modes/controllers/input-controller.ts` — import ordering.
- `packages/coding-agent/src/modes/interactive-mode.ts` — import name ordering.
- `packages/coding-agent/src/nexus/commands.ts` — import ordering.
- `packages/coding-agent/src/nexus/doctor.ts` — import ordering.
- `packages/coding-agent/src/nexus/index.ts` — export ordering.
- `packages/coding-agent/src/nexus/knowledge/migration.ts` — import ordering.
- `packages/coding-agent/src/nexus/knowledge/store.ts` — import ordering and assignment-in-expression errors.
- `packages/coding-agent/src/slash-commands/builtin-registry.ts` — import ordering.
- `packages/coding-agent/test/nexus-agi-features.test.ts` — import ordering and unused `NexusEmbeddingClient` import.
- `packages/coding-agent/test/nexus-knowledge-db-migration.test.ts` — import ordering.
- `packages/coding-agent/test/nexus-knowledge.test.ts` — import ordering.
- `packages/coding-agent/test/session-manager/build-context.test.ts` — import ordering.

## Test sweep

Aggregate command:

```sh
bun --cwd packages/coding-agent test test/subagent test/edit test/task test/goals test/tools test/nexus test/memory-backend test/observability test/rules test/cli test/learning test/metrics test/autonomy
```

Aggregate result: exit 1; 1248 pass, 38 fail, 302 skip, 3 errors, 3671 assertions, 1588 tests across 178 files. Full capture: `artifact://345`.

Per-directory sweep:

| Directory | Exit | Pass | Fail | Skip | Total run | Failure summary |
|---|---:|---:|---:|---:|---:|---|
| `test/subagent` | 1 | 54 | 1 | 0 | 55 | `scope-guard.test.ts`: no-contract WriteTool backward-compat test now hits mutation-scope outside-cwd rejection. |
| `test/edit` | 0 | 50 | 0 | 0 | 50 | None. |
| `test/task` | 1 | 18 | 11 | 0 | 29 | Missing exports from `task/executor.ts` (`SUBAGENT_WARNING_MISSING_YIELD`, `resolveSubprocessToolNames`, `finalizeSubprocessOutput`); wall-clock timeout/context-token assertions fail; worktree isolation backend mapping/retry/merge/patch assertions fail. |
| `test/goals` | 1 | 117 | 13 | 0 | 130 | Legacy shell-form command criteria now fail with `shell criteria disabled by policy`; several goal runtime tests fail before acceptance with `Settings not initialized`. |
| `test/tools` | 1 | 802 | 9 | 298 | 1109 | Write/search/sqlite tests using absolute temp paths now hit mutation-scope outside-cwd rejection; legacy YieldTool bypass tests now fail because schema bypass default is locked off. |
| `test/nexus` | 1 | 80 | 3 | 4 | 87 | Conceptual abstraction repeats on second pipeline run; self-healing contradiction count is 0; artifact rendering no longer creates skill dirs for unvalidated skills. |
| `test/memory-backend` | 0 | 5 | 0 | 0 | 5 | None. |
| `test/observability` | 0 | 6 | 0 | 0 | 6 | None. |
| `test/rules` | 0 | 16 | 0 | 0 | 16 | None. |
| `test/cli` | 0 | 42 | 0 | 0 | 42 | None in isolated per-directory run; aggregate run also surfaced `test/cli/memory-doctor.test.ts` failure from overlapping `test/nexus` top-level selection. |
| `test/learning` | 0 | 36 | 0 | 0 | 36 | None. |
| `test/metrics` | 0 | 12 | 0 | 0 | 12 | None. |
| `test/autonomy` | 0 | 11 | 0 | 0 | 11 | None. |

Notable aggregate-only failures also included `test/cli/memory-doctor.test.ts` expecting `- session-reindex: ok` but receiving an ENOENT path containing `sessions\0`; this appeared in the broad command output even though the isolated `test/cli` directory run passed.

## Per-ticket status

| Phase | Ticket | Status | Acceptance-linked tests / checks |
|---|---|---|---|
| 1A Boundary | T1.1 Wire `effectiveAgent` into subprocess options | done | `packages/coding-agent/test/task/plan-mode-agent.test.ts` |
| 1A Boundary | T1.2 apply_patch & rename destination scope guard | done | `packages/coding-agent/test/tools/apply-patch-scope.test.ts`, `packages/coding-agent/test/tools/rename-scope.test.ts` |
| 1A Boundary | T1.3 Unified canonical mutation scope guard | done | `packages/coding-agent/test/tools/mutation-scope.test.ts`, `packages/coding-agent/test/tools/` |
| 1A Boundary | T1.4 Isolated task verifier loop | done | `packages/coding-agent/test/task/isolated-verifier-loop.test.ts` |
| 1A Verifier | T2.1 `uncertainPolicy` + blocking field | done | `packages/coding-agent/test/verifier/uncertain-policy.test.ts` |
| 1A Verifier | T2.2 Yield schema bypass default off | done | `packages/coding-agent/test/yield/schema-bypass.test.ts` |
| 1A Verifier | T2.3 Command criteria argv default, shell gated | done | `packages/coding-agent/test/verifier/command-criteria.test.ts` |
| 1A Verifier | T2.4 `exec` alias capability split | done | `packages/coding-agent/test/runtime/exec-alias.test.ts` |
| 1A Verifier | T2.5 changedFiles attribution via dirty hash snapshot | done | `packages/coding-agent/test/subagent/changed-files-attribution.test.ts` |
| 1B Memory | T3.1 Lexical-aware contradiction signal | done | `packages/coding-agent/test/nexus/contradiction.test.ts` |
| 1B Memory | T3.2 Skill lifecycle states + auto-promote ceiling | done | `packages/coding-agent/test/nexus/skill-lifecycle.test.ts`, `packages/coding-agent/test/cli/skill-cmd.test.ts` |
| 1B Memory | T3.3 Legacy migration clarity | done | `docs/memory.md` grep, `packages/coding-agent/test/cli/memory-migrate.test.ts` |
| 1B Memory | T3.4 Static memory summary fenced | done | static-memory fence/sanitizer test under memory/session prompt coverage |
| 1B Memory | T3.5 Session index hash + trigram backfill robustness | done | nexus/session search robustness tests |
| 1B Memory | T3.6 Startup degraded surfaced in doctor | done | `packages/coding-agent/test/cli/memory-doctor.test.ts` |
| 1C Observability | T4.1 Schema + bus | done | `packages/coding-agent/test/observability/event-bus.test.ts` |
| 1C Observability | T4.2 Forwarding from existing emitters | done | `packages/coding-agent/test/observability/forwarding-coverage.test.ts` |
| 1C Observability | T4.3 JSONL persistent sink | done | `packages/coding-agent/test/observability/jsonl-sink.test.ts` |
| 1C Observability | T4.4 CLI | done | `packages/coding-agent/test/cli/observe.test.ts` |
| 1C Rules | T5.1 Markdown frontmatter + detect parser | done | `packages/coding-agent/test/rules/parser.test.ts` |
| 1C Rules | T5.2 Safe expression evaluator | done | `packages/coding-agent/test/rules/expr.test.ts` |
| 1C Rules | T5.3 Rule evaluator over SessionEvent stream | done | `packages/coding-agent/test/rules/evaluator.test.ts` |
| 1C Rules | T5.4 Loader + trust gate | done | `packages/coding-agent/test/rules/loader-trust.test.ts` |
| 1C Rules | T5.5 Builtin rule set | done | builtin rule parser/evaluator coverage in `packages/coding-agent/test/rules/` |
| 1C Rules | T5.6 CLI `amaze rules` | done | `packages/coding-agent/test/cli/rules.test.ts` |
| 1D Learning | T6.1 Proposal store | done | `packages/coding-agent/test/learning/store.test.ts` |
| 1D Learning | T6.2 Nexus writes routed through proposals | done | `packages/coding-agent/test/learning/nexus-routing.test.ts` |
| 1D Learning | T6.3 Rule finding to proposal | done | `packages/coding-agent/test/learning/from-rule.test.ts` |
| 1D Learning | T6.4 Gate defaults and policy | done | `packages/coding-agent/test/learning/gates.test.ts` |
| 1D Learning | T6.5 CLI `amaze proposals` | done | `packages/coding-agent/test/cli/proposals.test.ts` |
| 1D Eval | T7.1 Session replay engine | done | `packages/coding-agent/test/learning/replay.test.ts` |
| 1D Eval | T7.2 Eval pipeline | done | `packages/coding-agent/test/learning/eval-pipeline.test.ts` |
| 1D Eval | T7.3 Contradiction gate | done | `packages/coding-agent/test/learning/contradiction-gate.test.ts` |
| 1D Eval | T7.4 Provenance gate | done | `packages/coding-agent/test/learning/provenance-gate.test.ts` |
| 1D Eval | T7.5 Versioned apply & rollback | done | `packages/coding-agent/test/learning/apply-rollback.test.ts` |
| 1D Metrics | T8.1 Metric engine | done | `packages/coding-agent/test/metrics/engine.test.ts` |
| 1D Metrics | T8.2 Metric definitions | done | `packages/coding-agent/test/metrics/definitions.test.ts` |
| 1D Metrics | T8.3 CLI & doctor surface | done | `packages/coding-agent/test/cli/metrics.test.ts` |
| 1E Autonomy | T9.1 Objective store & feature flag | done | `packages/coding-agent/test/autonomy/store.test.ts`, `packages/coding-agent/test/autonomy/feature-flag.test.ts` |
| 1E Autonomy | T9.2 Metric to sub-goal proposal | done | `packages/coding-agent/test/autonomy/subgoal-proposal.test.ts` |
| 1E Autonomy | T9.3 Rate limiter & budget | done | `packages/coding-agent/test/autonomy/rate-limit.test.ts` |
| 1E Autonomy | T9.4 CLI | done | `packages/coding-agent/test/cli/objective.test.ts` |
| 1Ω Ops | T10.1 AGENTS.md 복구 | done | `AGENTS.md` section checks |
| 1Ω Ops | T10.2 test scripts 분리 | done | `package.json` script-key check |
| 1Ω Ops | T10.3 Phase1 driving docs | done | `docs/Phase1/README.md`, `docs/Phase1/goal-mode-driving.md` |
| 1Ω Ops | T10.4 `amaze doctor` 통합 | done | `packages/coding-agent/test/cli/doctor.test.ts` |

## Exit criteria checklist

- [x] Phase1 ticket implementation sweep recorded in `## Per-ticket status`.
- [x] Typecheck sweep recorded in `## Typecheck`.
- [x] Test sweep recorded in `## Test sweep`.
- [ ] One-week dogfood improvement evidence remains pending; see `## Next steps`.

## Open follow-ups

- `prompt-cache.cache` event는 현재 prompt-cache-policy 쪽에서 read/write token detail을 넓게 노출하지 않아 완전 구현되지 않았다.
- Autonomy는 기본 OFF (`autonomy.enabled=false`)이며, objective loop는 명시 enable 전에는 no-op이어야 한다.
- `docs/Phase1/recon-1a-1b.md`의 초기 기대 경로와 실제 경로가 다르다. 예: edit variants는 `packages/coding-agent/src/tools/edit/`가 아니라 `packages/coding-agent/src/edit/index.ts`에 있고, write tool은 `packages/coding-agent/src/tools/write.ts`에 있다.
- Shell-form verifier criteria는 policy opt-in 뒤에 있으며, 기존 `command: "..."` 기반 테스트/계약은 argv-form으로 이행해야 한다.
- Yield schema bypass는 기본 차단이다. 기존 “두 번째 실패부터 degrade” 동작을 기대하는 테스트는 opt-in 설정 없이는 실패한다.
- Skill auto-promotion은 active artifact 생성까지 가지 않고 eval/review gate에 머문다. 따라서 오래된 Nexus artifact 렌더링 테스트는 validated/active status를 명시해야 한다.
- Mutation scope guard는 canonical cwd 기준으로 절대 temp path를 거부한다. 기존 no-contract/backward-compat 테스트 중 cwd를 temp root로 맞추지 않은 케이스는 실패한다.

## Next steps

`docs/Phase1/00_overview.md` §5 종료 조건 대비, 코드 경로는 대부분 닫혔지만 마지막 체크박스인 “1주 실측 데이터에서 force-complete rate 감소 또는 goal completion pass rate 증가 입증”은 아직 관찰 데이터가 필요하다. 이제 observability JSONL, rule DSL, learning proposal/eval gate, metrics CLI, autonomy OFF-by-default objective surface가 붙었으므로 dogfood에서 실측 가능하다.

1주 dogfood 계획:

1. 매일 실제 개발 세션의 observability JSONL을 보존하고 `amaze metrics show --window 7d --json`으로 `forceCompleteRate`, `goalCompletionPassRate`, `revisionLoopSuccessRate`, `memoryHitPrecision`을 기록한다.
2. Builtin rules 중 `force-complete-rate`, `verifier-bypass-rate`, `memory-low-precision` findings를 proposal store로 흘려보내되 apply는 human gate로 유지한다.
3. 3일차에 baseline 대비 실패 사유를 분류한다: contract/test fixture drift, settings init 누락, shell criteria migration, mutation scope cwd mismatch.
4. 7일차에 force-complete rate 감소 또는 goal completion pass rate 증가 중 하나를 서비스 지표로 입증한 뒤 Phase1 종료 판정을 다시 실행한다.
