# Phase 1D-06 — Learning Proposal Layer

> **출처**: `docs/Phase0/03_gpt.md` §7.2.
> **위상**: P2. Phase 03 (memory governance) + Phase 05 (rule DSL) 완료 후.

## Goal

```yaml
title: Stage every "Amaze wants to change itself" event as a typed, evidence-backed Proposal
why: |
  현재 Nexus는 memory/skill 변경을 직접 store에 쓴다.
  자기개선 governance를 닫으려면 변경 전에 항상 LearningProposal로 staging되고,
  eval gate(07) → versioned apply → rollback 경로를 통과해야 한다.
scope:
  include:
    - packages/coding-agent/src/learning/**
    - packages/coding-agent/src/cli/proposals.ts
    - packages/coding-agent/src/nexus/pipeline.ts   # write 경로를 proposal로 우회
    - packages/coding-agent/src/rules/**            # rule finding → proposal generator
```

## `LearningProposal` 계약

```ts
export type ProposalGate = "auto" | "review" | "human-required";
export type ProposalStatus = "pending" | "approved" | "rejected" | "applied" | "rolled-back" | "expired";

export interface ProposalBase {
  id: string;            // ULID
  createdAt: number;
  status: ProposalStatus;
  gate: ProposalGate;
  evidence: {
    sessionIds: string[];
    eventRefs: string[];     // jsonl offsets or content hash
    ruleFindings?: string[]; // RuleFinding ids
    sampleN: number;
  };
  provenance: { source: "rule" | "reflection" | "manual"; ruleId?: string };
  expiresAt?: number;
}

export type LearningProposal = ProposalBase & (
  | { type: "memory"; content: string; memoryType: string; confidence: "tool_verified"|"inferred"|"hypothesis" }
  | { type: "skill"; name: string; sourceMemoryIds: string[]; bodyMarkdown: string; evalCommand?: string }
  | { type: "rule"; ruleMarkdown: string; replaySessions: string[]; expectedImpact: string }
  | { type: "settings"; patch: Record<string, unknown>; reason: string; rollback: Record<string, unknown> }
);
```

## Acceptance Criteria

```yaml
- id: proposal-store-roundtrip
  check: {type: command-exit, argv: [bun,test,packages/coding-agent/tests/learning/store.test.ts], expected: 0}
- id: nexus-writes-route-through-proposals
  check: {type: command-exit, argv: [bun,test,packages/coding-agent/tests/learning/nexus-routing.test.ts], expected: 0}
- id: rule-finding-to-proposal
  check: {type: command-exit, argv: [bun,test,packages/coding-agent/tests/learning/from-rule.test.ts], expected: 0}
- id: gate-defaults
  check: {type: command-exit, argv: [bun,test,packages/coding-agent/tests/learning/gates.test.ts], expected: 0}
- id: proposals-cli
  check: {type: command-exit, argv: [bun,test,packages/coding-agent/tests/cli/proposals.test.ts], expected: 0}
```

## Tasks

### T6.1 — Proposal store (SQLite)

```json
{
  "id": "ProposalStore",
  "description": "learning_proposals 테이블, status transition 검증, evidence 인덱스",
  "assignment": "별도 nexus-learning.db. 테이블: learning_proposals(id, type, status, gate, payload JSON, evidence JSON, provenance JSON, created_at, updated_at, expires_at), learning_proposal_events(proposal_id, ts, kind, payload). insert는 status='pending'만 허용. transition은 명시 함수: approve(id, by), reject(id, reason), markApplied(id, version), markRolledBack(id, reason), markExpired(id). 잘못된 transition (예: applied → pending) throw. evidence.sessionIds, provenance.ruleId, type 인덱스. 신규 테스트 learning/store.test.ts: roundtrip + invalid transition reject.",
  "contract": {
    "role": "proposal-store",
    "scope":{"include":["packages/coding-agent/src/learning/store.ts","packages/coding-agent/src/learning/types.ts","packages/coding-agent/src/learning/migrations/**","packages/coding-agent/tests/learning/store.test.ts"],"exclude":[]},
    "inputArtifact":"docs/Phase1/06_learning_proposal.md",
    "outputContract":{"mustProduce":["store","schema","test"]},
    "successCriteria":[
      {"id":"store-test","check":{"type":"command-exit","argv":["bun","test","packages/coding-agent/tests/learning/store.test.ts"],"expected":0}}
    ],
    "escalation":{"onUncertainty":"ask-parent","budgetCap":220000}
  }
}
```

### T6.2 — Reroute Nexus writes through proposals

```json
{
  "id": "NexusRoutingViaProposals",
  "description": "promoteRepeatedSkillCandidates / promoteConceptualSkills / reflection-derived memory writes 모두 proposal로",
  "assignment": "nexus/pipeline.ts와 store.ts에서 LLM/reflection이 생성하는 memory 또는 skill 작성 경로를 ProposalStore.create(...)로 변경. user_asserted (사용자가 명시적으로 'remember' 호출) 와 tool_verified evidence 가 있는 직접 명령은 기존 경로 유지. (이미 Phase1B-03 T3.2에서 skill auto-active가 eval_pending까지로 제한됐다 — 그 자리에 proposal create를 끼워넣는다.) 신규 테스트 learning/nexus-routing.test.ts: (a) reflection이 skill 후보를 만들면 store에 'eval_pending' skill 대신 LearningProposal(type='skill', gate='review')가 생성됨. (b) user remember는 직접 memory 작성됨.",
  "contract": {
    "role": "nexus-routing",
    "scope":{"include":["packages/coding-agent/src/nexus/pipeline.ts","packages/coding-agent/src/nexus/store.ts","packages/coding-agent/tests/learning/nexus-routing.test.ts"],"exclude":[]},
    "inputArtifact":"docs/Phase1/06_learning_proposal.md",
    "outputContract":{"mustProduce":["routing logic","test"]},
    "successCriteria":[
      {"id":"routing-test","check":{"type":"command-exit","argv":["bun","test","packages/coding-agent/tests/learning/nexus-routing.test.ts"],"expected":0}},
      {"id":"regress","check":{"type":"command-exit","argv":["bun","run","check:ts"],"expected":0}}
    ],
    "escalation":{"onUncertainty":"ask-parent","budgetCap":250000}
  }
}
```

### T6.3 — Rule finding → proposal generator

```json
{
  "id": "RuleFindingToProposal",
  "description": "rule finding을 LearningProposal(type='rule' 또는 'settings')로 변환하는 generator",
  "assignment": "learning/from-rule.ts: ruleFindingToProposal(finding, opts) -> LearningProposal | null. 빌트인 mapping table: force-complete-rate → settings patch {'goal.uncertainPolicy': 'block-manual'} 제안, memory-low-precision → memory rewrite 제안 등. mapping이 없는 rule은 manual 'rule' proposal로 (rule body 자체를 새로운 .amaze/rules 후보로 staging). 신규 테스트 learning/from-rule.test.ts: 각 mapping case + unknown ruleId fallback.",
  "contract": {
    "role": "rule-to-proposal",
    "scope":{"include":["packages/coding-agent/src/learning/from-rule.ts","packages/coding-agent/tests/learning/from-rule.test.ts"],"exclude":[]},
    "inputArtifact":"docs/Phase1/06_learning_proposal.md",
    "outputContract":{"mustProduce":["generator","mapping table","test"]},
    "successCriteria":[
      {"id":"from-rule-test","check":{"type":"command-exit","argv":["bun","test","packages/coding-agent/tests/learning/from-rule.test.ts"],"expected":0}}
    ],
    "escalation":{"onUncertainty":"ask-parent","budgetCap":180000}
  }
}
```

### T6.4 — Gate defaults & policy

```json
{
  "id": "ProposalGates",
  "description": "type별 기본 gate, settings 오버라이드, expiresAt 자동 부여",
  "assignment": "기본 gate: memory(tool_verified)=auto, memory(inferred|hypothesis)=review, skill=review, rule=review, settings=human-required. settings에 learning.gateOverrides: Record<type, gate>. expiresAt default = createdAt + 14d. 만료된 pending proposal은 markExpired() 자동 (백그라운드 또는 lazy). 신규 테스트 learning/gates.test.ts: 각 type 기본값 + 오버라이드 + 만료.",
  "contract": {
    "role": "proposal-gates",
    "scope":{"include":["packages/coding-agent/src/learning/gates.ts","packages/coding-agent/src/settings/**","packages/coding-agent/tests/learning/gates.test.ts"],"exclude":[]},
    "inputArtifact":"docs/Phase1/06_learning_proposal.md",
    "outputContract":{"mustProduce":["policy","setting","test"]},
    "successCriteria":[
      {"id":"gate-test","check":{"type":"command-exit","argv":["bun","test","packages/coding-agent/tests/learning/gates.test.ts"],"expected":0}}
    ],
    "escalation":{"onUncertainty":"ask-parent","budgetCap":150000}
  }
}
```

### T6.5 — CLI `amaze proposals`

```json
{
  "id": "ProposalsCli",
  "description": "list / show / approve / reject / diff",
  "assignment": "amaze proposals list [--status pending] [--type skill], amaze proposals show <id>, amaze proposals approve <id> [--reason], amaze proposals reject <id> --reason, amaze proposals diff <id> (proposal type=settings는 patch diff, type=skill은 bodyMarkdown diff). approve는 status='approved'로만 전환, apply는 Phase 1D-07이 owning. 신규 테스트 cli/proposals.test.ts.",
  "contract": {
    "role": "proposals-cli",
    "scope":{"include":["packages/coding-agent/src/cli/proposals.ts","packages/coding-agent/tests/cli/proposals.test.ts"],"exclude":[]},
    "inputArtifact":"docs/Phase1/06_learning_proposal.md",
    "outputContract":{"mustProduce":["cli","test"]},
    "successCriteria":[
      {"id":"prop-cli-test","check":{"type":"command-exit","argv":["bun","test","packages/coding-agent/tests/cli/proposals.test.ts"],"expected":0}}
    ],
    "escalation":{"onUncertainty":"ask-parent","budgetCap":150000}
  }
}
```

## 병렬화

T6.1 먼저 (store schema가 contract). 머지 후 T6.2 / T6.3 / T6.4 / T6.5 병렬.

## 종료 조건

- Reflection/skill auto-promotion 경로가 더 이상 Nexus store에 직접 쓰지 않고 proposal로만 staging.
- Rule findings 가 proposal 로 자동 변환되어 `amaze proposals list` 에 보임.
- Settings type proposal은 human-required gate 로 자동 분류.
