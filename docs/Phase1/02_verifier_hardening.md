# Phase 1A-02 — Verifier & Tool Capability Hardening

> **출처**: `docs/Phase0/01_gpt.md` P1 (uncertain policy), `docs/Phase0/02_gpt.md` §6, §8 ~ §11.
> **위상**: P1. Phase1A-01 머지 후 진입.

## Goal

```yaml
title: Strengthen verifier semantics, lock structured output, shrink shell surface
why: |
  uncertain이 contract mode에서도 pass로 처리되고, yield schema validation은 두 번째 실패부터 bypass되고,
  command-* criteria가 sh -c 임의 실행이며, exec alias가 bash 권한을 몰래 부여하고,
  changedFiles attribution이 set-diff라 dirty file 변경이 verifier에서 누락된다.
scope:
  include:
    - packages/coding-agent/src/goals/verifier.ts
    - packages/coding-agent/src/goals/runtime.ts
    - packages/coding-agent/src/subagent/contract.ts
    - packages/coding-agent/src/subagent/task-revision-loop.ts
    - packages/coding-agent/src/task/executor.ts
    - packages/coding-agent/src/tools/yield/**
    - packages/coding-agent/src/runtime/subprocess.ts
  exclude:
    - packages/coding-agent/src/nexus/**
```

## Acceptance Criteria

```yaml
- id: uncertain-blocks-in-contract
  check: {type: command-exit, argv: [bun,test,packages/coding-agent/tests/verifier/uncertain-policy.test.ts], expected: 0}
- id: yield-no-bypass-by-default
  check: {type: command-exit, argv: [bun,test,packages/coding-agent/tests/yield/schema-bypass.test.ts], expected: 0}
- id: shell-criteria-policy-gated
  check: {type: command-exit, argv: [bun,test,packages/coding-agent/tests/verifier/command-criteria.test.ts], expected: 0}
- id: exec-no-implicit-bash
  check: {type: command-exit, argv: [bun,test,packages/coding-agent/tests/runtime/exec-alias.test.ts], expected: 0}
- id: dirty-file-attribution
  check: {type: command-exit, argv: [bun,test,packages/coding-agent/tests/task/dirty-file-attribution.test.ts], expected: 0}
- id: no-regression
  check: {type: command-exit, argv: [bun,run,check:ts], expected: 0}
```

## Tasks

### T2.1 — `uncertainPolicy` + per-criterion `blocking` field

```json
{
  "id": "UncertainPolicy",
  "description": "AcceptanceCriterion에 blocking 필드, summarize에 mode 추가, profile설정 uncertainPolicy",
  "assignment": "goals/verifier.ts의 AcceptanceCriterion에 blocking?: 'fail-only' | 'uncertain-blocks' 추가. defaultBlockingPolicy(criterion) 헬퍼: scope-include/lsp-clean/llm-judged → uncertain-blocks, 나머지 → fail-only. summarize(results, criteria, mode: 'audit'|'contract' = 'audit') 확장: contract mode에서 blocking uncertain은 fail로 집계. settings-schema.ts에 goal.uncertainPolicy: 'allow'|'warn'|'block-manual'|'block-all' (기본 'block-manual'). subagent/contract.ts의 runRevisionLoop는 mode='contract'로 summarize 호출. goals/runtime.ts completeGoalFromTool은 settings 기반으로 정책 적용. 신규 테스트 packages/coding-agent/tests/verifier/uncertain-policy.test.ts: (1) audit mode에서 uncertain은 pass, (2) contract mode + lsp-clean uncertain은 fail, (3) block-manual 설정에서 manual uncertain은 block.",
  "contract": {
    "role": "verifier-uncertain-policy",
    "scope": {"include":["packages/coding-agent/src/goals/**","packages/coding-agent/src/subagent/contract.ts","packages/coding-agent/src/settings/**","packages/coding-agent/tests/verifier/uncertain-policy.test.ts"],"exclude":[]},
    "inputArtifact":"docs/Phase0/02_gpt.md#6",
    "outputContract":{"mustProduce":["schema field","summarize updated","settings entry","test"]},
    "successCriteria":[
      {"id":"new-test","check":{"type":"command-exit","argv":["bun","test","packages/coding-agent/tests/verifier/uncertain-policy.test.ts"],"expected":0}},
      {"id":"regress","check":{"type":"command-exit","argv":["bun","run","check:ts"],"expected":0}}
    ],
    "escalation":{"onUncertainty":"ask-parent","budgetCap":200000}
  }
}
```

### T2.2 — Yield schema bypass default off

```json
{
  "id": "YieldSchemaLock",
  "description": "기본 schema bypass 차단, settings opt-in",
  "assignment": "YieldTool에서 task.yield.allowSchemaBypass 설정(기본 false) 검사. false일 때는 두 번째 실패도 throw. true일 때만 기존 maxBypassRetries 후 schemaValidationOverridden 허용. 신규 테스트 packages/coding-agent/tests/yield/schema-bypass.test.ts: (1) 기본값에서 두 번째 invalid yield도 throw, (2) opt-in 했을 때만 기존 동작.",
  "contract": {
    "role": "yield-schema-lock",
    "scope":{"include":["packages/coding-agent/src/tools/yield/**","packages/coding-agent/src/settings/**","packages/coding-agent/tests/yield/**"],"exclude":[]},
    "inputArtifact":"docs/Phase0/02_gpt.md#9",
    "outputContract":{"mustProduce":["yield bypass gate","setting","test"]},
    "successCriteria":[
      {"id":"yield-test","check":{"type":"command-exit","argv":["bun","test","packages/coding-agent/tests/yield/schema-bypass.test.ts"],"expected":0}}
    ],
    "escalation":{"onUncertainty":"ask-parent","budgetCap":120000}
  }
}
```

### T2.3 — Command criteria: argv default, shell behind policy

```json
{
  "id": "CommandCriteriaArgv",
  "description": "command-exit/command-output에 argv 모드 추가, shell mode는 verifier.allowShellCriteria opt-in",
  "assignment": "verifier.ts의 CommandCheck 타입을 union으로 확장: argv-form {argv: string[], expected, cwd?} 기본, shell-form {command: string, shell: true, ...}는 settings 'verifier.allowShellCriteria' true일 때만 실행. shell-form에 argv 누락 시 spawn 안 함. Bun.spawn 호출 분기. 기존 sh -c 호출처는 argv-form으로 컨버트 가능한 케이스 모두 마이그레이션, 마이그레이션 불가하면 README/주석에 명시. 신규 테스트: (1) argv-form OK, (2) shell-form + policy off → reject, (3) shell-form + policy on → 실행.",
  "contract": {
    "role": "verifier-argv-mode",
    "scope":{"include":["packages/coding-agent/src/goals/verifier.ts","packages/coding-agent/src/settings/**","packages/coding-agent/tests/verifier/command-criteria.test.ts"],"exclude":[]},
    "inputArtifact":"docs/Phase0/02_gpt.md#10",
    "outputContract":{"mustProduce":["argv mode","shell gated","test"]},
    "successCriteria":[
      {"id":"cmd-test","check":{"type":"command-exit","argv":["bun","test","packages/coding-agent/tests/verifier/command-criteria.test.ts"],"expected":0}}
    ],
    "escalation":{"onUncertainty":"ask-parent","budgetCap":180000}
  }
}
```

### T2.4 — `exec` alias capability split

```json
{
  "id": "ExecAliasSplit",
  "description": "exec alias가 bash 권한을 자동 부여하지 않도록 분리",
  "assignment": "runtime/subprocess.ts의 runSubprocess에서 agent.tools에 'exec'가 있을 때 'eval', 'bash'를 자동 추가하던 로직을 제거. 마이그레이션: exec를 사용하던 agent definition은 'eval' (+ 필요 시 명시적 'bash') 로 풀어쓴다. .amaze/skills, .amaze/commands, 빌트인 agents 정의 검사 후 필요한 frontmatter 교체. 신규 테스트 packages/coding-agent/tests/runtime/exec-alias.test.ts: exec만 선언된 agent의 effective tools에 bash 미포함.",
  "contract": {
    "role": "tool-capability-split",
    "scope":{"include":["packages/coding-agent/src/runtime/subprocess.ts","packages/coding-agent/src/agents/**",".amaze/**","packages/coding-agent/tests/runtime/exec-alias.test.ts"],"exclude":["packages/coding-agent/src/nexus/**"]},
    "inputArtifact":"docs/Phase0/02_gpt.md#11",
    "outputContract":{"mustProduce":["alias logic removed","agents migrated","test"]},
    "successCriteria":[
      {"id":"exec-test","check":{"type":"command-exit","argv":["bun","test","packages/coding-agent/tests/runtime/exec-alias.test.ts"],"expected":0}},
      {"id":"regress","check":{"type":"command-exit","argv":["bun","run","check:ts"],"expected":0}}
    ],
    "escalation":{"onUncertainty":"ask-parent","budgetCap":160000}
  }
}
```

### T2.5 — changedFiles attribution via dirty hash snapshot

```json
{
  "id": "DirtyFileAttribution",
  "description": "task 시작 시 dirty file content hash snapshot, 종료 시 diff로 진짜 변경 파일 산출",
  "assignment": "task/index.ts와 task/executor.ts에서 cwdBefore = await snapshotDirtyFilesWithHash(cwd) (신규 헬퍼). hash는 sha256 (Bun.CryptoHasher), dirty file만 — 전체 repo X. cwdAfter = snapshotDirtyFilesWithHash(cwd) 후 diffDirtySnapshots(before, after): hash 변화 + 신규 path 합집합 반환. snapshotGitChangedFiles 결과와 union. 신규 테스트: 이미 dirty인 파일을 subagent가 추가 수정해도 changedFiles에 포함됨을 verifier scope-include 통과로 검증.",
  "contract": {
    "role": "changed-files-attribution",
    "scope":{"include":["packages/coding-agent/src/task/**","packages/coding-agent/src/git/**","packages/coding-agent/tests/task/dirty-file-attribution.test.ts"],"exclude":[]},
    "inputArtifact":"docs/Phase0/02_gpt.md#8",
    "outputContract":{"mustProduce":["snapshot helper","callsites","test"]},
    "successCriteria":[
      {"id":"dirty-test","check":{"type":"command-exit","argv":["bun","test","packages/coding-agent/tests/task/dirty-file-attribution.test.ts"],"expected":0}}
    ],
    "escalation":{"onUncertainty":"ask-parent","budgetCap":160000}
  }
}
```

## 병렬화

T2.1 ~ T2.5 는 파일 영역이 거의 분리되어 있어 모두 병렬 실행 가능. 단,
- T2.1 의 settings 변경이 다른 작업과 겹칠 수 있으므로 settings-schema 수정은 T2.1 이 owning. T2.2 / T2.3 의 settings 키는 T2.1 머지 후 또는 IRC 로 합의.

## 검증

```bash
bun test packages/coding-agent/tests/{verifier,yield,runtime,task}/
bun run check:ts
```

## 종료 조건

- doc02 § 13 회귀 매트릭스 중 다음 항목 통과: `contractUncertainBlocksWhenStrict`, `yieldInvalidSchemaDoesNotBypassByDefault`, `commandCriteriaShellRequiresPolicy`, `execDoesNotImplicitlyGrantBash`, `dirtyFileModifiedDuringTaskIsAttributed`.
