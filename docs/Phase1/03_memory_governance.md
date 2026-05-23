# Phase 1B-03 — Memory & Skill Governance

> **출처**: `docs/Phase0/01_gpt.md` P1 contradiction / skill auto-active / legacy migration, P2 static memory boundary / session-search freshness / FTS / startup degraded.
> **위상**: P1. 1A 와 병렬 가능 (코드 영역 분리: `nexus/**` vs `task/tools/**`).

## Goal

```yaml
title: Make memory→skill→active-policy promotion safe and explicit
why: |
  - Embedding이 없을 때 contradiction score 0.85 default는 false positive를 양산한다.
  - promoteConceptualSkills가 LLM 출력으로 SKILL을 곧바로 active 상태로 만든다.
    self-contamination 위험.
  - legacy memory migration이 "import된다 vs 설정만 바뀐다" 사이에서 모호하다.
  - static memory summary가 fence 없이 system prompt에 들어간다.
scope:
  include:
    - packages/coding-agent/src/nexus/**
    - packages/coding-agent/src/knowledge/**
    - packages/coding-agent/src/settings/settings-schema.ts
    - docs/memory.md
    - docs/Phase1/03_memory_governance.md
  exclude:
    - packages/coding-agent/src/goals/**
    - packages/coding-agent/src/task/**
```

## Acceptance Criteria

```yaml
- id: contradiction-fallback-lowered
  check: {type: command-exit, argv: [bun,test,packages/coding-agent/tests/nexus/contradiction.test.ts], expected: 0}
- id: skill-lifecycle-states
  check: {type: command-exit, argv: [bun,test,packages/coding-agent/tests/nexus/skill-lifecycle.test.ts], expected: 0}
- id: skill-cli-validate-promote
  check: {type: command-exit, argv: [bun,test,packages/coding-agent/tests/cli/skill-cmd.test.ts], expected: 0}
- id: legacy-migration-docs-clear
  check: {type: command-output, argv: [grep,-E,"Legacy backend data is not imported automatically|amaze memory migrate-legacy","docs/memory.md"], expected: 0}
- id: static-memory-fenced
  check: {type: command-exit, argv: [bun,test,packages/coding-agent/tests/nexus/static-memory-fence.test.ts], expected: 0}
- id: session-index-by-hash
  check: {type: command-exit, argv: [bun,test,packages/coding-agent/tests/nexus/session-index-freshness.test.ts], expected: 0}
- id: startup-degraded-surfaced
  check: {type: command-exit, argv: [bun,test,packages/coding-agent/tests/nexus/startup-degraded.test.ts], expected: 0}
```

## Tasks

### T3.1 — Lexical-aware contradiction signal

```json
{
  "id": "ContradictionLexical",
  "description": "embedding 부재 시 lexical contradiction signal, potential_contradiction relation 도입",
  "assignment": "NexusStore.#detectTextContradictions(): hasA && hasB 분기 유지, 그 외 분기는 lexicalContradictionSignal(a,b) 호출. 함수는 must/must not, always/never, enabled/disabled, true/false, 한국어 '사용한다/사용하지 않는다', '켜야 한다/꺼야 한다' 등 hard pattern 매치 시 0.75, 미매치 시 0.35 반환. relation 생성 분기: score>=0.7 이고 양쪽 embedding 있으면 'contradicts', 아니면 'potential_contradiction'. memory_relations 스키마에 새 relation enum 추가 (마이그레이션 SQL). 신규 테스트: '(a) 같은 subject key에 보완적 텍스트만 있으면 relation 미생성 (b) hard pattern 있으면 potential_contradiction (c) embedding+score>=0.7 이면 contradicts'.",
  "contract": {
    "role": "contradiction-tuning",
    "scope":{"include":["packages/coding-agent/src/nexus/store.ts","packages/coding-agent/src/nexus/types.ts","packages/coding-agent/src/nexus/migrations/**","packages/coding-agent/tests/nexus/contradiction.test.ts"],"exclude":[]},
    "inputArtifact":"docs/Phase0/01_gpt.md#P1-contradiction",
    "outputContract":{"mustProduce":["lexical signal","relation enum","migration","test"]},
    "successCriteria":[
      {"id":"contra-test","check":{"type":"command-exit","argv":["bun","test","packages/coding-agent/tests/nexus/contradiction.test.ts"],"expected":0}},
      {"id":"regress","check":{"type":"command-exit","argv":["bun","run","check:ts"],"expected":0}}
    ],
    "escalation":{"onUncertainty":"ask-parent","budgetCap":200000}
  }
}
```

### T3.2 — Skill lifecycle states + auto-promote ceiling

```json
{
  "id": "SkillLifecycle",
  "description": "SkillStatus = candidate|draft|eval_pending|validated|active|deprecated|banned, auto promote는 eval_pending까지만",
  "assignment": "memory_skills.status enum 확장 (DB 마이그레이션). promoteRepeatedSkillCandidates / promoteConceptualSkills는 'eval_pending'으로만 upsert. renderSkillMarkdown은 status이 'validated' 또는 'active' 일 때만 .amaze/skills/*/SKILL.md 파일을 쓴다. CLI 명령 추가: amaze skill list / amaze skill validate <name> / amaze skill promote <name> (--reason). promote는 file artifact 생성 + status='active' 전환 + sourceMemoryIds 잠금. validate는 eval gate (Phase 1D-07) 가 아직 없으므로 placeholder: 명시적 사용자 승인만 수락하고 status='validated' 로 전환. 신규 테스트 skill-lifecycle.test.ts + cli/skill-cmd.test.ts.",
  "contract": {
    "role": "skill-lifecycle",
    "scope":{"include":["packages/coding-agent/src/nexus/store.ts","packages/coding-agent/src/nexus/pipeline.ts","packages/coding-agent/src/nexus/skills/**","packages/coding-agent/src/cli/skill.ts","packages/coding-agent/src/nexus/migrations/**","packages/coding-agent/tests/nexus/skill-lifecycle.test.ts","packages/coding-agent/tests/cli/skill-cmd.test.ts"],"exclude":[]},
    "inputArtifact":"docs/Phase0/01_gpt.md#P1-skill-auto-active",
    "outputContract":{"mustProduce":["status enum","pipeline change","CLI","tests"]},
    "successCriteria":[
      {"id":"skill-test","check":{"type":"command-exit","argv":["bun","test","packages/coding-agent/tests/nexus/skill-lifecycle.test.ts"],"expected":0}},
      {"id":"cli-test","check":{"type":"command-exit","argv":["bun","test","packages/coding-agent/tests/cli/skill-cmd.test.ts"],"expected":0}}
    ],
    "escalation":{"onUncertainty":"ask-parent","budgetCap":300000}
  }
}
```

### T3.3 — Legacy migration: data vs setting separation

```json
{
  "id": "LegacyMigrationClarity",
  "description": "옵션 B 채택: 데이터 import 안 함을 명확히 고지. + amaze memory migrate-legacy CLI 신설(옵트인 명령)",
  "assignment": "settings.ts migration comment를 'Canonical cutover: legacy backend settings migrate to Nexus. Legacy backend data is not imported automatically. Prior sessions are reindexed through Nexus session search.' 로 교체. docs/memory.md 에 동일 문구 + 'Manual data import: amaze memory migrate-legacy --from <rockey|hindsight>'. CLI는 placeholder: rockey/hindsight DB가 발견되면 entries 를 Nexus memory_items 로 적재 (source 메타데이터에 'imported_legacy' 표시), 발견 안 되면 'no legacy data found' 종료. 신규 테스트: docs/memory.md grep 통과 + CLI smoke test (no data → 0 exit, with fixture data → entries imported).",
  "contract": {
    "role": "legacy-migration-clarity",
    "scope":{"include":["packages/coding-agent/src/settings/**","packages/coding-agent/src/cli/memory.ts","docs/memory.md","packages/coding-agent/tests/cli/memory-migrate.test.ts"],"exclude":[]},
    "inputArtifact":"docs/Phase0/01_gpt.md#P1-legacy-migration",
    "outputContract":{"mustProduce":["comment+docs","CLI","test"]},
    "successCriteria":[
      {"id":"docs-grep","check":{"type":"command-output","argv":["grep","-E","Legacy backend data is not imported automatically","docs/memory.md"],"expected":0}},
      {"id":"cli-test","check":{"type":"command-exit","argv":["bun","test","packages/coding-agent/tests/cli/memory-migrate.test.ts"],"expected":0}}
    ],
    "escalation":{"onUncertainty":"ask-parent","budgetCap":180000}
  }
}
```

### T3.4 — Static memory summary fenced

```json
{
  "id": "StaticMemoryFence",
  "description": "buildDeveloperInstructions가 memory_summary 본문을 <nexus-memory-summary>로 감싸고 sanitize",
  "assignment": "system-prompt.ts (또는 buildDeveloperInstructions 위치)에서 memory_summary.md 내용을 stripRecallFences로 sanitize 후 <nexus-memory-summary>...</nexus-memory-summary> 단일 페어로 wrap. 본문 내 instruction-like content (e.g. <system-directive>, ```instructions, You MUST ...) 는 escape 또는 plain text로 강등. 신규 테스트: static memory에 악성 instruction 주입해도 outer fence가 닫혀있고 wrap된 본문이 sanitized 됨.",
  "contract": {
    "role": "static-memory-boundary",
    "scope":{"include":["packages/coding-agent/src/system-prompt.ts","packages/coding-agent/src/nexus/sanitize.ts","packages/coding-agent/tests/nexus/static-memory-fence.test.ts"],"exclude":[]},
    "inputArtifact":"docs/Phase0/01_gpt.md#P2-static-memory",
    "outputContract":{"mustProduce":["fence wrap","sanitizer","test"]},
    "successCriteria":[
      {"id":"fence-test","check":{"type":"command-exit","argv":["bun","test","packages/coding-agent/tests/nexus/static-memory-fence.test.ts"],"expected":0}}
    ],
    "escalation":{"onUncertainty":"ask-parent","budgetCap":150000}
  }
}
```

### T3.5 — Session index hash + trigram backfill robustness

```json
{
  "id": "SessionIndexHash",
  "description": "size+mtime 외 content_hash로 reindex 판단, trigram backfill은 missing rowid 기반",
  "assignment": "nexus_session_messages 테이블에 content_hash 컬럼 추가 (SQLite ALTER + 마이그레이션). indexNexusSessionFile: hash 비교로 skip 결정. ensureTrigramBackfill을 'INSERT ... WHERE id NOT IN (SELECT rowid FROM trigram_fts)' 로 변경. 신규 테스트: (1) 같은 size로 내용만 바뀐 파일 reindex (2) 부분 backfill 상태에서 누락 row들 채워짐.",
  "contract": {
    "role": "session-index-freshness",
    "scope":{"include":["packages/coding-agent/src/nexus/session-search.ts","packages/coding-agent/src/nexus/migrations/**","packages/coding-agent/tests/nexus/session-index-freshness.test.ts"],"exclude":[]},
    "inputArtifact":"docs/Phase0/01_gpt.md#P2-session-search-freshness",
    "outputContract":{"mustProduce":["hash col","backfill query","test"]},
    "successCriteria":[
      {"id":"sess-test","check":{"type":"command-exit","argv":["bun","test","packages/coding-agent/tests/nexus/session-index-freshness.test.ts"],"expected":0}}
    ],
    "escalation":{"onUncertainty":"ask-parent","budgetCap":180000}
  }
}
```

### T3.6 — Startup degraded surfaced in doctor

```json
{
  "id": "StartupDegradedSurface",
  "description": "nexusBackend.start()의 maintenance/reindex/knowledge migration 실패를 doctor/status에 노출",
  "assignment": "기존 runtime event 채널을 활용해 'nexus.startup.degraded' event 발행 (이미 있다면 카테고리화). NexusBackend에 getDegradationStatus(): {maintenance, sessionReindex, knowledgeMigration} 추가. CLI: amaze memory doctor 출력에 'Nexus: degraded' 섹션과 원인 항목 노출. 신규 테스트: NexusKnowledgeStore migration를 강제 실패 주입했을 때 getDegradationStatus().knowledgeMigration === 'failed' 이고 doctor stdout에 해당 라인 포함.",
  "contract": {
    "role": "doctor-degraded-surface",
    "scope":{"include":["packages/coding-agent/src/nexus/**","packages/coding-agent/src/cli/memory.ts","packages/coding-agent/tests/nexus/startup-degraded.test.ts"],"exclude":[]},
    "inputArtifact":"docs/Phase0/01_gpt.md#P2-startup-degraded",
    "outputContract":{"mustProduce":["degradation status","doctor output","test"]},
    "successCriteria":[
      {"id":"doctor-test","check":{"type":"command-exit","argv":["bun","test","packages/coding-agent/tests/nexus/startup-degraded.test.ts"],"expected":0}}
    ],
    "escalation":{"onUncertainty":"ask-parent","budgetCap":150000}
  }
}
```

## 병렬화

T3.1 ~ T3.6 모두 병렬 가능. 단, T3.2 / T3.6 둘 다 CLI 추가가 있어 `src/cli/index.ts` (command 등록) 동시 수정 시 충돌 위험 → IRC 로 우선순위 조율. T3.2 가 owning, T3.6 는 등록만 IRC.

## 종료 조건

- 모든 acceptance criteria pass
- `bun run check:ts` 통과
- doc01 P1 항목 (contradiction / skill lifecycle / legacy migration) closed
