아래처럼 **Amaze vNext: Cache-Native Agent OS**로 설계하는 게 맞습니다.

# 1. 제품 정의

Amaze는 현재 **compact orchestrator + bounded subagents + Nexus memory + Mission Control** 구조입니다. README도 top-level agent는 작게 유지하고, 세부 작업은 scoped subagent로 위임한다고 설명합니다. ([GitHub][1])

완성형은 여기서 한 단계 더 갑니다.

> **Amaze는 텍스트 컨텍스트를 매번 재조립하는 agent runtime이 아니라, stable context / prompt cache / local retrieval / optional local KV를 통합 관리하는 Cache-Native Agent OS가 되어야 합니다.**

즉 목표는 이것입니다.

```text
비싼 모델에게 매번 긴 컨텍스트를 다시 먹이지 않는다.
로컬 하드웨어는 "추론 본체"가 아니라 "context compiler + cache broker + evidence engine"으로 쓴다.
Claude/Codex는 최종 판단·패치·고난도 reasoning에만 쓴다.
```

---

# 2. 최상위 아키텍처

```text
┌─────────────────────────────────────────────────────────────────────┐
│                         Amaze Runtime                               │
│                                                                     │
│  ┌─────────────────────┐       ┌────────────────────────────────┐   │
│  │ Compact Orchestrator │──────▶│ Mission Kernel                 │   │
│  │ goal / plan / verify │       │ objective, budget, evidence    │   │
│  └─────────────────────┘       └────────────────────────────────┘   │
│            │                                      │                  │
│            ▼                                      ▼                  │
│  ┌─────────────────────┐       ┌────────────────────────────────┐   │
│  │ Context Compiler     │──────▶│ Cache Broker                   │   │
│  │ stable/dynamic split │       │ provider cache + local cache   │   │
│  └─────────────────────┘       └────────────────────────────────┘   │
│            │                                      │                  │
│            ▼                                      ▼                  │
│  ┌─────────────────────┐       ┌────────────────────────────────┐   │
│  │ Subagent Scheduler   │──────▶│ Provider Router                │   │
│  │ cache-aware routing  │       │ Codex / Claude / vLLM / Ollama │   │
│  └─────────────────────┘       └────────────────────────────────┘   │
│            │                                      │                  │
│            ▼                                      ▼                  │
│  ┌─────────────────────┐       ┌────────────────────────────────┐   │
│  │ Evidence Engine      │◀──────│ Tool Execution Layer           │   │
│  │ traces/cards/diffs   │       │ repo tools / MCP / browser     │   │
│  └─────────────────────┘       └────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

# 3. 핵심 설계 원칙

Amaze의 현재 prompt caching 설계는 이미 좋은 출발점입니다. `docs/v2-prompt-caching.md`는 system prompt를 `STABLE_CORE`와 `DYNAMIC_TAIL` 두 블록으로 나누고, `STABLE_CORE`는 turn-to-turn 변하지 않는 cache 대상, `DYNAMIC_TAIL`은 cwd/date/workspace tree/goal 같은 volatile context로 둔다고 설명합니다. ([GitHub][2])

완성형에서는 이걸 **전 runtime의 기본 단위**로 승격해야 합니다.

```text
STABLE_CORE      = 거의 안 바뀌는 실행 헌법
PROJECT_CORE     = 프로젝트별 고정 지식
ROLE_CORE        = subagent role별 고정 지식
MISSION_TAIL     = 현재 목표/예산/승인/상태
EVIDENCE_TAIL    = 이번 작업에서 새로 생긴 증거
TOOL_DELTA       = 도구 실행 결과
USER_DELTA       = 이번 사용자 요청
```

현재 구조:

```text
system prompt = [STABLE_CORE, DYNAMIC_TAIL]
```

완성형 구조:

```text
context graph =
  stable_core
  + project_core
  + role_core
  + mission_tail
  + evidence_tail
  + tool_delta
  + user_delta
```

---

# 4. Cache Broker 설계

가장 중요한 컴포넌트입니다.

## 4.1 역할

Cache Broker는 다음을 판단합니다.

```text
1. 이 요청은 Claude/Codex provider prompt cache를 탈 수 있는가?
2. 같은 STABLE_CORE hash를 가진 subagent가 이미 실행됐는가?
3. 같은 repo/file/tool result가 로컬에 있는가?
4. 로컬 vLLM/Ollama로 먼저 요약·분석 가능한가?
5. remote model에 보낼 context를 얼마나 줄일 수 있는가?
```

## 4.2 내부 구조

```text
packages/coding-agent/src/cache-broker/
  cache-broker.ts
  cache-policy.ts
  context-fingerprint.ts
  context-manifest.ts
  provider-cache.ts
  local-result-cache.ts
  local-kv-cache.ts
  cache-metrics.ts
  cache-events.ts
```

## 4.3 Context Manifest

모든 agent 호출 전에 manifest를 생성합니다.

```ts
export interface ContextManifest {
  version: 1;

  provider: "openai" | "anthropic" | "vllm" | "ollama";
  model: string;

  stableCoreHash: string;
  projectCoreHash: string;
  roleCoreHash?: string;
  missionTailHash: string;
  dynamicTailHash: string;

  reuseGroupId: string;
  sessionId: string;
  missionId?: string;
  parentAgentId?: string;
  subagentRole?: string;

  estimatedInputTokens: number;
  estimatedStableTokens: number;
  estimatedDynamicTokens: number;

  providerCache: {
    eligible: boolean;
    breakpointIndex?: number;
    retention: "none" | "short" | "long" | "default";
  };

  localCache: {
    resultCacheEligible: boolean;
    repoIndexEligible: boolean;
    kvEligible: boolean;
  };
}
```

이 manifest가 없으면 cache runtime은 blind입니다.
Amaze는 지금 prompt cache hit ratio는 보지만, per-block attribution은 아직 future work로 남아 있습니다. 문서도 현재는 누적 read/write만 보고 어느 STABLE_CORE segment가 miss를 만들었는지 알 수 없다고 적고 있습니다. ([GitHub][2])

따라서 manifest 기반 추적이 필수입니다.

---

# 5. Context Compiler 설계

## 5.1 책임

Context Compiler는 “컨텍스트를 모으는 것”이 아니라 **cache가 잘 먹히는 형태로 정규화**합니다.

```text
입력:
- AGENTS.md
- .amaze/settings.json
- Nexus memory
- mission state
- workspace tree
- tool registry
- skills/rules
- user prompt

출력:
- stable blocks
- dynamic blocks
- manifest
- provider-specific prompt blocks
```

## 5.2 canonical ordering

cache hit를 높이려면 순서가 절대 흔들리면 안 됩니다.

```text
bad:
  files sorted by mtime
  discovered tools arbitrary order
  memory snippets arbitrary similarity order
  timestamp in stable section

good:
  stable docs sorted by path
  tools sorted by stable id
  memory packs versioned
  volatile values only tail
  no timestamp in stable prefix
```

현재 문서도 workspace tree, cwd, date, goal block 같은 volatile 정보가 prompt cache miss를 만들기 때문에 `DYNAMIC_TAIL`로 분리한다고 설명합니다. ([GitHub][2])

## 5.3 출력 형태

```ts
export interface CompiledContext {
  blocks: ContextBlock[];
  manifest: ContextManifest;
  providerHints: ProviderCacheHints;
}

export interface ContextBlock {
  id: string;
  kind:
    | "stable_core"
    | "project_core"
    | "role_core"
    | "mission_tail"
    | "evidence_tail"
    | "tool_delta"
    | "user_delta";

  content: string;
  hash: string;
  cachePolicy: "provider-cache" | "local-only" | "never-cache";
  volatility: "session" | "project" | "role" | "turn" | "tool";
}
```

---

# 6. Provider Router 설계

`.amaze/settings.json`을 보면 현재 기본 모델은 `openai-codex/gpt-5.5`이고, `plan`/`reviewer`는 `anthropic/claude-opus-4-7`, `source_scout`/`memory_scout`는 `vllm/Roy-llm`으로 잡혀 있습니다. 즉 이미 역할별 model routing 기반이 있습니다. ([GitHub][3])

완성형에서는 router가 단순 role mapping이 아니라 cache-aware decision을 해야 합니다.

## 6.1 Routing score

```text
score(provider, model, role) =
  reasoning_fit
  + cache_hit_probability
  + local_result_reuse
  + latency_score
  - expected_cost
  - context_risk
  - privacy_risk
```

## 6.2 Routing policy

```ts
export interface RoutingDecision {
  selectedProvider: string;
  selectedModel: string;
  reason: string[];

  cacheStrategy:
    | "provider_prompt_cache"
    | "local_context_cache"
    | "local_kv"
    | "no_cache";

  executionMode:
    | "remote_reasoning"
    | "local_prepass_then_remote"
    | "local_only"
    | "hybrid_review";
}
```

## 6.3 실제 정책

```text
source_scout / memory_scout:
  기본 local vLLM
  목적: repo/memory 검색, 요약, 후보 정리
  remote 호출 금지 또는 제한

plan / reviewer:
  Claude Opus
  단, Context Compiler가 압축한 evidence pack만 전달

task / quick_task:
  Codex
  stable prefix cache 강제
  patch generation 중심

oracle:
  Codex or Claude
  cache hit 가능성과 난이도 기준 선택
```

---

# 7. Local Hardware 활용 설계

Codex/Claude의 실제 KV cache는 제공자 서버 내부에 있으므로 로컬 GPU에 직접 저장할 수 없습니다.
대신 Amaze에서 로컬 하드웨어는 다음 5개 역할을 해야 합니다.

## 7.1 Repo Indexer

```text
repo → symbols → AST graph → dependency graph → file summaries → embeddings
```

저장 위치:

```text
.amaze/cache/repo-index/
  files.sqlite
  symbols.sqlite
  embeddings/
  summaries/
  dependency-graph.json
```

## 7.2 Tool Result Cache

반복되는 tool 결과를 캐시합니다.

```text
rg/search 결과
AST query 결과
LSP symbol 결과
test failure parse 결과
build error parse 결과
browser QA snapshot
```

이건 remote token을 직접 줄입니다.

## 7.3 Local Scout Agents

`source_scout`, `memory_scout`처럼 이미 설정에 local vLLM role이 있는 구조를 확대합니다. ([GitHub][3])

```text
local scout가 먼저 수행:
  - 관련 파일 후보
  - 관련 심볼 후보
  - 이전 session/memory 후보
  - 실패 로그 요약
  - risk 후보

remote model에게는:
  - 후보 + evidence + patch constraints만 전달
```

## 7.4 Local Critic

모든 remote output을 다시 로컬에서 검증합니다.

```text
remote patch
→ local static check
→ local test selection
→ local reviewer
→ only then apply/commit
```

## 7.5 Optional Local KV

로컬 vLLM/Ollama 계열에 한해서만 KV reuse를 붙입니다.

```text
local model:
  source_scout
  memory_scout
  cheap critic
  summarizer
  test-log analyzer
```

즉 local KV는 Claude/Codex 대체가 아니라, **remote 호출 전 토큰 절감용 전처리 agent**에 씁니다.

---

# 8. Subagent Scheduler 설계

현재 Amaze는 bounded subagent 구조가 강점입니다. README도 subagent가 structured contract를 받고 scope/success criteria/escalation/output requirements를 가진다고 설명합니다. ([GitHub][1])

완성형에서는 subagent scheduler가 다음 정보를 봐야 합니다.

```text
- role
- mission id
- stableCoreHash
- projectCoreHash
- roleCoreHash
- provider/model
- expected cache reuse
- write risk
- mutation scope
- required evidence
```

## 8.1 Scheduling classes

```text
Class A: cache-hot sibling subagents
  같은 STABLE_CORE + 같은 provider/model
  fan-out 가능
  prompt cache read 기대 높음

Class B: local scout subagents
  vLLM/Roy-llm
  repo/memory/tool cache 접근
  remote 호출 전 evidence pack 생성

Class C: mutation subagents
  Codex
  파일 수정 가능
  scope guard 필수

Class D: critique subagents
  Claude or local critic
  write 권한 없음
  evidence 검증 중심
```

## 8.2 KV/cache-aware fanout

```text
사용자 요청:
  "런타임 전체를 깊게 감사해줘"

기존:
  5개 subagent가 각자 긴 prompt를 다시 받음

완성형:
  1. parent가 STABLE_CORE write
  2. siblings가 same stable hash로 실행
  3. local scout가 repo evidence 준비
  4. remote reviewer/task는 evidence pack만 받음
  5. cache read ratio가 낮으면 fanout 중단/재컴파일
```

현재 설정은 `subagentPrefixReuse: true`라서 방향이 맞습니다. ([GitHub][3])

---

# 9. Mission Kernel 설계

Mission Kernel은 단순 session state가 아니라 **비용·증거·cache 상태를 함께 들고 있어야 합니다.**

```ts
export interface MissionKernelState {
  missionId: string;
  objective: string;
  acceptanceCriteria: string[];

  budget: {
    maxInputTokens?: number;
    maxOutputTokens?: number;
    maxCostUsd?: number;
    cacheReadTargetRatio?: number;
  };

  cache: {
    stableCoreHash: string;
    providerCacheReads: number;
    providerCacheWrites: number;
    localCacheHits: number;
    localCacheMisses: number;
    cacheThrashEpisodes: number;
  };

  evidence: {
    cards: EvidenceCard[];
    required: string[];
    missing: string[];
  };

  safety: {
    mutationScopes: string[];
    approvalsRequired: boolean;
    rollbackAnchor?: string;
  };
}
```

Mission Control은 여기에 다음을 보여줘야 합니다.

```text
Mission
  Objective
  Acceptance
  Agent lanes
  Evidence cards
  Decisions
  Verification
  Token/cost
  Cache hit ratio
  Cache thrash warning
  Reused blocks
  Wasted context
```

---

# 10. Evidence Engine 설계

Amaze는 이미 research work를 lanes/evidence/decisions로 모델링한다고 설명합니다. ([GitHub][1])

완성형에서는 모든 agent output이 evidence card로 귀결되어야 합니다.

```ts
export interface EvidenceCard {
  id: string;
  sourceType:
    | "file"
    | "symbol"
    | "test"
    | "tool"
    | "web"
    | "memory"
    | "mission"
    | "subagent";

  sourceRef: string;
  quote?: string;
  summary: string;
  confidence: "low" | "medium" | "high";
  freshness: "current" | "possibly_stale" | "stale";
  producedBy: string;
  hash: string;
}
```

핵심은 이겁니다.

```text
remote model에게 raw context를 던지지 말고
evidence card bundle을 던진다.
```

그러면 token 비용이 줄고, hallucination도 줄어듭니다.

---

# 11. Memory / Nexus 설계

Nexus는 현재 durable user/project/failure/workflow knowledge와 prior session search를 저장하는 active memory backend입니다. ([GitHub][1])

완성형에서는 Nexus를 3계층으로 나눕니다.

```text
Nexus-L1: Session Memory
  현재 mission 내 facts, todos, decisions

Nexus-L2: Project Memory
  architecture decisions, repo invariants, recurring failures

Nexus-L3: Cacheable Memory Pack
  stable prefix에 넣을 수 있는 canonical memory bundle
```

중요한 점:

```text
Nexus 검색 결과를 매번 그대로 prompt에 넣으면 cache가 깨진다.
```

그래서 memory는 이렇게 들어가야 합니다.

```text
stable memory pack:
  versioned
  sorted
  canonical
  infrequently updated

dynamic memory hits:
  tail에만 삽입
  evidence card 형태
```

---

# 12. Codex/Claude 사용 전략

## 12.1 Codex

Codex는 다음에 집중시킵니다.

```text
- patch generation
- codebase-local edit
- test repair
- refactor
- integration
```

Codex 호출 전에는 반드시 local scout가 준비합니다.

```text
Codex input =
  stable core
  role contract
  relevant file bundle
  symbol map
  failing tests
  acceptance criteria
  mutation scope
```

Codex에게 주면 안 되는 것:

```text
- 전체 repo tree dump
- 무제한 session history
- raw logs 전체
- 중복된 memory
```

## 12.2 Claude

Claude는 다음에 집중시킵니다.

```text
- plan
- reviewer
- risk analysis
- architecture critique
- ambiguous design decision
```

Claude input:

```text
stable core
mission objective
evidence cards
candidate decisions
known constraints
```

Claude에게는 patch를 직접 많이 맡기기보다, **판단·리뷰·비판** 역할이 더 좋습니다.

## 12.3 Local vLLM/Roy-llm

```text
- source_scout
- memory_scout
- log summarizer
- context compressor
- duplicate detector
- candidate ranker
```

여기에 local KV/prefix cache를 붙이면 Steve의 Mac Studio/GPU가 살아납니다.

---

# 13. Storage 설계

```text
.amaze/
  cache/
    manifests/
      <mission_id>/<agent_id>.json

    provider/
      prompt-cache-ledger.sqlite

    repo-index/
      files.sqlite
      symbols.sqlite
      deps.sqlite
      summaries/
      embeddings/

    tool-results/
      rg/
      ast/
      lsp/
      tests/
      browser/

    local-kv/
      vllm/
        <model_id>/
          <stable_hash>/
            manifest.json
            blocks/

    context-packs/
      stable-core/
      project-core/
      role-core/
      memory-pack/

  missions/
    <mission_id>/
      mission.json
      evidence.jsonl
      decisions.jsonl
      cache-events.jsonl
      agent-runs.jsonl
```

---

# 14. Runtime Flow

## 14.1 일반 요청

```text
User request
  ↓
Mission Kernel 생성/갱신
  ↓
Context Compiler
  - stable_core hash 계산
  - project_core hash 계산
  - dynamic_tail 생성
  ↓
Cache Broker
  - provider cache 가능성 판단
  - local cache 조회
  - repo index 조회
  ↓
Subagent Scheduler
  - local scout 먼저 실행
  - 필요한 경우 Codex/Claude 호출
  ↓
Evidence Engine
  - 결과를 evidence card로 저장
  ↓
Verifier
  - test/check/lint/security
  ↓
Mission Control 업데이트
```

## 14.2 대형 분석 요청

```text
User: "런타임 전체를 깊게 감사해줘"

1. Orchestrator
   - mission objective 확정
   - acceptance criteria 생성
   - budget 설정

2. Local source_scout
   - repo map
   - subsystem 후보
   - relevant files

3. Fanout
   - prompt-cache-hot subagents
   - runtime audit
   - context audit
   - tool audit
   - scheduler audit
   - memory audit

4. Reviewer
   - subagent outputs cross-check
   - contradiction detection
   - missing evidence detection

5. Codex task
   - concrete patch plan
   - optional patch generation

6. Verifier
   - tests
   - typecheck
   - lint
   - rollback anchor

7. Final
   - evidence-backed report
   - changed files
   - remaining risks
```

---

# 15. API 설계

## 15.1 Cache Broker API

```ts
export interface CacheBroker {
  prepare(input: CachePrepareInput): Promise<CachePlan>;
  recordProviderUsage(usage: ProviderUsage): Promise<void>;
  recordLocalHit(hit: LocalCacheHit): Promise<void>;
  explain(manifestId: string): Promise<CacheExplanation>;
}
```

## 15.2 Cache Plan

```ts
export interface CachePlan {
  manifest: ContextManifest;

  providerHints: {
    systemPromptCacheBreakpointIndex?: number;
    retention: "none" | "short" | "long" | "default";
  };

  localPrepass: {
    required: boolean;
    agents: string[];
    reason: string[];
  };

  contextBudget: {
    stableTokens: number;
    dynamicTokens: number;
    evidenceTokens: number;
    maxRemoteTokens: number;
  };

  warnings: string[];
}
```

## 15.3 Provider Integration

```ts
export interface ProviderRequest {
  model: string;
  systemPrompt: string[];
  messages: Message[];
  cacheHints?: ProviderCacheHints;
  contextManifestId?: string;
}
```

---

# 16. Observability

Amaze 문서는 이미 cache hit ratio segment와 cache thrash warning을 갖고 있다고 설명합니다. ([GitHub][2])

완성형에서는 Mission Control에 아래가 필요합니다.

```text
Cache Dashboard

Provider Prompt Cache:
  write tokens
  read tokens
  hit ratio
  estimated saved cost
  stale/miss reason

Local Cache:
  repo index hits
  tool result hits
  memory pack hits
  local scout compression ratio

Context Health:
  stable_core changed?
  project_core changed?
  dynamic_tail too large?
  memory pack too volatile?
  tool schema order changed?

Agent Efficiency:
  tokens per useful evidence card
  tokens per accepted patch
  cache reads per subagent
  repeated analysis avoided
```

---

# 17. 설정 파일 확장안

현재 `.amaze/settings.json`에는 compact main context, cache retention, subagentPrefixReuse, Nexus memory, role별 model override가 있습니다. ([GitHub][3])

확장형:

```json
{
  "cacheNative": {
    "enabled": true,
    "mode": "hybrid",

    "contextCompiler": {
      "canonicalOrdering": true,
      "stableCoreVersioning": true,
      "dynamicTailBudgetTokens": 1200,
      "evidenceTailBudgetTokens": 4000
    },

    "providerCache": {
      "enabled": true,
      "defaultRetention": "long",
      "requireStableCoreHash": true,
      "warnOnThrash": true
    },

    "localCache": {
      "repoIndex": true,
      "toolResultCache": true,
      "memoryPackCache": true,
      "ttlSeconds": 86400
    },

    "localKv": {
      "enabled": true,
      "providers": ["vllm"],
      "models": ["Roy-llm"],
      "storage": "unified-memory",
      "maxMemoryGb": 24
    },

    "routing": {
      "localPrepassDefault": true,
      "remoteOnlyForHighUncertainty": true,
      "preferCacheHotProvider": true
    }
  }
}
```

---

# 18. 구현 순서

## Phase 1 — Manifest / Observability

목표: 지금 구조를 깨지 않고 cache를 계측 가능하게 만든다.

```text
- ContextManifest 추가
- stable/dynamic block hash 저장
- provider usage ledger 저장
- cache miss reason 기록
- Mission Control에 cache panel 추가
```

성공 기준:

```text
각 agent run마다:
  stableCoreHash
  dynamicTailHash
  provider cache read/write
  cache hit ratio
  miss reason
을 볼 수 있어야 함
```

## Phase 2 — Context Compiler 정식화

```text
- 현재 system-prompt.ts의 STABLE/DYNAMIC 분리를 ContextBlock 모델로 승격
- project_core / role_core / memory_pack 분리
- canonical ordering 강제
- memory pack versioning
```

성공 기준:

```text
동일 mission에서 stable block이 byte-for-byte 유지됨
```

## Phase 3 — Local Repo/Tool Cache

```text
- rg/ast/lsp/test result cache
- repo summary cache
- evidence card generation
- local scout mandatory prepass
```

성공 기준:

```text
remote model input token 30~60% 감소
```

## Phase 4 — Cache-aware Subagent Scheduler

```text
- same stableCoreHash끼리 fanout grouping
- cache-hot provider 우선
- cache thrash 발생 시 fanout 축소
- local scout → remote task pipeline
```

성공 기준:

```text
multi-subagent run에서 provider cache read 비율 상승
```

## Phase 5 — Local KV for vLLM

```text
- vLLM/Roy-llm local prefix reuse
- source_scout/memory_scout stable prefix 고정
- local KV manifest 저장
- hot/warm eviction
```

성공 기준:

```text
local scout latency 감소
remote 호출 전 context compression 품질 유지
```

---

# 19. 핵심 코드 변경 위치

```text
packages/coding-agent
  src/system-prompt.ts
    → ContextBlock 기반으로 리팩터링

  src/task/
    → subagent scheduler에 cache affinity 추가

  src/memory/
    → Nexus memory pack canonicalization 추가

  src/mission/
    → cache metrics/evidence/cost state 추가

  src/status-line/
    → cache panel 확장

packages/ai
  src/providers/anthropic.ts
    → cache hint 유지 + manifest logging

  src/providers/openai.ts
    → provider cache usage ledger 기록

  src/router/
    → cache-aware model routing

new:
  packages/coding-agent/src/cache-broker/
  packages/coding-agent/src/context-compiler/
  packages/coding-agent/src/evidence-engine/
```

---

# 20. 최종 형태

완성형 Amaze는 이렇게 정의됩니다.

```text
Amaze is a cache-native coding-agent operating runtime.

It keeps the parent orchestrator compact,
runs bounded subagents through explicit contracts,
compiles context into stable and dynamic blocks,
routes work by cache affinity and reasoning need,
uses local hardware for search/compression/verification,
uses Codex and Claude only where high-value reasoning is needed,
and records every decision, evidence card, cache event, and rollback anchor
inside Mission Control.
```

## 최종 판단

지금 Amaze는 이미 올바른 방향입니다.
특히 `STABLE_CORE / DYNAMIC_TAIL`, `subagentPrefixReuse`, role-based model overrides, Nexus memory, Mission Control은 이 설계를 붙이기 좋은 기반입니다. ([GitHub][2])

다음 버전의 핵심은 하나입니다.

> **Amaze를 “agent runtime”에서 “cache-native agent OS”로 승격시키는 것.**

이렇게 가면 단순 비용 절감이 아니라, **컨텍스트 폭발을 제어하면서도 여러 agent가 같은 인지 기반을 공유하는 구조**가 됩니다.

[1]: https://github.com/steve-8000/amaze "GitHub - steve-8000/amaze · GitHub"
[2]: https://raw.githubusercontent.com/steve-8000/amaze/main/docs/v2-prompt-caching.md "raw.githubusercontent.com"
[3]: https://raw.githubusercontent.com/steve-8000/amaze/main/.amaze/settings.json "raw.githubusercontent.com"
