# 메모리·스킬 아키텍처 리뷰 + Hermes 차용 판단

> 일자: 2026-05-23 (Nexus 단일화 + 세션검색 포팅 직후)
> 입력: amaze Nexus 전체, Hermes skills/memory/session-search/curator 메커니즘, amaze skills surface — 3 explore 병렬

## 1. amaze 메모리·스킬 현재 상태

### 1.1 Nexus (단일 메모리 백엔드)

**스키마 (`nexus/store.ts`, 같은 `nexus.db`)**
- `memory_items`: 엔트리 (scope/source FK, target, category, type, content, provenance, confidence, status, usage 타임스탬프) + **임베딩 인라인** (`embedding BLOB`, `embedding_model`, `embedding_dim`) (`store.ts:171-195`). 별도 임베딩 테이블 없음.
- `memory_relations`: `(from_id,to_id,relation)` PK — `supports/contradicts/supersedes/duplicate_of/generalizes/specializes`. **CHECK 제약 없음** (`store.ts:215-222`).
- `memory_hypotheses`: `proposed/accepted/rejected/expired`, JSON 문자열 `supporting_memory_ids`.
- `memory_scopes`, `memory_sources` (checksum UNIQUE), `memory_events`, `memory_jobs`, `memory_usage`, `memory_skills`.
- `memory_fts`: FTS5 가상 테이블 + insert/update/delete 트리거.
- 인덱스: scope+target 활성 컨텐츠 유니크, scope/usage/target/category.

**별도 DB**
- `nexus.db`의 knowledge 네임스페이스: `knowledge_documents`, `knowledge_chunks`, `knowledge_chunks_fts`, `knowledge_symbols` (`knowledge/store.ts:467-535`).
- `nexus-sessions.db` (분리 파일): 세션 anchor FTS5 (`session-search.ts:191-220`).

**파이프라인 (`pipeline.ts:102-124`)**
```
ingestRollouts → backfillEmbeddings → runSelfHealing
→ verifyHypotheses → promoteConceptualSkills → reflect → renderArtifacts
```
- 모든 단계가 명시적 예산(`maxLlmCalls`, `maxEmbedCalls`, `maxRolloutsPerRun`).
- LLM/embed 실패 시 결정론적 폴백 (regex 휴리스틱 추출).

**런타임 훅 (`nexus-backend.ts`)**
- `start()`: 백그라운드 startup maintenance (파이프라인) + 부트스트랩 `reindexNexusSessions`.
- `beforeAgentStartPrompt()`: goal-conditioned 자동 recall (operational + knowledge) → 통합 블록 주입.
- `onTurnEnd()`: 현재 세션 증분 인덱싱 (항상) + `onlineConsolidation` (gated, 부모 턴만).
- `preCompactionContext()`: compaction 직전 최신 user 쿼리로 recall.

**검색 (`store.ts:455-611`)**
- 하이브리드: FTS5 rank + 코사인 유사도 + confidence/goal 부스트.
- 폴백 사다리: hybrid → FTS-only → LIKE.

### 1.2 amaze 스킬 시스템 (`extensibility/skills.ts`)

**중요한 사실**: **amaze는 스킬을 변이하지 않는다**. 코드베이스 전체에 SKILL.md 자동 생성·수정 경로 없음 (`helpers.ts:318-341` 읽기 전용 스캔만).

**포맷**: `SKILL.md` YAML frontmatter (`name`, `description`) + markdown 본문. 지원 파일은 같은 디렉토리 (예: `ideate/{frameworks,refinement-criteria,examples}.md`, `ideate/scripts/idea-refine.sh`).

**디스커버리 (`discovery/{builtin,codex,claude,opencode}.ts`)**:
- 공통 `scanSkillsFromDir()` (`discovery/helpers.ts:301-339`).
- `gemini`는 스킬 capability 미구현.
- 중복 제거: realpath dedupe + 이름 충돌 경고 (`extensibility/skills.ts:181-186`).

**활성화**:
- 슬래시 `/skill:<name>` (`extensibility/skills.ts:285-287`).
- 호출 시 SKILL.md 읽고 frontmatter 제거 후 `skill-prompt` 메시지로 대화에 주입 (`acp-agent.ts:707-714`, `input-controller.ts:435-467`).

**관측성 부재**: 스킬 사용 빈도/결과 텔레메트리 없음.

---

## 2. Hermes 비교: 스킬·메모리 메커니즘

| 차원 | Hermes | amaze | 설계 의도 |
|---|---|---|---|
| 스킬 자동 생성 | 백그라운드 리뷰 포크가 자동 생성 (`background_review.py:50-121` 정책) | 없음 | amaze는 verifier/contract로 구조적 학습 |
| 스킬 자동 수정 | `skill_manage create/edit/patch` + provenance 게이트 | 없음 | 같음 |
| 큐레이션 | `curator.py:1369` 결정론적 stale/archive/reactivate + LLM 리뷰 (`agent_created`만) | `runSelfHealing` (중복 축소, 모순 표시, 양자 격리) | Hermes는 스킬 중심, Nexus는 엔트리 중심 |
| 스냅샷·롤백 | `curator_backup.py` pre-mutation 스냅샷 | **없음** | Nexus self-healing이 LLM 판단 활용 — 실수 시 복구 불가 |
| 텔레메트리 | `.usage.json` 사이드카 (`use/view/patch_count`, 타임스탬프) | **없음** | Nexus는 `memory_usage` 테이블 사용 (엔트리만, 스킬은 X) |
| 메모리 주입 | `<memory-context>` XML fencing + sanitizer (`memory_manager.py:38-59`) | unified-recall 블록 (fence 없음) | amaze가 더 취약: 사용자 텍스트가 가짜 메모리 컨텍스트 흉내 가능 |
| 외부 메모리 | 1슬롯 abstraction (Honcho 등) | 없음 (Nexus 단일) | amaze는 외부 의존 회피 |
| 세션 검색 | FTS5 → 트라이그램(CJK) → LIKE 사다리 + ±1 컨텍스트 (`hermes_state.py:2113-2411`) | FTS5만, anchor 1줄 | amaze가 한국어 단문 쿼리에 취약 |
| Idle 게이트 | `curator.min_idle_hours` (`curator.py:1765-1777`) | 없음 (turn-end마다 실행) | 지연 발생 |

---

## 3. Hermes에서 차용할 만한 것 — 판단별

### ✅ 채택 (구체적 이득 + 작은 비용)

#### A. 스킬 사용 텔레메트리 (`.usage.json` 사이드카 패턴)
- **현재**: amaze는 스킬 호출 빈도/시간/패턴을 전혀 모름.
- **포팅 형태**: 슬래시 `/skill:<name>` 활성화 시 `extensibility/skills.ts`에서 사이드카 파일에 `use_count`, `last_used_at` 기록. SQLite보다 파일이 가벼움 (스킬별 독립).
- **이유**: 추후 어느 스킬이 죽었는지, 어느 게 자주 쓰이는지 보고 수동 큐레이션 가능. 비용 ~50 LOC.
- **참고**: Hermes `skill_usage.py:310-317`.

#### B. `<memory-context>` 명시적 펜싱 + sanitizer
- **현재**: `nexus-backend.ts:330-363`의 unified recall 블록이 평문으로 시스템 프롬프트에 박힘. 사용자가 같은 형식의 텍스트 보내면 어시스턴트 혼동 가능.
- **포팅**: `<memory>` … `</memory>` 또는 `<nexus_recall>` 펜스 + 사용자 메시지에서 그 태그 escape/strip.
- **이유**: prompt injection 방어. Hermes의 `memory_manager.py:38-59` 패턴이 amaze에 직접 적용 가능.
- **참고**: Hermes `<memory-context>` + sanitizer.

#### C. 세션 검색 CJK 트라이그램 폴백
- **현재**: `nexus/session-search.ts`는 FTS5 기본 토크나이저만. 한국어 짧은 단어(≤2자)는 검색 누락.
- **포팅**: 두 번째 FTS5 가상 테이블 `nexus_session_fts_trigram USING fts5(content, tokenize='trigram')`. CJK 검출 시 트라이그램 인덱스 사용, 짧은 토큰은 LIKE 폴백.
- **이유**: 운영자가 한국어 사용. 현재 시스템에서 한글 단어 검색 시 0건 위험.
- **참고**: Hermes `hermes_state.py:2240-2354`.

#### D. 세션 검색 anchor에 ±1 컨텍스트 메시지 포함
- **현재**: `searchNexusSessionAnchors`는 hit 라인 1개만 반환 (`session-search.ts:140-148`).
- **포팅**: 매치된 라인 + 이전·다음 메시지 라인 번호도 함께 반환. tool 응답에서 사용자가 `read`로 후속 조회 안 해도 맥락 파악 가능.
- **이유**: 검색 UX 즉시 개선. ~20 LOC.
- **참고**: Hermes `hermes_state.py:2355-2411`.

### 🟡 조건부 채택 (트리거가 생기면 즉시 도입)

#### E. Provenance 게이트 + 스냅샷/롤백
- **트리거**: amaze가 자동 메모리 변이(현재 `runSelfHealing`이 LLM 판단으로 중복 병합·모순 표시함) 강도를 더 높이거나, 자동 스킬 생성을 도입할 때.
- **포팅 형태**: `memory_items`에 `provenance` 컬럼 이미 있음(`store.ts:171-195`) — `system/agent_curation/user_explicit` 값으로 라벨링하고, self-healing 수정 시 `system_modified` 마킹. + 큐레이션 실행 전 SQLite `VACUUM INTO` 스냅샷.
- **이유**: 지금은 self-healing 부작용 회복 불가. 큐레이션 강화 전에 안전망 필요.
- **참고**: Hermes `skill_provenance.py:68-76`, `curator_backup.py`.

#### F. Idle 게이트 (`min_idle_hours`)
- **트리거**: `onTurnEnd`의 online consolidation이 응답 latency 영향을 측정 가능하게 줄 때.
- **포팅 형태**: `nexus.onlineConsolidation.minTurnGapSeconds` 같은 디바운스 설정.
- **이유**: 현재는 모든 부모 턴 끝마다 LLM/embed 호출. 빠른 연속 턴에서 누적 비용 큼.

### ❌ 거부 (철학적 불일치 또는 amaze 스코프 외)

#### G. 백그라운드 리뷰 포크 + 스킬 자동 생성
- **거부 이유**: amaze의 핵심 베팅은 **"자기개선이 프롬프트가 아니라 코드 구조"** (verifier + contract + acceptance criteria). Hermes의 `background_review.py:50-121` 프롬프트 정책은 모델 드리프트에 직격당함. amaze는 이걸 의도적으로 안 함.
- **대안**: 사용자가 verifier 기준을 명시하고, goal mode가 강제 — 이미 보유.

#### H. 외부 메모리 프로바이더 abstraction (Honcho 슬롯)
- **거부 이유**: 사용자가 "Nexus 단일 메모리로 간다" 명시. 외부 프로바이더 도입 시점이 안 보이는 한 추상화 비용만 들어옴.

#### I. 큐레이터 LLM 리뷰 루프
- **거부 이유**: Nexus `runSelfHealing` (`store.ts:815-1103`)이 이미 결정론적 중복 축소·모순 표시·스킬 promotion 수행. LLM 리뷰는 비결정성만 추가.

#### J. SKILL.md 변이 (`skill_manage`)
- **거부 이유**: amaze 스킬은 사람이 작성한 문서. 자동 패치 도입 시 G와 같은 함정.

---

## 4. Hermes와 무관한 Nexus 자체 부채 (orthogonal)

이번 explore 과정에서 나온, Hermes와 별개로 amaze가 직접 해결해야 할 항목:

1. **에러 swallowing 일관화**. 다수 catch 블록이 `logger.debug`로만 끝남 (`nexus-backend.ts:33,194`, `store.ts:468-470`, `session-search.ts:161-162`). 구조화된 이벤트 싱크(`memory_events` 테이블 활용)로 운영자가 보이게.
2. **`memory_relations.relation` DB-level CHECK 제약** 추가 — `NexusRelationKind` 6값으로 enforcement (`store.ts:215-222`).
3. **knowledge vs operational SQLite 분리** 검토. 현재 같은 `nexus.db`에서 둘 다 쓰기 — 무거운 knowledge 인덱싱 시 operational write contention 가능 (`knowledge/store.ts:175-177`).
4. **임베딩 모델 버전 드리프트 추적**. `memory_items.embedding_model` 컬럼 이미 있음 — 모델 바뀔 때 자동 재임베딩 트리거 없음.
5. **모순 탐지 휴리스틱 약함**. `store.ts:1076-1097`이 lexical subject-key 기반 — false positive 가능. confidence scoring 또는 검토자 큐 추가.
6. **단계별 latency/cost 카운터**. `memory_jobs` 테이블에 stage별 소요 시간 기록 → doctor에서 노출.
7. **온라인 consolidation source_record_id 중복** — 현재 timestamp 기반. 인접 턴에서 near-duplicate source row 발생 가능 (`nexus-backend.ts:185`, `store.ts:657-666`).

---

## 5. 우선순위 권고 (ROI 순)

| 순위 | 항목 | 비용 | 이득 |
|---|---|---|---|
| 1 | B. `<memory-context>` 펜싱 + sanitizer | XS (~30 LOC) | 보안 (prompt injection 방어) |
| 2 | C. 세션 검색 CJK 트라이그램 | S (~50 LOC + 마이그레이션) | UX (한국어 검색 실효) |
| 3 | D. 세션 anchor ±1 컨텍스트 | XS (~20 LOC) | UX |
| 4 | A. 스킬 사용 텔레메트리 | S (~80 LOC + 사이드카 포맷) | 관측성 (수동 큐레이션 근거) |
| 5 | 자체 #1: 구조화 이벤트 싱크 | M | 운영성 |
| 6 | 자체 #2: relation CHECK 제약 | XS | 정합성 |
| 7 | E. provenance + 스냅샷 (조건부) | M | 미래 안전망 |

1–4는 본 세션 또는 다음 세션 한 번에 정리 가능. 5–6은 별도 작업.

---

## 6. 결론

- **Hermes의 메모리·스킬 설계는 amaze보다 풍부하지만, 핵심 차별인 "프롬프트로 자기개선" 부분은 amaze 철학과 정면 충돌**. 그 부분은 거부.
- **차용 가치가 있는 것은 4개 (B/C/D/A)**: 모두 작은 비용, 구체적 이득. 결정론적이고 amaze 구조와 충돌 없음.
- **조건부 2개 (E/F)**: 자동 변이 강도를 높일 때 동반 도입.
- **Nexus 자체 부채 7개**는 Hermes와 무관 — 별도 정리 필요.

승인 시 1–4를 묶어 다음 세션에서 정리할 수 있음.
