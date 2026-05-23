# Phase 1D-07 — Eval / Safety Gate & Versioned Promotion
> **Ticket**: T1.7
> **Phase**: P2
> **Status**: landed (2026-05-23)
> **Closing**: docs/Phase1/closing-report.md

> **출처**: `docs/Phase0/03_gpt.md` §6 (Eval/Safety Layer), §7.2 (LearningProposal apply).
> **위상**: P2. Phase 06 (Learning Proposal) 완료 후.

## Goal

```yaml
title: Approved proposals only become active after replay + regression + safety checks; every apply is versioned and reversible
why: |
  Proposal staging만으로는 self-contamination을 막을 수 없다.
  approved → applied 전환에는 결정형 eval (session replay, regression test, contradiction check, provenance)가 필요하고,
  apply는 versioned, rollback 가능해야 한다.
scope:
  include:
    - packages/coding-agent/src/learning/eval/**
    - packages/coding-agent/src/learning/apply/**
    - packages/coding-agent/src/learning/replay/**
    - packages/coding-agent/src/cli/proposals.ts   # apply / rollback 서브커맨드
```

## 게이트 정의

```text
Proposal (status=approved)
  ├─► Eval Gate
  │     ├─ replay recent N sessions on proposal-applied snapshot
  │     ├─ regression: bun run check:ts + targeted test suites
  │     ├─ contradiction: 새 memory/skill이 기존 active memory와 충돌 없음
  │     └─ provenance: evidence.sampleN >= type별 임계값
  ├─► Apply (versioned)
  │     ├─ snapshot 현재 state (memory/skill/settings/rule)
  │     ├─ create promotion record (proposal_id, version, prev_snapshot_ref, applied_at)
  │     └─ status = applied
  └─► Rollback path
        ├─ amaze proposals rollback <id>
        └─ snapshot 복원 → status = rolled-back
```

## Acceptance Criteria

```yaml
- id: replay-engine
  check: {type: command-exit, argv: [bun,test,packages/coding-agent/tests/learning/replay.test.ts], expected: 0}
- id: eval-pipeline-determinism
  check: {type: command-exit, argv: [bun,test,packages/coding-agent/tests/learning/eval-pipeline.test.ts], expected: 0}
- id: versioned-apply-rollback
  check: {type: command-exit, argv: [bun,test,packages/coding-agent/tests/learning/apply-rollback.test.ts], expected: 0}
- id: contradiction-check
  check: {type: command-exit, argv: [bun,test,packages/coding-agent/tests/learning/contradiction-gate.test.ts], expected: 0}
- id: provenance-min-evidence
  check: {type: command-exit, argv: [bun,test,packages/coding-agent/tests/learning/provenance-gate.test.ts], expected: 0}
- id: apply-cli
  check: {type: command-exit, argv: [bun,test,packages/coding-agent/tests/cli/proposals-apply.test.ts], expected: 0}
```

## Tasks

### T7.1 — Session replay engine

```json
{
  "id": "ReplayEngine",
  "description": "JSONL session events를 deterministic 모드로 replay (LLM call 금지, recorded tool I/O 사용)",
  "assignment": "learning/replay/index.ts: replaySession(sessionId, opts) -> ReplayReport. recorded events에서 turn.start/tool.call/tool.result 재구성, deterministic verifier+memory만 다시 평가. proposal apply 가상 적용 후 (memory가 다른 상태일 때 어떤 결정이 다르게 났을지) -> diffSummary. 신규 테스트 learning/replay.test.ts: fixture session JSONL에 대해 baseline replay 결과 + memory patch 적용 후 결과 diff. LLM call 또는 외부 네트워크 호출이 한 번도 발생하지 않음 (네트워크 fake로 검증).",
  "contract": {
    "role": "replay-engine",
    "scope":{"include":["packages/coding-agent/src/learning/replay/**","packages/coding-agent/tests/learning/replay.test.ts"],"exclude":[]},
    "inputArtifact":"docs/Phase1/07_eval_gate.md",
    "outputContract":{"mustProduce":["replay engine","report","test"]},
    "successCriteria":[
      {"id":"replay-test","check":{"type":"command-exit","argv":["bun","test","packages/coding-agent/tests/learning/replay.test.ts"],"expected":0}}
    ],
    "escalation":{"onUncertainty":"ask-parent","budgetCap":300000}
  }
}
```

### T7.2 — Eval pipeline

```json
{
  "id": "EvalPipeline",
  "description": "evaluateProposal(proposal) -> EvalReport with deterministic checks",
  "assignment": "learning/eval/pipeline.ts: 단계별 단축 평가, 첫 실패면 stop. 단계: (1) provenance (sampleN, evidence 충분), (2) contradiction (memory/skill만; 새 항목 vs 기존 active와 lexical+embedding gate), (3) replay top-N session (default N=20 from --since 7d), pass-rate가 baseline 대비 -5%p 이내, (4) regression (proposal type별 target test suite 실행). EvalReport = {passed:bool, stage, signals:{...}, durationMs}. 동일 입력에 대해 결정형 (랜덤 seed 명시). 신규 테스트: 각 stage fail/pass 케이스 + 결정형 (같은 입력 두 번 → 같은 report).",
  "contract": {
    "role": "eval-pipeline",
    "scope":{"include":["packages/coding-agent/src/learning/eval/**","packages/coding-agent/tests/learning/eval-pipeline.test.ts"],"exclude":[]},
    "inputArtifact":"docs/Phase1/07_eval_gate.md",
    "outputContract":{"mustProduce":["pipeline","report","test"]},
    "successCriteria":[
      {"id":"eval-test","check":{"type":"command-exit","argv":["bun","test","packages/coding-agent/tests/learning/eval-pipeline.test.ts"],"expected":0}}
    ],
    "escalation":{"onUncertainty":"ask-parent","budgetCap":300000}
  }
}
```

### T7.3 — Contradiction gate

```json
{
  "id": "ContradictionGate",
  "description": "proposal payload가 기존 active state와 contradiction 시 fail",
  "assignment": "learning/eval/contradiction.ts: memory proposal 은 NexusStore의 lexicalContradictionSignal+embedding으로 기존 active와 비교. skill proposal은 동일 name의 active skill 본문과 비교. rule proposal은 동일 id 충돌만 검사. settings proposal은 rollback patch 부재 시 reject. 신규 테스트.",
  "contract": {
    "role": "contradiction-gate",
    "scope":{"include":["packages/coding-agent/src/learning/eval/contradiction.ts","packages/coding-agent/tests/learning/contradiction-gate.test.ts"],"exclude":[]},
    "inputArtifact":"docs/Phase1/07_eval_gate.md",
    "outputContract":{"mustProduce":["gate","test"]},
    "successCriteria":[
      {"id":"con-test","check":{"type":"command-exit","argv":["bun","test","packages/coding-agent/tests/learning/contradiction-gate.test.ts"],"expected":0}}
    ],
    "escalation":{"onUncertainty":"ask-parent","budgetCap":180000}
  }
}
```

### T7.4 — Provenance gate

```json
{
  "id": "ProvenanceGate",
  "description": "sampleN, distinct session 수, hypothesis 금지 등 type별 최소 증거 요구",
  "assignment": "learning/eval/provenance.ts. 기본값: memory tool_verified sampleN>=1, memory inferred sampleN>=3 + distinct sessions>=2, memory hypothesis reject (manual 승인 필요), skill sourceMemoryIds>=2, rule replaySessions>=5, settings provenance.source='manual'만 허용. settings 'learning.provenance.minSamples' 오버라이드. 신규 테스트.",
  "contract": {
    "role": "provenance-gate",
    "scope":{"include":["packages/coding-agent/src/learning/eval/provenance.ts","packages/coding-agent/src/settings/**","packages/coding-agent/tests/learning/provenance-gate.test.ts"],"exclude":[]},
    "inputArtifact":"docs/Phase1/07_eval_gate.md",
    "outputContract":{"mustProduce":["gate","setting","test"]},
    "successCriteria":[
      {"id":"prov-test","check":{"type":"command-exit","argv":["bun","test","packages/coding-agent/tests/learning/provenance-gate.test.ts"],"expected":0}}
    ],
    "escalation":{"onUncertainty":"ask-parent","budgetCap":150000}
  }
}
```

### T7.5 — Versioned apply & rollback

```json
{
  "id": "VersionedApplyRollback",
  "description": "snapshot → apply → promotion record. amaze proposals rollback 으로 역연산",
  "assignment": "learning/apply/index.ts: applyProposal(id) -> {version, snapshotRef}. snapshot은 type별 minimal subset만 캡처: memory→memory_items rows for affected, skill→affected skill row + .amaze/skills file, rule→.amaze/rules file, settings→.amaze/settings.json. snapshot은 nexus-learning.db 의 promotion_snapshots(version, type, ref, blob) 에 저장. apply는 transactional (DB tx + filesystem 변경은 .tmp → rename). rollback은 promotion 역순. cli/proposals.ts에 apply <id> / rollback <id> 추가. 신규 테스트 apply-rollback.test.ts: settings type proposal apply 후 .amaze/settings.json 변경, rollback 후 원복; skill type도 동일.",
  "contract": {
    "role": "versioned-apply",
    "scope":{"include":["packages/coding-agent/src/learning/apply/**","packages/coding-agent/src/cli/proposals.ts","packages/coding-agent/tests/learning/apply-rollback.test.ts","packages/coding-agent/tests/cli/proposals-apply.test.ts"],"exclude":[]},
    "inputArtifact":"docs/Phase1/07_eval_gate.md",
    "outputContract":{"mustProduce":["apply","rollback","cli","tests"]},
    "successCriteria":[
      {"id":"apply-test","check":{"type":"command-exit","argv":["bun","test","packages/coding-agent/tests/learning/apply-rollback.test.ts"],"expected":0}},
      {"id":"apply-cli-test","check":{"type":"command-exit","argv":["bun","test","packages/coding-agent/tests/cli/proposals-apply.test.ts"],"expected":0}}
    ],
    "escalation":{"onUncertainty":"ask-parent","budgetCap":350000}
  }
}
```

## 병렬화

T7.1 / T7.3 / T7.4 병렬. T7.2 는 T7.1 결과 사용 → T7.2 는 T7.1 머지 후. T7.5 는 T7.2/T7.3/T7.4 머지 후 (eval gate 통과 후 apply).

## 종료 조건

- `amaze proposals apply <id>` 호출 시 evalPipeline pass → snapshot → applied 전환
- 모든 apply 가 동일 input 으로 rollback 가능 (테스트로 검증)
- Phase 1B-03 T3.2 의 `amaze skill validate/promote` CLI 가 본 eval gate 를 invoke 하도록 통합
