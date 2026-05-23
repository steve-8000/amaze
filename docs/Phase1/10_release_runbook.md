# Phase 1Ω-10 — Operational Runbook (P0 immediate / cross-cutting)

> **출처**: `docs/Phase0/01_gpt.md` §"가장 먼저 고칠 순서" P0~P2.
> **위상**: P0 (AGENTS.md, test:ts split). 다른 모든 phase 와 병렬 가능. 시작 즉시 진입 권장.

## Goal

```yaml
title: Close the operational hygiene gaps and document the goal-mode driving procedure
why: |
  AGENTS.md가 비어 있다 (agent-native repo에서 회귀).
  test:ts가 --only-failures라 CI에서 전체 회귀를 못 잡는다.
  startup degraded를 사용자가 알 수 없다.
  goal-mode로 Phase1을 어떻게 운전하는지의 README가 없다.
scope:
  include:
    - AGENTS.md
    - package.json
    - .github/workflows/**
    - docs/Phase1/README.md
    - docs/Phase1/goal-mode-driving.md
```

## Acceptance Criteria

```yaml
- id: agents-md-nonempty
  check: {type: command-output, argv: [wc, -c, AGENTS.md], stdoutPattern: "^[ ]*[1-9][0-9]{2,}"}  # ≥ 100 bytes
- id: agents-md-required-sections
  check: {type: command-exit, argv: [bash, -c, "grep -q '^## Mission' AGENTS.md && grep -q '^## Required verification' AGENTS.md && grep -q '^## Local commands' AGENTS.md"], expected: 0, shell: true}
- id: test-script-split
  check: {type: command-output, argv: [bash, -c, "jq -r '.scripts | keys[]' package.json"], stdoutPattern: "test:ts:failed", shell: true}
- id: ci-uses-full-test
  check: {type: command-output, argv: [bash, -c, "grep -R 'test:ts:failed\\|run test:ts' .github/workflows || true"], stdoutPattern: "test:ts", shell: true}
- id: phase1-readme
  check: {type: file-exists, path: docs/Phase1/README.md}
- id: goal-mode-driving-doc
  check: {type: file-exists, path: docs/Phase1/goal-mode-driving.md}
```

> 주의: `shell: true` criteria 는 Phase 1A-02 T2.3 (`verifier.allowShellCriteria` opt-in) 머지 전에는 그대로 실행 가능. 머지 후엔 argv-form 으로 교체 필요.

## Tasks

### T10.1 — AGENTS.md 복구

```json
{
  "id": "RestoreAgentsMd",
  "description": "AGENTS.md를 doc01 §P0에 제시된 형태로 작성 + 현재 repo 명령에 맞춰 보정",
  "assignment": "AGENTS.md를 다음 섹션으로 작성: ## Mission / ## Required verification / ## Local commands (install:bun install, dev:bun run dev, check:ts: bun run check:ts, check: bun run check, test:ts: bun run test:ts, test: bun run test, doctor: amaze memory doctor) / ## Architecture notes (Nexus 단일, contract 의무 영역, goal acceptance) / ## Failure protocol (reproduce → deterministic test → memory only for durable lessons → skill promote only after eval). doc01의 sample을 base로 하되 현재 코드 기반에 맞춰 수정. 100 바이트 이상.",
  "contract": {
    "role": "restore-agents-md",
    "scope":{"include":["AGENTS.md"],"exclude":[]},
    "inputArtifact":"docs/Phase0/01_gpt.md#P0",
    "outputContract":{"mustProduce":["AGENTS.md"]},
    "successCriteria":[
      {"id":"sections","check":{"type":"command-exit","argv":["bash","-c","grep -q '^## Mission' AGENTS.md && grep -q '^## Required verification' AGENTS.md && grep -q '^## Local commands' AGENTS.md"],"expected":0,"shell":true}}
    ],
    "escalation":{"onUncertainty":"ask-parent","budgetCap":80000}
  }
}
```

### T10.2 — test scripts 분리

```json
{
  "id": "SplitTestScripts",
  "description": "test:ts는 full, test:ts:failed는 --only-failures, ci:test:full 추가",
  "assignment": "package.json scripts: test:ts: 'bun run --workspaces --if-present test', test:ts:failed: 'bun run --workspaces --if-present test -- --only-failures', ci:test:full: 'bun run test:ts && bun run test:rs'. 기존 test 스크립트의 병렬 실행 형태는 유지하되 test:ts에 --only-failures 포함된 경우 제거. .github/workflows/* 에서 CI는 ci:test:full 또는 bun run check 사용 확인.",
  "contract": {
    "role": "test-script-split",
    "scope":{"include":["package.json",".github/workflows/**"],"exclude":[]},
    "inputArtifact":"docs/Phase0/01_gpt.md#P2-test-scripts",
    "outputContract":{"mustProduce":["scripts","ci updated"]},
    "successCriteria":[
      {"id":"script-key","check":{"type":"command-output","argv":["bash","-c","jq -r '.scripts | keys[]' package.json"],"stdoutPattern":"test:ts:failed","shell":true}}
    ],
    "escalation":{"onUncertainty":"ask-parent","budgetCap":100000}
  }
}
```

### T10.3 — Phase1 운전 README

```json
{
  "id": "Phase1Readme",
  "description": "docs/Phase1/README.md + goal-mode-driving.md 작성",
  "assignment": "docs/Phase1/README.md: 11개 md 파일 인덱스, 의존 그래프, 진입 명령, 각 파일의 Goal block을 어떻게 'goal start'에 투입하는지. docs/Phase1/goal-mode-driving.md: master todo init payload (00_overview.md에서 가져옴), phase별 ticket dispatch 절차, verifier 결과 해석, rollback. 새 파일 외 변경 금지.",
  "contract": {
    "role": "phase1-docs",
    "scope":{"include":["docs/Phase1/README.md","docs/Phase1/goal-mode-driving.md"],"exclude":[]},
    "inputArtifact":"docs/Phase1/00_overview.md",
    "outputContract":{"mustProduce":["README","driving doc"]},
    "successCriteria":[
      {"id":"readme","check":{"type":"file-exists","path":"docs/Phase1/README.md"}},
      {"id":"driving","check":{"type":"file-exists","path":"docs/Phase1/goal-mode-driving.md"}}
    ],
    "escalation":{"onUncertainty":"ask-parent","budgetCap":120000}
  }
}
```

### T10.4 — `amaze doctor` 통합 (선택, 1B-03 T3.6와 연계)

```json
{
  "id": "DoctorComposite",
  "description": "memory doctor / metrics / nexus degraded 를 amaze doctor 단일 진입점에서 합성",
  "assignment": "이미 amaze memory doctor 가 있다. amaze doctor (no subcmd) 를 추가하여 memory doctor + metrics warn + nexus degraded 를 합쳐 출력. Phase 1B-03 T3.6 머지 후 진행 권장 (의존). 신규 테스트 cli/doctor.test.ts: 모든 컴포넌트가 정상일 때 'all green', 일부 degraded 시 해당 라인 노출.",
  "contract": {
    "role": "doctor-composite",
    "scope":{"include":["packages/coding-agent/src/cli/doctor.ts","packages/coding-agent/tests/cli/doctor.test.ts"],"exclude":[]},
    "inputArtifact":"docs/Phase1/03_memory_governance.md#T3.6",
    "outputContract":{"mustProduce":["composite cli","test"]},
    "successCriteria":[
      {"id":"doctor-test","check":{"type":"command-exit","argv":["bun","test","packages/coding-agent/tests/cli/doctor.test.ts"],"expected":0}}
    ],
    "escalation":{"onUncertainty":"ask-parent","budgetCap":150000}
  }
}
```

## 병렬화

T10.1 / T10.2 / T10.3 즉시 병렬. T10.4 는 Phase 1B-03 T3.6 머지 후.

## 종료 조건

- AGENTS.md ≥ 100B 이고 3 섹션 헤더 존재
- `package.json` 에 `test:ts:failed` key 존재
- `docs/Phase1/README.md`, `docs/Phase1/goal-mode-driving.md` 존재
- (선택) `amaze doctor` 단일 명령으로 전체 상태 확인 가능
