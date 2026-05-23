# NousResearch/hermes-agent — 분석

> 클론: `https://github.com/NousResearch/hermes-agent` (Python, ~141MB)
> 분석 일자: 2026-05-23, 오케스트레이터 + 4 explore 병렬

## 요약

- "self-improving agent" 마케팅이 아니라 **실재하는 메커니즘**: skill creation/update, curator, FTS5 세션 검색, 멀티 프로바이더 어댑터가 모두 코드로 구현돼 있음.
- 그러나 **운영 모놀리스**: 단일 파일에 수천~수만 LOC가 응집(`gateway/run.py` ~18k, `hermes_cli/main.py` ~13k, `conversation_loop.py` ~4k, `run_agent.py` ~4k).
- 자기 개선의 **핵심 정책이 프롬프트 텍스트**(`background_review.py:50-121`)에 박혀 있어 모델 교체 시 행동 검증 필요.
- **amaze에 통째로 가져올 가치 없음.** 부분적으로 차용할 만한 아이디어만 추림 (아래 "amaze 관점").

## 실제 코드 매핑

### 턴 런타임
- `agent/conversation_loop.py:232` `run_conversation(...)` — 스트리밍 우선, 인터럽트 전파(메인+툴 워커 TID).
- 4종 프로바이더 어댑터 위로 OpenAI 스타일 캐노니컬 메시지: `chat_completion_helpers.py:248 build_api_kwargs`에서 분기.
  - Anthropic (`anthropic_adapter.py:1964`)
  - Bedrock Converse (`bedrock_adapter.py:493`)
  - Codex Responses (`codex_responses_adapter.py`)
  - OpenAI chat
- 에러 분류 → 회복: `error_classifier.py:372`가 credential 회전, OAuth beta 비활성, 컨텍스트 압축, 폴백 프로바이더, 이미지 다운그레이드 등을 분기. **텍스트 패턴 매칭 의존**.
- 컨텍스트 엔진: `context_engine.py` ABC + 기본 `context_compressor.py:1494 compress(...)`. 압축 시 세션 ID 로테이션 (`conversation_compression.py:251`).
- 인터럽트: `run_agent.py:1597 interrupt()` — 스레드 스코프 비트로 전파.

### 학습 루프 (실재)
- 턴 카운터(`conversation_loop.py:429-439`) + 스킬 이터레이션 카운터(`698-703`)가 nudge 트리거.
- 트리거 시 `background_review.py:552 spawn_background_review_thread` — **포크된 제약 에이전트**가 메모리/스킬 툴만 가지고 회고.
- 정책은 프롬프트 문자열(`background_review.py:50-121`):
  - 업데이트 우선순위: 로드된 스킬 → umbrella 스킬 → support file → 새 umbrella.
  - 번들/허브/핀 스킬 편집 금지.
- **provenance gate** (`skill_manager_tool.py:777-783`): 백그라운드 리뷰가 만든 스킬만 `agent_created` 표시 → 큐레이터 관리 대상.
- 큐레이터(`curator.py:1369 run_curator_review`): 결정론적 라이프사이클(stale/archive/reactivation) + LLM 리뷰 포크. 스냅샷 백업(`curator_backup.py`).

### 메모리·검색
- 빌트인 마크다운: `MEMORY.md` + `USER.md` (`tools/memory_tool.py:5-11`). 구분자 `§\n`.
- 외부 프로바이더 슬롯 1개 (`memory_manager.py`): Honcho 등.
- 세션 검색: `hermes_state.py:2113 search_messages` — BM25 FTS5 + 트라이그램(CJK) + LIKE 폴백. 순수 SQLite, LLM 호출 없음.
- `session_search` 툴(`tools/session_search_tool.py:285-360`): 디스커버리/스크롤/리센트, 결과에 ±1 컨텍스트 메시지.

### 게이트웨이·통합
- 1프로세스 다중 플랫폼 (Telegram/Discord/Slack/WhatsApp/Signal/Email): 플러그인 레지스트리 → 빌트인 폴백 (`gateway/run.py:5874-6068`).
- 터미널 백엔드 7종 (local/docker/ssh/singularity/modal/daytona/vercel): `BaseEnvironment` 공통 컨트랙트 (`tools/environments/base.py:287-383`).
- MCP 클라이언트(`tools/mcp_tool.py`) + 서버(`mcp_serve.py`, FastMCP).
- ACP 어댑터: 별도 프로토콜(IDE 세션). MCP를 ACP 세션에 포함 가능.
- Cron 스케줄러: `cron/scheduler.py:1787` 파일락 tick, 프로파일 컨텍스트로 잡 실행, 플랫폼 딜리버리 팬아웃.

## 잘 한 것

1. **어댑터 경계**가 깔끔 — 4종 프로바이더를 단일 캐노니컬 메시지로 통합.
2. **스트리밍 우선 + 스레드 스코프 인터럽트** — 동시 툴 실행에서도 일관된 취소.
3. **포크 에이전트로 백그라운드 작업 격리** — 메인 턴 레이턴시 영향 없음.
4. **provenance 게이트** — 사용자가 만든 스킬을 큐레이터가 건드리지 않음.
5. **FTS5 듀얼 인덱스** — CJK가 사후가 아닌 설계에 포함.
6. **컨트랙트 기반 백엔드 추상화** — 7개 실행 환경이 동일 인터페이스.

## 부채·리스크

1. **거대 파일**: 단일 파일 수천~수만 LOC. 책임 응집 과다.
2. **이중 CLI** (`hermes` argparse + `cli.py` Fire + `hermes-agent` run_agent) — 정전 미확정.
3. **자기 개선 = 프롬프트 의존** — 모델 드리프트에 취약. 코드 가드 아님.
4. **에러 분류기 텍스트 매칭** — 프로바이더 에러 리워딩 시 조용한 회귀.
5. **글로벌 상태 혼합** (env + contextvars + 싱글톤) — 테스트 격리 어려움.
6. **Cron이 프로세스 env 변이** (`cron/scheduler.py:1378-1383`) — 멀티스레드 장기 프로세스에 위험.
7. **`skill_manage` 표면 넓음** — 패치/삭제/파일쓰기 가능. `skills.guard_agent_created` 기본 OFF.

## amaze 관점 — 가져올 것 vs 버릴 것

### 가져올 만한 아이디어 (선별 차용)
- **provenance 게이트 패턴**: 자동 생성된 산출물에만 자동 큐레이션 적용. amaze 스킬/메모리에 적용 가능.
- **포크된 백그라운드 리뷰**: 메인 턴 끝난 뒤 제한 툴셋으로 회고. amaze의 skill/memory 업데이트를 메인 흐름에서 분리.
- **세션 검색 = 순수 FTS5** (LLM 호출 없음, CJK 트라이그램 폴백). amaze가 이미 Rocky 메모리 쓰지만 세션 검색 인덱스 전략으로 참고.
- **컨텍스트 엔진 ABC**: 압축 전략 교체 포인트를 인터페이스로 노출.
- **터미널 백엔드 추상화 컨트랙트**: 단일 `execute` 시그니처로 N개 실행 환경. amaze가 local/docker/sandbox 확장 시 참고.

### 가져오지 말 것
- **단일 프로세스 다중 플랫폼 게이트웨이** — amaze는 코딩 에이전트 런타임이지 메시징 봇 허브 아님.
- **18k LOC 모놀리식 게이트웨이/CLI** — amaze는 이미 패키지 분리(`coding-agent`/`ai`/`agent`/`tui`)가 잘 돼 있음.
- **프롬프트 안에 정책 박는 학습 루프** — 결정론 약함. amaze는 acceptance criteria + goal mode로 더 견고.
- **에러 분류기의 텍스트 매칭 회복** — 프로바이더 안정성에 외주.
- **ACP/MCP 양쪽 다 호스팅** — amaze가 호스트할 필요 X.
- **Cron 스케줄러 + 메시징 딜리버리** — 별도 시스템에서.
- **Honcho/외부 메모리 슬롯** — Rocky가 이미 그 자리.

## 결론

hermes-agent는 **개인용·소규모 팀 운영용으로는 강력**, **프로덕션 멀티테넌트는 게이트웨이/CLI 분해 + 에러 분류기 결정론화 선결**. amaze는 다른 종(코딩 에이전트 런타임)이며, 위 "가져올 아이디어" 5개 외에는 직접 차용 없음.
