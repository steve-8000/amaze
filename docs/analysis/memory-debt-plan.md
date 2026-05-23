# Nexus 메모리 부채 정리 + Hermes 차용 — 실행 계획

> 입력: `memory-architecture-review.md`
> 범위: Hermes 차용 4건 + Nexus 자체 부채 7건 = **총 11건**
> 목표: 단일 메모리 시스템(Nexus)의 안정성·관측성·UX·보안 동시 강화

## 원칙

1. **단계별 검증 가능**: 각 항목 끝에 `bun run check:ts && bun run test:ts` 그린 + 새 단위 테스트.
2. **마이그레이션 안전**: 스키마 변경은 `CREATE TABLE IF NOT EXISTS` + 기존 DB 호환 + 백필 잡.
3. **회귀 없음**: 각 단계 끝에서 기존 5,322 테스트 통과 유지.
4. **롤백 가능**: 단계별 커밋 분리, 각 커밋 그 자체로 동작.

---

## Phase 1 — Quick Wins (저위험, 즉시 ROI)

스키마 마이그레이션 없음. 외부 LLM/embed 호출 변경 없음.

### 1.1 `<memory-context>` 펜싱 + sanitizer
- **출처**: Hermes B
- **파일**:
  - `nexus/recall-fence.ts` (신규)
  - `memory-backend/nexus-backend.ts` (recall 블록 빌더가 fence 사용)
  - `agent-session.ts` 또는 user message normalize 지점 (사용자 입력 sanitizer)
- **구현**:
  - `<nexus-recall>` … `</nexus-recall>` 펜스로 recall 블록 감쌈
  - 사용자 메시지에서 동일 태그 stripping
- **수락 기준**:
  - 단위 테스트: sanitizer가 `<nexus-recall>` 포함 사용자 입력을 escape/제거
  - recall 블록은 항상 펜스로 감싸짐
- **추정**: ~30 LOC + 테스트 30 LOC

### 1.2 세션 anchor ±1 컨텍스트
- **출처**: Hermes D
- **파일**: `nexus/session-search.ts`, `tools/session-search.ts`, `test/nexus-session-search.test.ts`
- **구현**:
  - `searchNexusSessionAnchors` 결과에 매치 라인의 이전/다음 메시지 row_no 함께 반환
  - tool 응답 텍스트에 `path:prevLine-nextLine` 형태로 노출
- **수락 기준**:
  - 새 테스트: 3턴 세션에서 가운데 메시지가 hit일 때 응답에 ±1 라인 포함
- **추정**: ~20 LOC + 테스트 20 LOC

### 1.3 `memory_relations.relation` DB CHECK 제약
- **출처**: Nexus 자체 #2
- **파일**: `nexus/store.ts` (DDL), 마이그레이션 헬퍼
- **구현**:
  - SQLite는 기존 테이블에 CHECK 추가 불가 → 새 테이블 `memory_relations_v2` 생성, 데이터 복사, 이름 교체
  - 신규 DB는 처음부터 CHECK 포함
  - 또는: BEFORE INSERT 트리거로 enum 검증 (덜 침습적)
- **선택**: 트리거 방식 권장 (마이그레이션 위험 ↓)
- **수락 기준**:
  - 단위 테스트: 잘못된 relation 값 insert 시 SQLite error
  - 기존 6개 값은 통과
- **추정**: ~15 LOC + 테스트 25 LOC

### Phase 1 게이트
- `bun run check:ts` 통과
- `bun run test:ts` ≥ 5,325 pass (기존 + 신규 3개 단위)
- 수동: 한 차례 `/memory session-search` 호출해서 ±1 라인 노출 확인

---

## Phase 2 — UX + 관측성 (중위험)

스키마 추가는 있지만 기존 컬럼 변경 없음. 백필 잡 1회 실행.

### 2.1 세션 검색 CJK 트라이그램 폴백
- **출처**: Hermes C
- **파일**: `nexus/session-search.ts`, `test/nexus-session-search.test.ts`
- **구현**:
  - 두 번째 FTS5 가상 테이블 `nexus_session_fts_trigram USING fts5(content, tokenize='trigram')`
  - 인덱싱 시 두 인덱스 모두 채움
  - 검색 시 쿼리에서 CJK 검출(`/[\u3040-\u9fff\uac00-\ud7af]/`):
    - 토큰 ≥3자: trigram FTS
    - 토큰 <3자: LIKE 폴백 (`%query%`)
  - 영문은 기본 FTS5 유지
- **마이그레이션**: 기존 `nexus-sessions.db` 열 때 trigram 테이블 부재 시 `CREATE` + 기존 메시지 백필 (가벼움 — 세션 인덱스만)
- **수락 기준**:
  - 한국어 단어 (`"메모리"`, `"검색"`) 검색 시 hit
  - 영문 검색 결과 회귀 없음
- **추정**: ~50 LOC + 테스트 40 LOC

### 2.2 스킬 사용 텔레메트리 사이드카
- **출처**: Hermes A
- **파일**:
  - `extensibility/skill-usage.ts` (신규)
  - `extensibility/skills.ts` (활성화 시점 훅)
  - `modes/controllers/input-controller.ts` 또는 `acp-agent.ts` (slash 실행 지점)
- **구현**:
  - `<agentDir>/skills/.usage.json` 단일 파일 (스킬 수 ~16)
  - 스키마: `{ [skillName]: { use_count, view_count, last_used_at, last_viewed_at, created_at } }`
  - atomic write (tmp + rename)
  - `/skill:<name>` 활성화 시 `bumpUse(name)` 호출
- **수락 기준**:
  - 단위 테스트: bumpUse 3회 → use_count=3
  - 동시성: 같은 스킬 병렬 호출 시 손실 없음 (file-lock 또는 read-modify-write 트랜잭션)
- **추정**: ~80 LOC + 테스트 50 LOC

### 2.3 단계별 latency/cost 카운터
- **출처**: Nexus 자체 #6
- **파일**: `nexus/store.ts` (memory_jobs 컬럼 추가), `nexus/pipeline.ts` (각 stage 계측)
- **구현**:
  - `memory_jobs`에 `stage TEXT, duration_ms INTEGER, llm_calls INTEGER, embed_calls INTEGER, started_at, finished_at` 추가
  - `ingestRollouts/backfillEmbeddings/runSelfHealing/verifyHypotheses/promoteConceptualSkills/reflect/renderArtifacts` 각각 한 row
  - `nexus/doctor.ts`에서 최근 N개 job 평균/p95 노출
- **마이그레이션**: `ALTER TABLE memory_jobs ADD COLUMN` (SQLite 지원)
- **수락 기준**:
  - 파이프라인 1회 실행 후 `memory_jobs`에 7개 row + 각 stage `duration_ms > 0`
  - doctor가 stage별 통계 렌더
- **추정**: ~70 LOC + 테스트 40 LOC

### Phase 2 게이트
- `bun run test:ts` ≥ 5,330 pass
- doctor 출력에 stage 통계 표시 (수동 확인)

---

## Phase 3 — 정합성 + 운영성 (스키마 추가)

### 3.1 구조화 이벤트 싱크
- **출처**: Nexus 자체 #1
- **파일**: `nexus/store.ts` (memory_events 활용), `nexus-backend.ts`, `pipeline.ts`, `session-search.ts`
- **구현**:
  - `recordMemoryEvent(kind, severity, message, context?)` 헬퍼 (`store.ts` 추가)
  - `kind`: `pipeline_failure | search_fallback | online_consolidation_failure | session_index_failure | …`
  - `severity`: `info | warn | error`
  - 기존 `logger.debug("X failed", { error })` 패턴 → `recordMemoryEvent("X_failure", "warn", String(error))` + `logger.debug`
  - doctor에 최근 N개 이벤트 렌더
- **수락 기준**:
  - 강제로 임베딩 실패 유도 → memory_events 테이블에 row + doctor 출력에 표시
- **추정**: ~120 LOC (다수 catch 블록 치환) + 테스트 50 LOC

### 3.2 임베딩 모델 버전 드리프트
- **출처**: Nexus 자체 #4
- **파일**: `nexus/store.ts`, `nexus/pipeline.ts:backfillEmbeddings`
- **구현**:
  - `backfillEmbeddings` 진입 시 현재 설정 모델 ID 확인
  - `memory_items` WHERE `embedding_model != currentModel OR embedding IS NULL` 쿼리
  - 백필 시 우선순위: NULL 먼저, 그 다음 stale model
  - `recordMemoryEvent("embedding_model_drift", "info", { from, to, count })`
- **수락 기준**:
  - 테스트: 설정에서 모델 변경 → 다음 startup에서 재임베딩 트리거
- **추정**: ~40 LOC + 테스트 50 LOC

### 3.3 Online consolidation 중복 방지
- **출처**: Nexus 자체 #7
- **파일**: `memory-backend/nexus-backend.ts:onTurnEnd`
- **구현**:
  - `sourceRecordId` = `${sessionId}:turn:${turnCount}` (timestamp 대신 turn counter)
  - 또는 user+assistant 텍스트의 SHA-256를 sourceRecordId에 반영
  - 디바운스: 직전 consolidation으로부터 `nexus.onlineConsolidation.minIntervalMs` 이내면 스킵
- **선택**: 둘 다 — content hash for dedup, debounce for cost
- **수락 기준**:
  - 동일 user+assistant 페어 두 번 → memory_sources에 1 row만
  - debounce 설정으로 빠른 연속 턴에서 LLM 호출 횟수 감소
- **추정**: ~50 LOC + 테스트 60 LOC

### 3.4 모순 탐지 confidence scoring
- **출처**: Nexus 자체 #5
- **파일**: `nexus/store.ts:runSelfHealing` 의 모순 탐지 섹션
- **구현**:
  - 현재 lexical subject-key 매칭 → confidence 점수 (lexical similarity + embedding cosine + 신뢰도 차이)
  - threshold 아래는 `relation` 추가 안 함 (또는 `proposed` 상태로만 기록)
  - `nexus.contradictionThreshold` 설정 (default 0.7)
- **수락 기준**:
  - "X is fast" vs "Y is fast" (다른 주어) → 모순 등록 안 됨
  - "X is fast" vs "X is slow" → 모순 등록됨
- **추정**: ~60 LOC + 테스트 50 LOC

### Phase 3 게이트
- `bun run test:ts` ≥ 5,335 pass
- 신규 doctor 출력 단면 확인

---

## Phase 4 — 구조적 분리 (고위험, 마지막)

### 4.1 Knowledge vs Operational SQLite 분리
- **출처**: Nexus 자체 #3
- **파일**:
  - `nexus/knowledge/store.ts` (DB path 변경: `nexus.db` → `nexus-knowledge.db`)
  - `nexus/store.ts:getNexusDbPath` 유지 (operational만)
  - 마이그레이션 로직: 기존 `nexus.db`에서 `knowledge_*` 테이블 발견 시 새 DB로 이전 후 원본 drop
- **위험**:
  - 마이그레이션 중 인터럽트 시 데이터 일관성
  - 두 DB의 트랜잭션 분리 — 기존 join 쿼리가 있으면 변경 필요
- **검증 추가**: 검색에서 이미 cross-store인 통합 recall (`renderUnifiedRecallBlock`)가 두 connection 사용하도록 확인
- **수락 기준**:
  - 마이그레이션 idempotent (실행 두 번 안전)
  - 동시 인덱싱 + 메모리 쓰기 시 lock contention 측정 → 분리 전 대비 latency 개선
  - 기존 knowledge 검색 결과 회귀 0
- **추정**: ~150 LOC + 마이그레이션 테스트 100 LOC

### Phase 4 게이트
- 마이그레이션 시나리오 4종 테스트:
  1. 신규 사용자 (양쪽 DB 모두 부재)
  2. 레거시 사용자 (단일 `nexus.db`에 knowledge 포함)
  3. 마이그레이션 중단 후 재실행
  4. 이미 분리된 사용자 (재실행 무해)

---

## 작업 분할 표

| Phase | 항목 | 추정 LOC (src+test) | 의존성 | 위험 |
|---|---|---|---|---|
| 1.1 | recall fence | 60 | — | 낮음 |
| 1.2 | session anchor ±1 | 40 | — | 낮음 |
| 1.3 | relation CHECK 트리거 | 40 | — | 낮음 |
| 2.1 | CJK 트라이그램 | 90 | — | 중간 (마이그레이션) |
| 2.2 | 스킬 텔레메트리 | 130 | — | 낮음 |
| 2.3 | stage 카운터 | 110 | — | 중간 (스키마 추가) |
| 3.1 | 이벤트 싱크 | 170 | 2.3 권장 | 중간 |
| 3.2 | 임베딩 모델 드리프트 | 90 | 3.1 권장 | 중간 |
| 3.3 | online consolidation dedup | 110 | — | 낮음 |
| 3.4 | 모순 confidence | 110 | — | 중간 |
| 4.1 | knowledge DB 분리 | 250 | 3.1 필수 (이벤트로 마이그레이션 추적) | **높음** |

**합계**: 약 1,200 LOC (src+test 포함).

---

## 병렬 가능성

각 Phase 내 항목들은 대부분 독립이라 subagent 병렬 가능:

- **Phase 1**: 1.1 / 1.2 / 1.3 동시 (서로 다른 파일군)
- **Phase 2**: 2.1 / 2.2 / 2.3 동시
- **Phase 3**: 3.1 먼저 → 3.2 / 3.3 / 3.4 동시
- **Phase 4**: 단독, 마지막

---

## 즉시 시작 권고

**다음 액션으로 Phase 1 일괄 처리**를 권장:
- 3 subagent 병렬 (1.1 / 1.2 / 1.3)
- 비용 ~140 LOC, 위험 낮음
- 끝나면 그린 게이트 후 단일 커밋

승인 시 바로 dispatch.
