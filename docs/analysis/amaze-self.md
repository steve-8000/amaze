# Amaze — 자체 코드 분석

> 대상: 본 저장소 (`amaze/`)
> 분석 일자: 2026-05-23, 오케스트레이터 + 5 explore 병렬
> 비교 기준: `hermes-agent.md` (Hermes는 단일 프로세스 메시징·코딩 통합, amaze는 코딩 에이전트 전용)

## 요약

- amaze는 **린 부모 오케스트레이터 + 계약 기반 서브에이전트**가 핵심 패턴. Hermes처럼 메시징 게이트웨이/cron/멀티 플랫폼을 떠안지 않는다.
- 자기 개선이 **프롬프트가 아니라 구조** (수락 기준 verifier, 서브에이전트 contract, plan/goal state machine)로 강제된다.
- 멀티 프로바이더가 **단일 캐노니컬 이벤트 스트림** (`AssistantMessageEvent`)으로 통합돼 있고, prompt cache breakpoint가 시스템 → 에이전트 → 루프 → 프로바이더까지 명시적으로 흐른다.
- **네이티브 레이어**(Rust crates: `amaze-shell`/`amaze-iso`/`amaze-ast` + vendored brush) — Hermes에는 없는 강점.
- **메모리는 Nexus 단일화** (2026-05-23 정리): Rockey/Hindsight/legacy memories 일괄 제거, 세션 검색은 Nexus로 포팅. 백엔드는 `nexus` / `off` 둘만.

## 레이어 매핑

| 영역 | 위치 | 크기 |
|---|---|---|
| 오케스트레이션 코어 | `packages/coding-agent/src/{sdk,main,system-prompt}.ts`, `session/`, `task/`, `subagent/`, `goals/`, `plan-mode/`, `modes/`, `slash-commands/` | 772 TS / 11M |
| AI 프로바이더 | `packages/ai/src/`, `packages/agent/src/`, `packages/coding-agent/src/config/model-*.ts`, `prompt-cache-policy.ts` | 169 + 20 TS |
| 메모리 | `coding-agent/src/{nexus,memory-backend}/`, `python/rocky/` (무관 — GitHub 봇) | (Nexus 전용) |
| 툴·통합 | `coding-agent/src/{tools,edit,hashline,lsp,mcp,dap,exec,eval,web,exa,stt,extensibility,discovery,capability,tool-discovery}/` | (코어 일부) |
| 네이티브·UX | `crates/{amaze-shell,amaze-iso,amaze-ast,brush-{core,builtins}-vendored,natives}`, `packages/{natives,tui,swarm-extension}`, `python/amaze-rpc` | 233 rs |

---

## 1) 오케스트레이션 코어

### 핫패스
- 부팅: `main.ts:925,940` → `runInteractiveMode` / `runPrintMode`.
- 세션 생성: `sdk.ts:721 createAgentSession(...)`.
- 턴: `session/agent-session.ts:3991 async prompt(...)` → `#promptWithMessage(...)` (`4128`) → `#promptAgentWithIdleRetry(...)` (`7388`) → `agent.prompt(...)`.
- 시스템 프롬프트: `system-prompt.ts:613,640,646` — **STABLE_CORE** + **DYNAMIC_TAIL** 분리. 동적 꼬리가 있을 때 `systemPromptCacheBreakpointIndex = 0`을 stable 블록에 핀.
- 프롬프트 캐시 정책: `prompt-cache-policy.ts:37,47-56` — 오케스트레이터 vs 서브에이전트 TTL 분리, 서브에이전트 prefix 재사용 토글.

### 서브에이전트 계약 (좋음)
- 스키마: `subagent/contract.ts:29` `SubagentContract { scope, successCriteria, escalation, ... }`.
- 스코프는 **툴 레이어에서 구조적으로 강제** (`enforceContractScope`, `contract.ts:310`).
- 검증: `goals/verifier.ts:591 AcceptanceVerifier.verify(...)` — `scope-include`/`scope-exclude`/`file-exists`/`command-exit`/`command-output`/`lsp-clean`/`llm-judged`/`manual`.
- 재시도 루프: `subagent/task-revision-loop.ts:76 executeContractedTask(...)`.

### Goal Mode (좋음)
- 라이프사이클: `goals/runtime.ts:523,620,734` create/update/complete/block/drop.
- 완료 시 `GoalAcceptanceFailureError`로 하드 페일 (`runtime.ts:620`).
- **단점**: `verifier.ts:659-667` — `uncertain` 결과는 통과 처리. 결정론적 체크가 빠지면 under-enforce 가능.

### Plan Mode (좋음)
- 상태머신 + drift detection: `plan-mode/state.ts:102 planGoalDriftReason`.
- 승인 정규화: `approved-plan.ts:25,86` — 캐노니컬 섹션·타이틀 검증 후 resolve.
- **단점**: plan 모드 툴 결정 강제가 **포스트 프롬프트** (`agent-session.ts:5967 #enforcePlanModeToolDecision`) — 일부 무효 트라젝토리는 사후에 잡힘.

### 부채
- `agent-session.ts` ~8.8k 라인 단일 파일에 큐잉/스트리밍/리트라이/goal/plan/툴 래퍼 응집. Hermes의 `conversation_loop.py:4k`와 같은 부류의 문제.
- `slash-commands/builtin-registry.ts` ~1.7k 라인 단일 등록부, ACP/TUI 핸들러 인라인.

---

## 2) AI 프로바이더 레이어

### 캐노니컬 스트림 (좋음)
- 모든 프로바이더가 `AssistantMessageEvent` 단일 union으로 정규화 (`packages/ai/src/types.ts:679+`).
- 툴 콜 청크가 first-class 이벤트(`toolcall_start|delta|end`).
- 라우팅: `stream.ts:227-263 streamSimple()` — `model.api`로 분기.

### 지원 API (실제 디스패치 기준)
`anthropic-messages` · `openai-completions` · `openai-responses` · `azure-openai-responses` · `openai-codex-responses` · `google-generative-ai` · `google-gemini-cli` · `google-vertex` · `ollama-chat` · `cursor-agent` · `bedrock-converse-stream`

### 모델 리졸버
- `config/model-resolver.ts:36-49 parseModelString` — `provider/modelId[:thinking]`.
- 캐노니컬 매치 (`findExactCanonicalModelMatch`, `260-363`) → 휴리스틱 별칭 → 폴백.
- `config/model-equivalence.ts:664-767` — 캐노니컬 인덱스 + 휴리스틱 변환.
- **리스크**: 휴리스틱 변환 그래프가 큼. 새 네이밍 규칙에서 false-merge 가능.
- 모호 해석 시 `null` 센티넬로 silent drop (`model-resolver.ts:121-141`) — UI가 surface 안 하면 사용자 의도 묻힘.

### 프롬프트 캐시 흐름 (모범)
1. `system-prompt.ts:645-652` — breakpoint index 발생.
2. `agent.ts:607-609,947-950` — Agent state에 저장.
3. `agent-loop.ts:651-655` — 루프 context로 전달.
4. `providers/anthropic.ts:1453-1517` — `cache_control` 블록 배치.

→ Anthropic만 실효 적용. 타 프로바이더는 무시 (안전한 폴백).

---

## 3) 메모리 스택 — Nexus 단일화 (완료)

2026-05-23 정리에서 Rockey · Hindsight · legacy `memories/`를 모두 삭제. 백엔드는 두 가지만:

| 시스템 | 역할 | 위치 |
|---|---|---|
| **Nexus** | 캐노니컬 로컬 메모리 그래프: temporal status(`active/superseded/deleted`), provenance, confidence, 옵션 embeddings + knowledge store + **세션 anchor FTS** | `nexus/store.ts`, `nexus/pipeline.ts`, `nexus/knowledge/`, `nexus/session-search.ts` |
| **off** | 메모리 비활성 (RPC/임베디드 호스트 기본값) | `memory-backend/off-backend.ts` |

### 라우팅
- `memory-backend/resolve.ts` — `nexus` 외 모든 값은 `off`로 라우트.
- `memory-backend/types.ts` — `MemoryBackendId = "off" | "nexus"`.
- `config/settings.ts` — 레거시 사용자 설정(`rockey`/`local`/`hindsight`/`memories.enabled: true`) 로드 시점에 `nexus`로 자동 업그레이드.

### 제거된 것
- `src/rockey/`, `src/hindsight/`, `src/memories/` (디렉토리 전체)
- `memory-backend/{rockey,local}-backend.ts`
- `nexus/importers.ts` (Rockey/local/Hindsight → Nexus 마이그레이션 브리지)
- 툴: `rockey-memory`, `rockey-memory-search`, `rockey-session-search`, `hindsight-{recall,retain,reflect}`
- 프롬프트: `prompts/tools/{recall,retain,reflect}.md`, `prompts/memory/rockey-policy.md`
- 슬래시 커맨드: `/memory` 의 rockey/hindsight 하위 명령 + mental-model `mm` 패밀리
- 설정 키: `rockey.*`, `hindsight.*`, `memories.*`, `nexus.migration.*`
- 테스트: hindsight-*.test.ts, memories-*.test.ts, test/rockey/, test/memories/
- 문서: `docs/tools/{recall,retain,reflect}.md`

### 잔존 리스크
- Nexus 시작 시 무거운 유지보수가 기회적 실행, 실패는 swallow + log (`memory-backend/nexus-backend.ts`) — degraded memory quality 숨길 수 있음.
- 기존 사용자의 Rockey/Hindsight 메모리 그래프 데이터는 가져오지 않음. 설정만 `nexus`로 업그레이드되고 메모리는 빈 상태에서 시작. (세션 파일은 그대로이므로 첫 기동 시 Nexus가 재인덱싱.)

### Nexus 세션 검색 (Rockey 통합)
- `nexus/session-search.ts` — Rockey에 있던 FTS5 기반 세션 anchor 검색을 Nexus로 포팅.
- 데이터: 별도 SQLite `<agentDir>/memories/nexus/nexus-sessions.db`. 스키마 격리.
- 자동 인덱싱: `nexusBackend.start`에서 부트스트랩 재인덱싱, `onTurnEnd`에서 현재 세션 증분 인덱싱.
- 툴: `session_search` (zod 스키마: query/scope/role/since/limit).
- 슬래시: `/memory session-search <query>` (또는 alias `/memory sessions <query>`).
- 설정: `nexus.sessionSearchMaxAnchors` (default 8), `nexus.sessionSearchMaxPreviewChars` (default 1600).

### Python Rocky (이름만 같은 별개 시스템)
- `python/rocky/`는 GitHub triage 봇이며 위 Rockey 메모리와 무관. 건드리지 않음.

---

## 4) 툴·통합 표면

### 깔끔한 경계 (좋음)
- `tools/index.ts:294-523 createTools(...)` — 빌트인 + 히든(`yield`/`resolve`/`goal`) 게이팅, 설정·재귀·메모리 백엔드·디스커버리 모드별 필터.
- `capability/index.ts:52-67` — 제네릭 capability 레지스트리. 디스커버리 프로바이더는 출처별 어댑터일 뿐.

### Edit Pipeline (강함)
- `edit/index.ts:277-383` — 모드별 (`patch`/`replace`/`hashline`/`apply_patch`/`vim`) 라우팅 + 공유 writethrough.
- **Hashline**: `hashline/anchors.ts:23-31`, `hashline/execute.ts:68-97` — 앵커 매치 실패 시 **하드 reject**, 캐시 기반 strict recovery, fuzzy merge 없음 (`hashline/recovery.ts:48-69`).
- LSP writethrough: `lsp/index.ts:1032-1063` — sync → format → write → save → diagnostics.

### MCP 통합
- `mcp/manager.ts:134-175` — 멀티 서버 라이프사이클, epoch-guarded 재연결, OAuth 리프레시 (`1081-1093`).
- `mcp/oauth-flow.ts:120-190` PKCE + dynamic client registration.
- Smithery 레지스트리: `mcp/smithery-registry.ts:67-108`.

### DAP (디버거)
- `dap/session.ts:193-219,704-754` — launch/attach, continue/pause/step/eval. Hermes에 없는 surface.

### 디스커버리·확장성
- 외부 에이전트 포맷 임포터: `discovery/{codex,claude,gemini,opencode,vscode,windsurf}.ts`.
- `extensibility/custom-tools/loader.ts:89-116` — 커스텀 툴에 명시적 API 주입 (`exec`, `zod`, `typebox`, UI bridge) — import resolution coupling 회피.

### 부채
- `tool-index.ts:360-377`, `search-tool-bm25.ts:82-90` — 레거시 MCP-only path와 통합 path 공존 (Dual-path debt).
- `discovery/index.ts:23-35` — side-effect import 순서 의존. 누락 시 silent capability gap.
- `extensibility/plugins/manager.ts:125-171` — Bun 서브프로세스로 글로벌 플러그인 스토어 변이. 트랜잭션 롤백 없음.

---

## 5) 네이티브·UX

### Rust crates (Hermes에 없는 강점)
- **`amaze-shell`** (`crates/amaze-shell/src/shell.rs:72-220`): brush 임베딩 + 세션 재사용 + abort + 출력 minimizer. `execute_shell` / persistent `Shell`.
- **`amaze-iso`** (`crates/amaze-iso/src/lib.rs:47-66,225-338`): APFS/btrfs/zfs/reflink/overlayfs/Windows block-clone/ProjFS/rcopy. 백엔드 probe + ordered fallback + diff.
- **`amaze-ast`** (`crates/amaze-ast/src/ops.rs:77-217`): ast-grep + tree-sitter 구조 검색·재작성·요약.
- **`brush-{core,builtins}-vendored`** (`Cargo.toml:1-20` patch.crates-io): AMAZE 전용 child-session/job-control 차이 (`brush-core-vendored/src/commands.rs:958-989`).
- **`natives`** (`crates/natives/src/lib.rs:1-41`): N-API 어그리게이션. 버전 센티넬 `__amazeNativesV1_0_0` (`:70-71`).

### JS 로더
- `packages/natives/native/loader-state.js:33-55,304-314,410-434` — 플랫폼 매트릭스, 센티넬 검증, 폴백 루프.

### TUI
- `packages/tui/src/index.ts:1-36` — `TUI`/`Editor` 프리미티브.
- `coding-agent/src/modes/interactive-mode.ts:288-316,398-504` — 컨트롤러 분리 (input/command/events/selectors) 됐으나 파일은 여전히 2.8k+ 라인.
- `coding-agent/src/vim/{engine,render}.ts` — **터미널 vim 임베딩 아님**. 결정론적 인프로세스 에디팅 엔진.

### CLI
- 엔트리: `commands/launch.ts:20-139` → `main.ts:620-623 runRootCommand` → `:901-940` mode dispatch.
- 커맨드 트리: `launch` · `setup` · `auth-broker` · `shell` · `ssh` · `stats` · `commit` · `web-search` · `acp` · `config` · `read` · `plugin` · `agents` · `grievances` · `update`.

### Swarm Extension
- `packages/swarm-extension/src/extension.ts:22-47,71-76` — `/swarm` 슬래시. YAML DAG 파이프라인.
- `pipeline.ts:148-159` — wave 단위 병렬 에이전트 실행.

### Python amaze-rpc
- `python/amaze-rpc` — `--mode rpc` JSONL 프로토콜의 타입 래퍼. UI 요청·todo·prompt orchestration (`client.py:650-848`).

### 리스크
- `interactive-mode.ts` 2.8k+ 라인 — 여전히 큰 단일 모듈.
- 슬래시 행동이 builtin registry + input controller + ACP agent 사이에 분산 (`acp/acp-agent.ts:649-652`) — 인터랙티브 vs RPC/ACP drift 위험.
- 네이티브 로더의 Windows variant staging 복잡 — 플랫폼 회귀 가능.

---

## Hermes 대비 차이

| 차원 | Hermes | Amaze |
|---|---|---|
| 자기 개선 | 프롬프트 텍스트(`background_review.py:50-121`) | 구조적 verifier + contract |
| 에러 복구 | 텍스트 매칭 분류기 | 캐노니컬 이벤트 + 모델 폴백 |
| 메모리 | 마크다운 2개 + 외부 1슬롯 (Honcho) | 4개 공존 (개념적 부담) |
| 게이트웨이 | 1프로세스 6+ 메시징 플랫폼 | 없음 (스코프 외) |
| 실행 환경 | 7개 백엔드 | `amaze-iso` PAL + brush 임베딩 + DAP |
| 편집 | 일반 텍스트 패치 | hashline 앵커, hard reject |
| 학습 트리거 | 카운터 + nudge | goal mode + 수락 기준 |
| 모놀리스 핫스팟 | `gateway/run.py:18k`, `cli/main.py:13k`, `conversation_loop.py:4k` | `agent-session.ts:8.8k`, `interactive-mode.ts:2.8k`, `builtin-registry.ts:1.7k` |

---

## 우선 부채 (가중치 순)

1. ~~메모리 4종 통합 로드맵~~ **완료** (2026-05-23, Nexus 단일화).
2. **`agent-session.ts` 분해** — 큐잉/스트리밍/리트라이/goal·plan/툴 래퍼 책임 분리.
3. **`verifier.ts` uncertain 정책 강화** — `uncertain → pass` 정책이 결정론 누락을 가림. 옵션화 또는 hard-fail 모드 추가.
4. **레거시 MCP 디스커버리 shim 제거 타임라인** — `tool-index.ts:321-377`.
5. **모델 리졸버 모호 결과 surface** — silent `null` drop을 UI/로그로 노출.
6. **Plan 모드 사전 강제** — `#enforcePlanModeToolDecision`을 프롬프트 빌드 시점으로 당기기.
7. **`interactive-mode.ts` 추가 분해** — 컨트롤러 추출은 진행 중이나 본체가 여전히 크다.
8. **slash-command path 단일화** — interactive/ACP/RPC 간 conformance 테스트.

---

## 잘 한 것 (유지 가치)

- **Subagent contract** + **AcceptanceVerifier** — 자기개선의 결정론적 백본.
- **STABLE_CORE / DYNAMIC_TAIL + cache breakpoint** — 토큰 경제성을 시스템 설계에 반영.
- **Hashline 편집** — fuzzy merge 거부, 명시적 anchor hash. 실수 방지에 최적.
- **`amaze-iso` PAL** — 코딩 에이전트가 자기 작업공간을 격리하기 위한 정통 추상화. 비교 대상 거의 없음.
- **단일 메모리 백엔드 배타 선택** — Nexus 단일화로 종결.
- **캐노니컬 이벤트 스트림** — 11 API를 단일 union으로.
- **Vendored brush + 명시적 patch.crates-io** — 의존성 통제.

---

## 결론

Amaze는 **자기 개선이 코드 구조로 강제되는 코딩 에이전트**다. Hermes의 "프롬프트로 정책을 박는" 접근과 정확히 반대. 2026-05-23에 메모리 서브시스템을 **Nexus 단일화**로 정리해 4종 공존 부담을 해소했다. 남은 핫스팟은 `agent-session.ts` 분해와 `verifier.ts` uncertain 정책 강화. 네이티브 레이어(shell/iso/ast)는 다른 어떤 코딩 에이전트에서도 보기 드문 자산.
