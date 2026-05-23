# Phase 1A-01 — Boundary Closure (권한/검증 경계)
> **Ticket**: T1.1
> **Phase**: P0
> **Status**: landed (2026-05-23)
> **Closing**: docs/Phase1/closing-report.md

> **출처**: `docs/Phase0/02_gpt.md` §3 ~ §5, §7.
> **위상**: P0. Phase1 의 모든 후속 작업의 전제조건.

## Goal

```yaml
title: Close permission and verification boundaries for subagents
why: |
  Plan-mode effectiveAgent가 실제 subprocess에 전달되지 않고,
  apply_patch / rename destination이 scope guard를 우회하며,
  isolated task는 verifier loop 없이 merge/capture된다.
  자기개선 루프를 닫기 전에 권한 경계부터 닫는다.
scope:
  include:
    - packages/coding-agent/src/task/**
    - packages/coding-agent/src/subagent/**
    - packages/coding-agent/src/tools/edit/**
    - packages/coding-agent/src/tools/write/**
    - packages/coding-agent/src/tools/shared/scope.ts
  exclude:
    - packages/coding-agent/src/nexus/**
    - packages/coding-agent/src/knowledge/**
```

## Acceptance Criteria (deterministic, machine-checkable)

```yaml
- id: plan-mode-effective-agent
  description: plan mode subagent에서 write/bash/task/spawns 제거 확인
  check:
    type: command-exit
    argv: ["bun", "test", "packages/coding-agent/tests/task/plan-mode-agent.test.ts"]
    expected: 0
    blocking: uncertain-blocks

- id: apply-patch-scope-guard
  description: apply_patch envelope 내부 path도 scope 검사
  check:
    type: command-exit
    argv: ["bun", "test", "packages/coding-agent/tests/tools/apply-patch-scope.test.ts"]
    expected: 0

- id: rename-destination-guard
  description: rename destination도 scope 검사
  check:
    type: command-exit
    argv: ["bun", "test", "packages/coding-agent/tests/tools/rename-scope.test.ts"]
    expected: 0

- id: canonical-mutation-scope
  description: absolute/../symlink/conflict:// 우회 차단
  check:
    type: command-exit
    argv: ["bun", "test", "packages/coding-agent/tests/tools/mutation-scope.test.ts"]
    expected: 0

- id: isolated-verifier-blocks-merge
  description: isolated task verifier fail 시 merge/capture 금지
  check:
    type: command-exit
    argv: ["bun", "test", "packages/coding-agent/tests/task/isolated-verifier.test.ts"]
    expected: 0

- id: lsp-clean-on-changed
  description: 변경된 파일 LSP diagnostics 0
  check:
    type: lsp-clean
    maxWarnings: 0

- id: no-regression
  description: 기존 전체 TS 테스트 통과
  check:
    type: command-exit
    argv: ["bun", "run", "check:ts"]
    expected: 0
```

## Tasks (ticket = SubagentContract)

### T1.1 — Wire `effectiveAgent` into subprocess options

```json
{
  "id": "WireEffectiveAgent",
  "description": "plan-mode effectiveAgent를 isolated/non-isolated 양쪽 runSubprocess에 전달",
  "assignment": "task/index.ts의 baseSubprocessOptions와 isolated runSubprocess({...}) 호출 둘 다에서 agent 필드를 effectiveAgent로 교체한다. effectiveAgent는 이미 같은 함수 위쪽에서 계산되어 있다. 변경 후 packages/coding-agent/tests/task/plan-mode-agent.test.ts 신규 테스트를 작성하여 plan mode에서 spawned subagent의 tool list = ['read','search','find','lsp','web_search'] 이고 spawns env가 빈 문자열, system prompt에 planModeSubagentPrompt가 포함되는지 검증한다. 기존 테스트와 typecheck 깨지지 않게 유지. 외부 도구 호출 금지 - 본 작업 외 파일 변경 금지.",
  "contract": {
    "role": "wire-effective-agent",
    "scope": {
      "include": [
        "packages/coding-agent/src/task/index.ts",
        "packages/coding-agent/tests/task/plan-mode-agent.test.ts"
      ],
      "exclude": ["**/node_modules/**"]
    },
    "inputArtifact": "docs/Phase0/02_gpt.md#3",
    "outputContract": { "mustProduce": ["src/task/index.ts modified", "new test file"] },
    "successCriteria": [
      {"id":"test-passes","description":"new test passes","check":{"type":"command-exit","argv":["bun","test","packages/coding-agent/tests/task/plan-mode-agent.test.ts"],"expected":0}},
      {"id":"regression","description":"no regression","check":{"type":"command-exit","argv":["bun","run","check:ts"],"expected":0}}
    ],
    "escalation": {"onUncertainty":"ask-parent","budgetCap":150000}
  }
}
```

### T1.2 — apply_patch & rename destination scope guard

```json
{
  "id": "ApplyPatchScopeGuard",
  "description": "EditTool.execute에서 apply_patch entries 확장 직후 enforceMutationScope 적용",
  "assignment": "EditTool.execute()의 apply_patch branch에서 expandApplyPatchToEntries() 직후 모든 entry.path 와 entry.rename(있으면)에 대해 enforceMutationScope(session, path, {op, source}) 호출. patch mode에도 rename destination guard 추가. 기존 plan mode write guard 호출은 유지. 신규 테스트 2개: (1) apply_patch envelope 안에 scope 밖 path가 있으면 reject (2) patch mode rename destination이 scope 밖이면 reject. mutation-scope 공통 헬퍼는 T1.3에서 제공되므로 인터페이스만 정의 후 import.",
  "contract": {
    "role": "scope-guard-apply-patch",
    "scope": {
      "include": [
        "packages/coding-agent/src/tools/edit/**",
        "packages/coding-agent/tests/tools/apply-patch-scope.test.ts",
        "packages/coding-agent/tests/tools/rename-scope.test.ts"
      ],
      "exclude": []
    },
    "inputArtifact": "docs/Phase0/02_gpt.md#4",
    "outputContract": {"mustProduce":["edit tool modified","2 new tests"]},
    "successCriteria": [
      {"id":"apply-patch-test","check":{"type":"command-exit","argv":["bun","test","packages/coding-agent/tests/tools/apply-patch-scope.test.ts"],"expected":0}},
      {"id":"rename-test","check":{"type":"command-exit","argv":["bun","test","packages/coding-agent/tests/tools/rename-scope.test.ts"],"expected":0}}
    ],
    "escalation": {"onUncertainty":"ask-parent","budgetCap":150000}
  }
}
```

### T1.3 — Unified canonical mutation scope guard

```json
{
  "id": "CanonicalMutationScope",
  "description": "raw/absolute/relative/symlink/conflict:///archive/sqlite를 canonical absolute path로 normalize한 후 scope 검사",
  "assignment": "packages/coding-agent/src/tools/shared/scope.ts에 resolveMutationTarget(session, rawPath) -> {raw, absolutePath, relativeToCwd, scheme} 와 enforceMutationScope(session, rawPath, {op, source})를 신설. 규칙: (1) scheme이 conflict:// archive:// sqlite:// 이면 backing file path로 resolve (2) absolute path는 cwd 밖이면 즉시 reject (3) realpath 가능하면 적용 (4) cwd-relative canonical path에만 glob 적용 (5) raw path는 error 메시지에만 사용. 기존 enforceContractScope/enforceGoalScope의 raw path 호출처 (write, edit.patch, edit.apply_patch, T1.2 결과)는 모두 이 새 guard를 경유하도록 교체. 신규 테스트 packages/coding-agent/tests/tools/mutation-scope.test.ts: absolute / .. / symlink / conflict:// / rename-destination 각 케이스 reject.",
  "contract": {
    "role": "canonical-scope-helper",
    "scope": {
      "include": [
        "packages/coding-agent/src/tools/shared/**",
        "packages/coding-agent/src/tools/write/**",
        "packages/coding-agent/src/tools/edit/**",
        "packages/coding-agent/tests/tools/mutation-scope.test.ts"
      ],
      "exclude": []
    },
    "inputArtifact": "docs/Phase0/02_gpt.md#7",
    "outputContract":{"mustProduce":["shared/scope.ts helpers","callsites migrated","new test"]},
    "successCriteria": [
      {"id":"mutation-scope-test","check":{"type":"command-exit","argv":["bun","test","packages/coding-agent/tests/tools/mutation-scope.test.ts"],"expected":0}},
      {"id":"existing-tests","check":{"type":"command-exit","argv":["bun","test","packages/coding-agent/tests/tools/"],"expected":0}}
    ],
    "escalation":{"onUncertainty":"ask-parent","budgetCap":250000}
  }
}
```

### T1.4 — Isolated task verifier loop

```json
{
  "id": "IsolatedVerifierLoop",
  "description": "isolated branch도 executeContractedTask로 감싸 verifier 통과 전엔 merge/capture 금지",
  "assignment": "task/index.ts isolated branch: (a) task.contract가 있으면 parentGoalRevision으로 stampContractRevision 적용, (b) cwdBefore = snapshotGitChangedFiles(isolationDir) 캡처, (c) runSubprocess 호출을 executeContractedTask의 runOnce 콜백 안으로 옮기고, output/exitCode/aborted/changedFiles/cwd=isolationDir 반환, (d) outcome.finalVerdict.verdict !== 'pass' 이면 merge/branch-commit/patch-capture 단계를 건너뛰고 error 반환. 기존 non-isolated 경로와 동일한 retry policy 적용. 신규 테스트: isolated task의 verifier가 fail이면 isolationDir의 변경이 main worktree에 반영되지 않음을 검증.",
  "contract": {
    "role": "isolated-verifier-loop",
    "scope": {
      "include": [
        "packages/coding-agent/src/task/index.ts",
        "packages/coding-agent/tests/task/isolated-verifier.test.ts"
      ],
      "exclude": []
    },
    "inputArtifact": "docs/Phase0/02_gpt.md#5",
    "outputContract":{"mustProduce":["isolated branch refactored","new test"]},
    "successCriteria": [
      {"id":"isolated-test","check":{"type":"command-exit","argv":["bun","test","packages/coding-agent/tests/task/isolated-verifier.test.ts"],"expected":0}},
      {"id":"task-suite","check":{"type":"command-exit","argv":["bun","test","packages/coding-agent/tests/task/"],"expected":0}}
    ],
    "escalation":{"onUncertainty":"ask-parent","budgetCap":250000}
  }
}
```

## 실행 순서

```text
T1.3 (canonical helper)  ──┐
T1.1 (effectiveAgent)     ─┼─► T1.2 (apply_patch guard uses T1.3)
                           │
                           └─► T1.4 (isolated verifier)
```

T1.1 / T1.3 는 병렬. T1.2 는 T1.3 머지 후. T1.4 는 T1.1 머지 후.

## 검증 & 롤백

- 전체 phase verification: `bun run check:ts && bun test packages/coding-agent/tests/{task,tools}/`
- 롤백 기준: `WireEffectiveAgent` 만 머지된 채 다른 PR이 실패하면 P0 회귀이므로 `git revert`. canonical scope helper 는 callsite 가 많으므로 PR 단위로 분할 머지.
- doc02 § 13 회귀 테스트 매트릭스 13개 중 본 phase 가 책임지는 항목: planMode\*, applyPatchRejects\*, patchRejectsOutOfScopeRename\*, writeScopeUsesCanonical\*, conflictUriScope\*, isolatedContractVerifierBlocksMerge.
