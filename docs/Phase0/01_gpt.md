## 재확인 결과

GitHub 기준 최신 `main`은 **초기 릴리스 이후 9커밋 앞서 있고**, 최신 커밋은 `Consolidate memory on Nexus and pay down memory-debt plan`입니다. 커밋 메시지상 주요 변경은 Rockey/Hindsight/legacy memories 제거, `Nexus` 단일 메모리 백엔드화, session-search 포팅, recall fence sanitization, CJK trigram, runtime event/stage stats, embedding drift reindex, online consolidation dedup/debounce, knowledge DB 분리 등입니다. 커밋 메시지에는 `5,352 pass / 0 fail; tsgo clean`도 기록되어 있습니다. 

제가 직접 로컬에서 `clone/test`를 돌리지는 못했습니다. 현재 실행 환경에서 GitHub DNS 해석이 실패해서, **GitHub connector로 최신 파일을 직접 읽는 정적 리뷰**로 진행했습니다.

---

# 총평

방향은 **훨씬 좋아졌습니다.**

이전 상태가 “Rockey/Hindsight/Memories가 공존하는 메모리 다중화”였다면, 지금은 **Nexus를 중심으로 메모리·세션 검색·지식 인덱싱·런타임 이벤트·스킬 후보까지 하나의 control plane으로 묶으려는 구조**가 됐습니다. 특히 `MemoryBackendId = "off" | "nexus"`로 축소되고, resolver도 `memory.backend === "nexus"` 외에는 no-op으로 떨어지는 구조는 매우 좋은 정리입니다.  

다만 “성장하는 에이전트 시스템” 관점에서는 아직 위험한 지점이 있습니다. 가장 큰 문제는 **memory → skill → prompt/action으로 이어지는 자기개선 루프가 너무 빨리 승격된다**는 점입니다. 두 번째는 **uncertain verifier가 completion을 막지 않는 정책**입니다. 세 번째는 **AGENTS.md가 비어 있는 것**입니다.

---

# 좋아진 점

## 1. README/settings drift는 해결됨

이전에는 README와 실제 `.amaze/settings.json` 사이에 compaction 관련 불일치가 있었는데, 현재는 정리됐습니다.

`.amaze/settings.json`은 다음처럼 되어 있습니다.

```json
"compaction": {
  "enabled": false,
  "strategy": "off",
  "idleEnabled": false,
  "continuousDemotion": {
    "enabled": true
  }
},
"memory": {
  "backend": "nexus"
}
```

그리고 README도 checked-in defaults에서 `compaction.enabled = false`, `compaction.strategy = "off"`, `memory.backend = "nexus"`라고 설명합니다.  

이건 좋은 수정입니다. 에이전트 시스템에서 문서/설정 drift는 실제 버그보다 더 위험할 수 있습니다. 지금은 적어도 profile-level README와 settings가 일치합니다.

---

## 2. Memory backend 단일화는 올바른 방향

`settings-schema.ts`에서 `memory.backend`는 이제 `off | nexus`만 허용합니다. Nexus 관련 설정도 `autoRecall`, `knowledge.enabled`, `sessionSearchMaxAnchors`, `pipeline.enabled`, `healing.enabled`, `onlineConsolidation`, `llm`, `embeddings`, `vector`, `reranker` 등으로 잘 분해되어 있습니다. 

`resolveMemoryBackend`도 단순합니다.

```ts
if (id === "nexus") return nexusBackend;
return offBackend;
```

이 단순성이 중요합니다. runtime이 갈라지지 않고, 후속 평가/telemetry도 한 곳에서 쌓일 수 있습니다. 

---

## 3. Recall fence 보안 개선은 좋음

`stripRecallFences`가 fixpoint loop로 구현되어 있고, `wrapRecallBlock`이 body를 먼저 sanitize한 뒤 정확히 하나의 `<nexus-recall>...</nexus-recall>` pair로 감쌉니다. nested fence bypass를 고려한 설계입니다. 

이건 memory/prompt-injection 방어에서 꽤 중요한 개선입니다.

---

## 4. Session search를 Nexus로 가져온 것도 좋음

`nexus/session-search.ts`는 별도 `nexus-sessions.db`를 사용하고, FTS5와 CJK trigram FTS를 같이 둡니다. prior session anchor를 반환하는 방식도 적절합니다.  

세션 검색이 “메모리 항목”과 섞이지 않고 별도 DB로 분리된 점도 좋습니다. 장기적으로 operational memory, repository knowledge, session recall을 분리해서 다루기 좋아집니다.

---

## 5. Goal verifier는 구조적으로 많이 강해짐

`AcceptanceVerifier`는 `scope-include`, `scope-exclude`, `file-exists`, `command-exit`, `command-output`, `lsp-clean`, `llm-judged`, `manual`을 지원합니다. 특히 command 기반 verifier와 scope guard가 들어간 건 “검증 가능한 위임 시스템”으로 가는 핵심입니다.  

`completeGoalFromTool`도 acceptance criteria가 있으면 verifier를 먼저 돌리고, fail이 있으면 `GoalAcceptanceFailureError`를 throw해서 완료를 막습니다. 

방향은 맞습니다.

---

# 우선순위 높은 문제

## P0 — `AGENTS.md`가 비어 있음

현재 `AGENTS.md`는 빈 파일입니다. GitHub에서 읽은 최신 내용이 `""`이고, empty blob SHA입니다. 

이건 바로 고쳐야 합니다.

이 리포는 에이전트 런타임이고, 이제 Nexus/goal/verifier/subagent/knowledge-indexing까지 복잡해졌습니다. 그런데 루트의 에이전트용 운영 헌법이 비어 있으면, 외부 코딩 에이전트나 자체 subagent가 repo conventions를 안정적으로 못 잡습니다.

최소한 아래 내용은 들어가야 합니다.

```md
# AGENTS.md

## Mission

Amaze is a compact coding-agent runtime. Optimize for verified work, not verbose narration.

## Required verification

- Run `bun run check:ts` before claiming TypeScript correctness.
- Run relevant tests before marking implementation complete.
- Prefer deterministic acceptance criteria over manual or LLM-judged criteria.
- Never mark a goal complete when deterministic checks fail.
- Treat memory as guidance, not authority.

## Local commands

- Install: `bun install`
- Dev CLI: `bun run dev`
- TS check: `bun run check:ts`
- Full check: `bun run check`
- TS tests: `bun run test:ts`
- Full tests: `bun run test`

## Architecture notes

- Memory backend is Nexus or off only.
- Legacy Rockey/Hindsight/Memories are removed.
- Subagent work should use structured contracts when scope/risk is non-trivial.
- Goal completion should include acceptance criteria whenever possible.

## Failure protocol

- Reproduce first.
- Add or update a deterministic test/eval if possible.
- Write memory only for durable lessons.
- Promote skills only after repeated verified success.
```

현재 상태에서 `AGENTS.md` empty는 **명백한 회귀**입니다.

---

## P1 — `uncertain` verifier가 pass verdict로 처리됨

`AcceptanceVerifier`의 설계 주석은 `uncertain`이 completion을 block하지 않는다고 명시합니다. `summarize()`도 `failedCount > 0`일 때만 fail이고, `uncertain`만 있으면 verdict는 pass입니다.  

`completeGoalFromTool`도 같은 정책입니다. fail은 completion을 막지만, uncertain은 “surface as info but do NOT block”이라고 되어 있습니다. 

이건 개발 편의성은 좋지만, 운영 품질 관점에서는 위험합니다.

예를 들어 acceptance criteria가 아래처럼 구성되면:

```yaml
- llm-judged: architecture quality
- manual: product acceptance
- lsp-clean
```

그런데 `llmJudge`가 연결되지 않고 `lspDiagnostics` provider도 없으면, 중요한 항목들이 전부 `uncertain`으로 떨어질 수 있습니다. 그래도 fail이 없으면 goal complete가 됩니다.

### 권장 수정

`uncertain` 정책을 모드화하세요.

```ts
type UncertainPolicy =
  | "allow"
  | "warn"
  | "block-manual"
  | "block-all";
```

그리고 profile 설정에 넣는 게 좋습니다.

```yaml
goal:
  uncertainPolicy: block-manual
```

추천 기본값:

| 환경                               | 추천             |
| -------------------------------- | -------------- |
| local exploratory coding         | `warn`         |
| daily-driver professional coding | `block-manual` |
| CI/eval/nightly                  | `block-all`    |

즉, **uncertain은 개발 중에는 허용하되, “완료 선언”에는 비용을 부과**해야 합니다.

---

## P1 — Nexus contradiction 판정이 너무 공격적임

`NexusStore.#detectTextContradictions()`는 같은 `scopeId::target::memoryType::extractSubjectKey(content)` 그룹 안에서 서로 다른 content를 비교합니다. 그리고 embedding이 양쪽 모두 없으면 `score = 0.85`로 둡니다. 기본 contradiction threshold는 `0.7`입니다.  

즉, embedding이 없는 상태에서 subject key가 같고 content만 다르면 contradiction으로 찍힐 가능성이 큽니다.

예:

```text
"Editor: use hashline for precise edits"
"Editor: run LSP diagnostics after writes"
```

둘 다 subject key가 `editor`로 잡히면, 서로 보완 관계인데 contradiction 후보가 될 수 있습니다.

### 권장 수정

현재 로직:

```ts
else if (!hasA && !hasB) {
  score = 0.85;
}
```

이건 낮춰야 합니다.

추천:

```ts
else if (!hasA && !hasB) {
  score = lexicalContradictionSignal(a.content, b.content);
}
```

그리고 lexical contradiction은 명시적 부정/상반 패턴이 있을 때만 높게 주는 게 좋습니다.

```ts
function lexicalContradictionSignal(a: string, b: string): number {
  const pair = `${a}\n${b}`.toLowerCase();

  const hardSignals = [
    /\bmust\b.*\bmust not\b/,
    /\balways\b.*\bnever\b/,
    /\benabled\b.*\bdisabled\b/,
    /\btrue\b.*\bfalse\b/,
    /사용한다.*사용하지 않는다/,
    /켜야 한다.*꺼야 한다/,
  ];

  return hardSignals.some(re => re.test(pair)) ? 0.75 : 0.35;
}
```

또는 relation을 바로 `contradicts`로 쓰지 말고:

```text
potential_contradiction
```

상태를 둔 뒤, LLM/human/verifier가 확정했을 때만 `contradicts`로 승격하는 게 안전합니다.

---

## P1 — memory에서 skill로 승격되는 경로가 너무 빠름

`NexusStore.#promoteRepeatedSkillCandidates()`는 active memory 중 `workflow`, `skill_candidate`, `command` 타입을 모아서 skill을 만듭니다. 조건도 꽤 느슨합니다. entries가 2개 이상이거나 하나라도 `skill_candidate`면 draft skill을 만들 수 있고, 기존 skill이 있으면 status를 `active`로 업데이트합니다.  

또한 pipeline의 `promoteConceptualSkills()`는 skill candidate entries가 3개 이상이고 LLM이 있으면 JSON으로 `{name, content, sourceMemoryIds}`를 받아 `store.upsertSkill(..., "active")`로 바로 active skill을 만듭니다. 

이건 자기개선 시스템에서 가장 조심해야 할 부분입니다.

메모리는 “guidance, not authority”인데, skill은 “procedure”입니다. 즉, memory가 skill로 승격되는 순간 모델 행동을 더 강하게 유도할 수 있습니다. 특히 `renderSkillMarkdown()`은 generated content를 `SKILL.md`로 씁니다. frontmatter에 `user-invocable: false`, `disable-model-invocation: true`가 있긴 하지만, content 자체는 여전히 prompt surface로 들어갈 여지가 있습니다. 

### 권장 수정

skill lifecycle을 명시적으로 분리하세요.

```ts
type SkillStatus =
  | "candidate"
  | "draft"
  | "eval_pending"
  | "validated"
  | "active"
  | "deprecated"
  | "banned";
```

그리고 자동 승격은 여기까지만 허용하세요.

```text
memory evidence → candidate/draft
```

`active`는 아래 중 하나가 있어야 합니다.

```text
- deterministic eval 통과
- reviewer approval
- human approval
```

즉, `promoteConceptualSkills()`는 `active`가 아니라 `draft` 또는 `eval_pending`으로 써야 합니다.

```ts
store.upsertSkill(scopeId, name, content, sourceIds, "eval_pending")
```

그리고 별도 명령:

```sh
amaze skill validate <name>
amaze skill promote <name>
```

이렇게 가는 게 안전합니다.

---

## P1 — legacy memory migration 설명이 혼동됨

`settings.ts`의 migration comment는 legacy backends가 Nexus migration sources로 import된다고 말합니다. 하지만 현재 `docs/memory.md`는 `memories.enabled` 설정만 `memory.backend`로 바뀐다고 설명하고, 실제 Nexus pipeline은 session JSONL rollout을 source scan 대상으로 삼는 구조입니다.   

즉, 사용자가 보기에는:

```text
rockey/local/hindsight 설정은 nexus로 바뀐다.
그런데 기존 memory graph 데이터가 실제로 import되는지는 불명확하다.
```

이 부분은 반드시 명확히 해야 합니다.

### 권장 수정

둘 중 하나를 선택해야 합니다.

### 선택 A — 실제 importer 제공

```text
Rockey/Hindsight/local memory files → Nexus memory_items
```

명시적인 one-shot migration command:

```sh
amaze memory migrate-legacy --from rockey
amaze memory migrate-legacy --from hindsight
```

### 선택 B — 데이터 import 안 함을 명확히 고지

문서와 comment를 이렇게 바꾸세요.

```ts
// Canonical cutover: legacy backend settings migrate to Nexus.
// Legacy backend data is not imported automatically.
// Prior sessions are reindexed through Nexus session search.
```

지금처럼 “import된다”는 뉘앙스와 “설정만 바뀐다”는 문서가 섞이면, 사용자 입장에서는 memory loss처럼 느낄 수 있습니다.

---

## P2 — session-search index freshness 리스크

`indexNexusSessionFile()`은 기존 row의 `file_mtime_ms === Math.trunc(stat.mtimeMs)`이고 `file_size === stat.size`이면 reindex를 건너뜁니다. 

대부분은 괜찮지만, 같은 size로 빠르게 파일이 바뀌면 stale index 가능성이 있습니다. 특히 session JSONL은 append 위주라 size가 바뀌는 경우가 많아 현실적 위험은 낮지만, 그래도 session rewrite/compaction/export가 들어가면 문제가 될 수 있습니다.

또 `ensureTrigramBackfill()`은 trigram table에 row가 하나라도 있으면 backfill을 건너뜁니다. 과거 partial backfill 상태가 생기면 누락분이 유지될 수 있습니다. 

### 권장 수정

mtime+size 대신 checksum을 쓰거나, 최소한 indexed row count를 비교하세요.

```ts
if (
  current &&
  current.file_size === stat.size &&
  current.content_hash === sha256(file)
) return false;
```

trigram backfill은:

```sql
INSERT INTO nexus_session_fts_trigram(rowid, content)
SELECT id, content
FROM nexus_session_messages
WHERE id NOT IN (
  SELECT rowid FROM nexus_session_fts_trigram
);
```

형태가 안전합니다.

---

## P2 — FTS advanced query가 암묵적으로 켜져 있음

`escapeFts5Query()`는 query에 `OR|AND|NOT|NEAR`가 있으면 raw query를 그대로 반환합니다. 

SQL injection은 아닙니다. parameter binding을 쓰고 있으니까요. 하지만 FTS syntax error나 의도치 않은 search semantics가 생길 수 있습니다. 특히 사용자가 자연어로 “A AND B”라고 입력했을 때 advanced FTS로 해석됩니다.

### 권장 수정

기본은 항상 quote하고, advanced FTS는 명시 옵션으로만 켜세요.

```ts
function escapeFts5Query(query: string, advanced = false): string {
  if (advanced) return query;
  return `"${query.replace(/"/g, '""')}"`;
}
```

---

## P2 — top-level `test:ts`가 `--only-failures`임

`package.json`에서 top-level `test:ts`는 다음입니다.

```json
"test:ts": "bun run --workspaces --if-present test -- --only-failures"
```

그리고 `test`는 `test:ts`와 `test:rs`를 병렬 실행합니다. 

이게 의도된 daily-driver 최적화라면 괜찮습니다. 하지만 CI/full regression의 기본값으로는 위험합니다. 최신 커밋 메시지에는 5,352 pass라고 되어 있지만, repo script만 보면 “전체 테스트”와 “최근 실패 테스트만”의 경계가 흐립니다. 

### 권장 수정

분리하세요.

```json
"test:ts": "bun run --workspaces --if-present test",
"test:ts:failed": "bun run --workspaces --if-present test -- --only-failures",
"ci:test:full": "bun run test:ts && bun run test:rs"
```

개발 중 빠른 루프는 `test:ts:failed`로 두면 됩니다.

---

## P2 — startup maintenance 실패가 너무 조용함

`nexusBackend.start()`는 startup maintenance 실패를 runtime event로 기록하고 debug log만 남긴 뒤 agent loop를 계속 진행합니다. session bootstrap reindex 실패도 마찬가지로 runtime event/debug log 후 계속 진행합니다. 

“메모리 때문에 agent loop가 깨지면 안 된다”는 원칙은 맞습니다. 하지만 사용자 입장에서는 Nexus가 켜져 있다고 생각하는데 실제로는 degraded 상태일 수 있습니다.

### 권장 수정

non-blocking은 유지하되, UI/status/doctor에 노출하세요.

```text
Nexus: degraded
- startup maintenance failed
- session reindex failed
- knowledge index stale
```

이미 runtime events와 doctor/stage stats를 만들고 있으니, 이걸 status-line이나 `/memory doctor`에서 더 강하게 surface하면 됩니다.

---

## P2 — static memory summary도 trust boundary가 필요함

`buildDeveloperInstructions()`는 `memory_summary.md`들을 읽어서 `## Memory` 섹션으로 system prompt에 붙입니다. “Memory is durable context, not authority” 문구는 좋습니다. 

다만 recall block은 fence로 감싸지만 static summary는 fence 없이 developer instructions에 들어갑니다. memory content가 summary artifact를 통해 prompt surface로 들어가는 경로라면, 여기도 더 강한 boundary가 좋습니다.

### 권장 수정

static memory도 다음 중 하나로 처리하세요.

```text
<nexus-memory-summary>
...
</nexus-memory-summary>
```

또는 최소한 body에 `stripRecallFences`와 instruction-like content sanitizer를 적용하세요.

---

# 세부 코드 리뷰 메모

## `settings-schema.ts`

상단 주석에 `Unified settings schema - single source of truth for all settings.`가 중복되어 있습니다. 사소하지만 정리하면 좋습니다. 

또한 schema default는 upstream default이고 `.amaze/settings.json`은 profile override입니다. 예를 들어 schema의 `compaction.enabled` default는 `true`, profile은 `false`입니다. 이 자체는 문제는 아니지만, README에서 “profile checked-in defaults”라고 정확히 표현한 건 좋습니다.  

## `nexus/config.ts`

`NexusConfig`에는 `sessionSearchMaxAnchors`는 들어가지만, schema에 있는 `nexus.sessionSearchMaxPreviewChars`는 config interface에 없습니다. session-search 쪽에서 settings를 직접 읽고 있습니다.   

작은 inconsistency입니다. Nexus 설정은 `loadNexusConfig()` 한 곳으로 모으는 편이 좋습니다.

## `knowledge/store.ts`

Knowledge DB 분리는 괜찮습니다. `NexusKnowledgeStore`가 별도 `nexus-knowledge.db`를 열고, 기존 operational DB 안의 knowledge tables를 별도 DB로 migrate하는 루틴도 있습니다.  

다만 `NexusKnowledgeStore` constructor에서 migration failure를 debug log로만 넘깁니다. 이것도 startup degraded event로 남기는 편이 더 좋습니다.

---

# 가장 먼저 고칠 순서

## 1. `AGENTS.md` 복구

이건 바로 해야 합니다. 현재 빈 파일은 agent-native repo에 맞지 않습니다. 

## 2. `uncertainPolicy` 추가

`uncertain`이 pass verdict로 되는 건 설계상 이해되지만, production/default profile에서는 최소 `block-manual`이 필요합니다. 

## 3. contradiction fallback 낮추기

embedding이 없을 때 `score = 0.85`는 너무 강합니다. 이건 false positive를 많이 만들 가능성이 큽니다. 

## 4. skill auto-active 금지

LLM-generated skill은 `active`가 아니라 `draft` 또는 `eval_pending`으로 두세요. 

## 5. legacy migration 문서/주석 정리

데이터 import 여부를 명확히 하세요. 설정 migration과 데이터 migration은 분리해서 써야 합니다.  

## 6. test scripts 분리

`test:ts`와 `test:ts:failed`를 분리하세요. 

---

# 제 판단

이번 변경은 **큰 방향성은 맞습니다.** 특히 Nexus 단일화, verifier 추가, session-search 포팅, recall-fence 보강, knowledge DB 분리는 `amaze`를 “성장하는 에이전트 시스템”으로 만들기 위한 올바른 기반입니다.

하지만 지금 상태에서 가장 위험한 축은 이겁니다.

```text
session transcript
  → Nexus memory
  → self-healing / skill candidate
  → generated SKILL.md
  → active behavior influence
```

이 루프가 너무 빨리 닫히면, 시스템은 “학습”하는 게 아니라 **자기 오염(self-contamination)** 될 수 있습니다.

따라서 다음 설계 원칙을 강하게 추천합니다.

> Memory는 저장할 수 있다.
> Skill은 제안할 수 있다.
> Active policy는 검증 후에만 승격해야 한다.

현재 코드는 이 원칙의 앞 두 단계는 잘 만들었고, 세 번째 단계의 gate가 부족합니다.
그 gate만 추가하면 이번 리팩터링은 상당히 좋은 진전입니다.
