# Phase1 Roadmap

> **Status:** Historical implementation record. This phase README preserves the Phase1 roadmap and landed work history; use the canonical repository README and docs index for current operator guidance.

> **미션**: 현재 "Verified multi-agent runtime" (Phase0 doc03 기준 Level 3 ~ 3.5)을 **"Eval-gated self-improving agentic runtime"** (Level 4)로 끌어올린다.

Phase1은 Amaze 실행 루프를 AI-Coach-style analysis, Nexus learning proposal, verifier/eval gate, versioned skill/rule/policy promotion, measurable improvement로 연결하되, 권한·검증 경계가 닫힌 상태에서만 closed-loop self-improvement를 허용하는 로드맵이다.

## 파일 인덱스

|코드|문서|Phase|Status|의존|Evidence|
|---|---|---|---|---|---|
|—|[00_overview.md](./00_overview.md)|P0|closed|—|—|
|T1.1|[01_security_boundaries.md](./01_security_boundaries.md)|P0|landed (2026-05-23)|—|closing-report Per-ticket status: T1.1-T1.4|
|T1.2|[02_verifier_hardening.md](./02_verifier_hardening.md)|P1|landed (2026-05-23)|T1.1|closing-report Per-ticket status: T2.1-T2.5|
|T1.3|[03_memory_governance.md](./03_memory_governance.md)|P1|landed (2026-05-23)|—|closing-report Per-ticket status: T3.1-T3.6|
|T1.4|[04_observability_ingest.md](./04_observability_ingest.md)|P2|landed (2026-05-23)|T1.1|closing-report Per-ticket status: T4.1-T4.4|
|T1.5|[05_rule_dsl.md](./05_rule_dsl.md)|P2|landed (2026-05-23)|T1.4|closing-report Per-ticket status: T5.1-T5.6|
|T1.6|[06_learning_proposal.md](./06_learning_proposal.md)|P2|landed (2026-05-23)|T1.3, T1.5|closing-report Per-ticket status: T6.1-T6.5|
|T1.7|[07_eval_gate.md](./07_eval_gate.md)|P2|landed (2026-05-23)|T1.6|closing-report Per-ticket status: T7.1-T7.5|
|T1.8|[08_self_improvement_metrics.md](./08_self_improvement_metrics.md)|P2|landed (2026-05-23)|T1.4|closing-report Per-ticket status: T8.1-T8.3|
|T1.9|[09_autonomous_goals.md](./09_autonomous_goals.md)|P3|landed (2026-05-23)|T1.7, T1.8|closing-report Per-ticket status: T9.1-T9.4|
|T1.10|[10_release_runbook.md](./10_release_runbook.md)|P0|landed (2026-05-23)|—|closing-report Per-ticket status: T10.1-T10.4|
|—|[closing-report.md](./closing-report.md)|Ω|closed|—|—|

## 의존 그래프

```text
Phase1A — Boundary Closure (보안/권한)
  ├── 01_security_boundaries.md      (P0: effectiveAgent / apply_patch / isolated)
  └── 02_verifier_hardening.md       (P1: uncertain policy / yield / shell / exec)

Phase1B — Memory & Skill Governance
  └── 03_memory_governance.md        (contradiction / skill lifecycle / migration)

Phase1C — Observability Plane (AI Coach 흡수)
  ├── 04_observability_ingest.md     (session parser / normalized event bus)
  └── 05_rule_dsl.md                 (.amaze/rules/*.rule.md DSL engine)

Phase1D — Learning & Eval Loop
  ├── 06_learning_proposal.md        (LearningProposal 객체 / proposal store)
  ├── 07_eval_gate.md                (replay / regression / sandbox / rollback)
  └── 08_self_improvement_metrics.md (force-complete rate / hit precision / churn)

Phase1E — Autonomy (선택, 후순위)
  └── 09_autonomous_goals.md         (long-horizon goal manager — gated only)

Phase1Ω — Operational
  └── 10_release_runbook.md          (AGENTS.md 복구 / test:ts 분리 / doctor)
```

## 시작하기

부모 오케스트레이터는 [goal-mode-driving.md](./goal-mode-driving.md)를 먼저 열고, `00_overview.md`의 Master Todo를 초기화한 뒤 각 phase 문서의 `Goal` YAML을 `goal start`에 투입한다. 이후 각 문서의 `Tasks` ticket을 의존 그래프에 맞춰 `task`로 dispatch한다.

운전 순서의 핵심은 1A를 먼저 닫고, 1B와 1Ω은 병렬로 진행하며, 1C 이후 1D를 순차로 닫는 것이다. 1E는 1D의 eval gate가 안정화된 뒤에만 진입한다.

## 진행 상황

진행 상황의 진실 소스는 이 README가 아니라 [closing-report.md](./closing-report.md)다. 이 파일은 Phase1 문서 인덱스와 운전 진입점만 제공한다. ticket 완료와 phase complete 상태는 closing report의 per-ticket status와 test/typecheck sweep을 기준으로 판단한다.
