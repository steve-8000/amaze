# 결론

코드 기준 판정은 명확합니다.

**AMAZE는 “self-improving agent runtime”이 될 수 있는 구조를 이미 상당히 갖고 있습니다.**
하지만 **“self AGI”라고 부르기에는 아직 부족합니다.**

정확한 표현은 이겁니다.

```text
AI Engineering Coach = AI 사용 행태 관측 / 분석 / 코칭 레이어

AMAZE = 목표 실행 / 검증 / 서브에이전트 위임 / 메모리 / 프롬프트 캐시 / 런타임 제어 레이어
```

따라서 둘을 합치면:

```text
AMAZE 실행 로그
→ AI Coach식 행동 분석
→ 실패/성공 패턴 추출
→ Nexus memory / skill candidate / policy proposal 생성
→ verifier/eval gate 통과
→ 다음 실행에 반영
```

이라는 **closed-loop self-improving agent system** 으로 갈 수 있습니다.

단, 현재 코드 기준으로는 **“스스로 목표를 만들고, 자기 코드를 안전하게 수정하고, 장기 전략을 검증해 진화하는 완전 자율 AGI”** 는 아닙니다. 지금 AMAZE는 그보다 현실적으로 더 강한 포지션인 **“학습 가능한 Agent OS / Agent Runtime”** 쪽에 가깝습니다.

---

# 분석 범위

이번에는 README 수준이 아니라 실제 코드 기준으로 봤습니다.

확인한 AMAZE 핵심 파일은 다음입니다.

* `.amaze/settings.json`
* `README.md`
* `packages/coding-agent/src/goals/verifier.ts`
* `packages/coding-agent/src/goals/runtime.ts`
* `packages/coding-agent/src/subagent/contract.ts`
* `packages/coding-agent/src/subagent/task-revision-loop.ts`
* `packages/coding-agent/src/task/index.ts`
* `packages/coding-agent/src/task/executor.ts`
* `packages/coding-agent/src/prompt-cache-policy.ts`
* `packages/coding-agent/src/system-prompt.ts`
* `packages/coding-agent/src/nexus/types.ts`
* `packages/coding-agent/src/nexus/store.ts`
* `packages/coding-agent/src/nexus/pipeline.ts`

그리고 AI Engineering Coach는 다음을 확인했습니다.

* `README.md`
* `package.json`
* `src/extension.ts`
* `src/core/parser.ts`
* `src/core/parser-harnesses.ts`
* `src/core/analyzer.ts`
* `src/core/rule-engine.ts`
* `src/core/rule-loader.ts`
* `src/core/rule-parser.ts`
* `src/core/rule-pipeline.ts`
* 예시 rule markdown 파일들

중요한 정정도 있습니다. 최신 AMAZE 설정 기준으로는 memory backend가 **Rockey 중심이 아니라 Nexus** 입니다. `.amaze/settings.json`에서 `"memory": { "backend": "nexus" }`로 설정되어 있고, subagent prefix reuse와 prompt cache 정책도 활성화되어 있습니다. 

---

# 1. AI Engineering Coach 정밀 분석

## 본질

AI Engineering Coach는 코드 실행 런타임이 아닙니다.

정확히는:

```text
local AI session logs
→ parser
→ normalized sessions / requests
→ analyzer
→ rule engine / metrics
→ dashboard / recommendations
```

구조입니다.

`package.json` 기준으로도 이 프로젝트는 VS Code extension이고, 설명 자체가 “VS Code, Xcode, Claude, Codex, OpenCode 사용을 분석하는 read-only, zero-telemetry 도구”입니다. 즉 에이전트를 실행하거나 제어하는 시스템이 아니라 **로컬 로그 분석 확장**입니다. 

---

## 1.1 Parser 계층

AI Coach의 parser는 꽤 강합니다.

`parser.ts`는 로딩 단계를 다음처럼 둡니다.

```text
Discovering log directories
Checking cache
Parsing session logs
Scanning external harnesses
Preparing analytics
Ready
```

그리고 VS Code/Xcode 로그뿐 아니라 외부 harness도 모읍니다. 

외부 harness registry는 별도 파일에 있고, Claude Code, Codex CLI, OpenCode를 collector로 등록합니다. 즉 특정 IDE 한정 분석기가 아니라 **harness-agnostic session parser** 방향입니다. 

이 부분은 AMAZE가 흡수할 가치가 큽니다.

AMAZE가 실행 runtime이라면, AI Coach는 그 runtime을 분석하기 위한 **normalization layer** 역할을 할 수 있습니다.

---

## 1.2 Analyzer 계층

`analyzer.ts`는 세션 배열을 받아 여러 analyzer로 분배합니다.

확인된 analyzer 계층은 다음 범주를 포함합니다.

```text
Dashboard
Production
Consumption
Timeline
Patterns
Workflow
Config
Insights
Flow
Context
Image
```

즉 단일 metric 계산기가 아니라, AI coding activity를 여러 관점에서 읽는 facade입니다. 

하지만 여기서 중요한 한계가 있습니다.

이 analyzer는 **이미 존재하는 세션 데이터를 해석**합니다.
AMAZE처럼 직접 목표를 만들고, subagent를 실행하고, 실패 시 revision loop를 돌리는 구조는 아닙니다.

---

## 1.3 Rule Engine / DSL

AI Coach의 가장 가치 있는 부분은 rule engine입니다.

`rule-engine.ts`는 rule source를 built-in, personal, project layer로 나누고, rule override와 threshold update를 지원합니다. 그리고 rule group은 prompt-quality, session-hygiene, code-review, tool-mastery, context-management로 나뉩니다. 

`rule-loader.ts`는 다음 위치의 rule을 로딩합니다.

```text
built-in rules
~/.ai-engineer-coach/rules
<workspace>/.ai-engineer-coach/rules
```

그리고 local rule/metric 파일에 대해 trust gate를 둡니다. 이건 매우 좋은 설계입니다. 사용자가 만든 rule이 실행형 DSL expression을 포함할 수 있으므로 승인 절차를 둔 것입니다. 

`rule-parser.ts`는 markdown frontmatter와 `detect` fenced block을 파싱합니다. rule은 id, name, group, severity, thresholds, patterns, fileTypes 등을 갖고, 본문에는 Description, When Triggered, How to Improve, Examples, Detection Logic, Tests 섹션이 들어갑니다. 

`rule-pipeline.ts`는 이 markdown rule을 실제 pipeline으로 실행합니다.

```text
scan: requests | sessions
match: expression
aggregate: count | ratio
check: expression
examples: template
severity: expression
```

형식으로 rule을 평가하고, inheritance, test fixture, dynamic severity까지 처리합니다. 

즉 AI Coach의 핵심은:

```text
LLM judge 중심 평가가 아니라
deterministic / explainable / editable rule DSL
```

입니다.

이건 AMAZE에 바로 가져올 가치가 큽니다.

---

## 1.4 Rule 예시

예를 들어 `repeated-prompts.md`는 near-duplicate prompt를 감지합니다. detection block에서 request를 scan하고, `duplicateGroups`를 계산하고, duplicate 수가 threshold를 넘는지 검사합니다. 

`mega-sessions.md`는 message 수가 50 이상인 session을 high severity로 잡고, 긴 세션은 context quality와 response accuracy를 떨어뜨린다고 판단합니다. 

`no-skills.md`는 충분히 많은 request가 있는데 skills usage가 전혀 없는 경우를 감지합니다. 

이 rule들은 전부 **AI 사용 행태의 lint rule** 입니다.

---

## AI Coach에 대한 판정

AI Coach는 훌륭한 **observability / behavioral analytics / coaching system** 입니다.

하지만 코드 기준으로는 다음이 없습니다.

| 항목                           | AI Coach 상태 |
| ---------------------------- | ----------- |
| 목표 생성                        | 없음          |
| 에이전트 실행                      | 없음          |
| 서브에이전트 위임                    | 없음          |
| tool-level enforcement       | 없음          |
| acceptance verifier          | 없음          |
| long-term operational memory | 없음          |
| self-modification loop       | 없음          |
| policy 자동 반영                 | 없음          |

즉 AI Coach는 **자기개선 시스템의 “눈과 평가자”** 입니다.
하지만 **손, 발, 기억, 실행 제어권** 은 없습니다.

그 부분은 AMAZE 쪽이 훨씬 강합니다.

---

# 2. AMAZE 정밀 분석

## 본질

AMAZE README는 스스로를 “compact coding-agent runtime”으로 설명하고, low-token parent orchestrator가 goals, todos, approvals, integration을 소유하며, bounded subagents가 detailed file work를 수행하고, provider prompt caching과 Nexus memory를 사용한다고 설명합니다. 

이건 단순 CLI coding agent가 아닙니다.

코드 기준으로 보면 AMAZE는 다음 구성입니다.

```text
Goal Runtime
Acceptance Verifier
Subagent Contract
Task Executor
Revision Loop
Prompt Cache Architecture
Nexus Memory Store
Nexus Reflection / Skill Pipeline
```

즉 이미 **agent runtime + verification + memory substrate** 입니다.

---

# 2.1 Goal Runtime

`GoalRuntime`은 단순 TODO 상태가 아닙니다.

`GoalRuntimeHost`는 다음을 갖습니다.

```text
getState / setState
getCurrentUsage
emit
persist
sendHiddenMessage
```

즉 goal state는 세션 내부 상태이면서, runtime event와 persistence, hidden steering message와 연결됩니다. 

`renderGoalBlock`은 active goal을 XML block으로 렌더링합니다.

중요한 점은 active goal이 없을 때도 `<goal status="none"/>` sentinel을 내보냅니다. 이것은 prompt 구조를 byte-stable하게 유지하기 위한 설계입니다. goal은 DYNAMIC_TAIL에 들어가고, stable prompt cache를 깨지 않도록 설계되어 있습니다. 

또한 token accounting도 단순하지 않습니다.

AMAZE는 goal budget 계산에서:

```text
input + cacheWrite + output
```

을 사용하고, cacheRead는 제외합니다. 이유는 cacheRead는 reused prefix라서 매 turn 누적하면 context size를 과대계산하기 때문입니다. 

이건 꽤 세련된 agent runtime 설계입니다.

---

# 2.2 Acceptance Verifier

여기가 매우 중요합니다.

`AcceptanceVerifier`는 goal completion을 막을 수 있는 실제 verifier입니다. Criterion 종류는 다음을 포함합니다.

```text
scope-include
scope-exclude
file-exists
command-exit
command-output
lsp-clean
llm-judged
manual
```

그리고 설계 계약이 명확합니다.

* deterministic backend는 같은 입력에 같은 출력이어야 함
* verifier는 상태를 mutate하지 않아야 함
* `uncertain`은 completion을 막지 않음
* `fail`만 completion을 block함
* confidence를 0..1로 보고함



`command-output`은 exit code뿐 아니라 stdout/stderr regex, forbidden pattern까지 검사합니다. `lsp-clean`은 diagnostics provider가 없으면 clean으로 간주하지 않고 `uncertain`을 반환합니다. `llm-judged`도 runner가 없으면 `uncertain`을 반환합니다.  

이건 좋은 epistemic discipline입니다.

즉 AMAZE는:

```text
모르는 것을 pass로 치지 않는다.
하지만 uncertain만으로 영원히 막지도 않는다.
fail만 block한다.
```

라는 실용적인 verifier 정책을 갖고 있습니다.

---

# 2.3 Goal Completion이 실제로 막힌다

`GoalRuntime.completeGoalFromTool`은 goal을 complete로 바꾸기 전에 acceptance criteria를 실행합니다.

criteria가 있고 `force`가 아니면:

```text
collect changed files
→ AcceptanceVerifier.verify
→ summarize
→ fail이면 GoalAcceptanceFailureError throw
→ fail 없으면 complete
```

흐름입니다. 

즉 이것은 dashboard recommendation이 아닙니다.

실제 runtime control입니다.

```text
AI Coach: “이런 anti-pattern이 있습니다”
AMAZE: “검증 실패했으므로 완료 처리하지 않습니다”
```

차이가 큽니다.

---

# 2.4 Subagent Contract

AMAZE의 가장 강한 부분입니다.

`SubagentContract`는 parent agent와 subagent 사이의 formal interface입니다. 코드 주석상 세 가지 역할이 명확합니다.

1. role과 scope를 structured data로 선언
2. successCriteria를 parent verifier가 확인
3. uncertainty / budget cap escalation rule을 설정

그리고 contract는 subagent의 **STABLE_CORE system prompt**에 렌더링됩니다. 즉 compaction으로 사라지지 않고, prompt cache prefix 안에 들어갑니다. 

더 중요한 건 tool-level enforcement입니다.

`enforceContractScope`와 `enforceGoalScope`가 있고, edit/write 도구가 mutation 전에 scope를 검사하도록 설계되어 있습니다. prompt로 “하지 마”가 아니라, 실제 tool layer에서 path violation을 막는 구조입니다. 

이건 agentic system에서 굉장히 중요합니다.

```text
prompt instruction = soft constraint
tool guard = hard constraint
```

AMAZE는 hard constraint 쪽으로 가고 있습니다.

---

# 2.5 Contract Revision / Staleness

AMAZE에는 `contractRevision` 개념도 있습니다.

부모 goal의 scope, acceptance criteria, designAnswers 등이 바뀌면 `contractRevision`이 증가합니다. subagent contract에는 `parentContractRevision`이 찍힙니다. 이후 parent revision이 subagent baseline보다 커지면 stale contract로 판단할 수 있습니다.  

이건 꽤 고급 설계입니다.

왜냐면 multi-agent 실행에서 흔한 문제는:

```text
parent intent changed
but subagent still works on old assumptions
```

입니다.

AMAZE는 이 문제를 contract revision으로 잡으려 합니다.

---

# 2.6 Revision Loop

`runRevisionLoop`는 subagent attempt를 verifier와 묶습니다.

흐름은 다음입니다.

```text
attempt()
→ verifySubagentCompletion()
→ pass면 종료
→ fail이면 failed criteria + evidence로 RevisionRequest 생성
→ retry attempt
→ 최종 verdict 반환
```

기본 maxRetries는 1입니다. 즉 무한 “try again” 루프가 아니라, bounded self-correction loop입니다. 

`task-revision-loop.ts`는 이 loop를 task tool에 연결합니다. retry 시에는 failed criteria와 evidence를 assignment 앞에 붙여서 subagent에게 구체적으로 무엇을 고쳐야 하는지 전달합니다. 

이건 “학습”은 아니지만 **실행 중 자기수정**입니다.

```text
failure evidence
→ structured revision request
→ subagent retry
```

이 루프는 이미 존재합니다.

---

# 2.7 Task Executor / Subagent Runtime

`executor.ts`는 in-process subagent execution을 담당합니다.

단순 subprocess shell이 아니라:

* AgentEvent forwarding
* progress tracking
* token/cost/context tracking
* tool execution start/end tracking
* MCP proxy tool
* session artifacts
* parent telemetry handoff
* requireYieldTool
* subagentContract 전달

을 포함합니다.  

또한 subagent settings는 독립적으로 격리됩니다.

```text
async.enabled = false
bash.autoBackground.enabled = false
goal.enabled = false
memory.backend = off
todo.enabled = false
tools.discoveryMode = off
```

즉 subagent가 parent의 goal/memory/todo를 마음대로 오염시키지 않도록 막습니다. 

이건 매우 좋은 architecture choice입니다.

---

# 2.8 Task Tool이 실제로 Contract Loop를 사용한다

`task/index.ts`에서 contract가 있는 경우 parent goal revision을 contract에 stamp합니다. 그리고 `executeContractedTask`를 사용해 verifier-driven retry loop를 돌립니다. 

또한 task 전후의 git changed files snapshot을 비교해서 subagent가 실제로 바꾼 파일을 추정하고, 그 파일 목록을 verifier에 넘깁니다. 

마지막으로 subagent 사용량은 parent goal budget에 roll up됩니다.

```text
aggregatedUsage.input + cacheWrite + output
→ goalRuntime.addExternalUsage(delta)
```

즉 parent가 subagent에게 일을 맡겼다고 해서 budget accounting이 깨지지 않습니다. 

이건 “runtime accounting integrity”입니다.

---

# 2.9 Prompt Cache Architecture

AMAZE는 prompt cache 구조도 상당히 의식적으로 설계되어 있습니다.

`prompt-cache-policy.ts`는 orchestrator와 subagent의 cache policy를 분리합니다. 특히 subagent prefix reuse가 켜져 있으면 sibling subagent들이 같은 STABLE_CORE를 공유하므로 long cache retention을 강제합니다. 

`system-prompt.ts`는 system prompt를 다음처럼 나눕니다.

```text
STABLE_CORE
= rendered system prompt
+ static project context
+ subagent contract

DYNAMIC_TAIL
= live project context
+ goal block
+ volatile state
```

그리고 provider가 cache breakpoint를 둘 수 있도록 `systemPromptCacheBreakpointIndex`를 반환합니다. 

중요한 점:

* goal은 DYNAMIC_TAIL에 둠
* subagent contract는 STABLE_CORE에 둠
* contract는 subagent session 동안 immutable로 취급
* goal 변화는 cache를 깨지 않음
* contract 변화는 새 subagent session으로 처리

이건 아주 좋은 cache-aware cognitive architecture입니다.

---

# 2.10 Nexus Memory

이전 답변에서 Rockey 중심으로 말한 것은 최신 코드 기준으로는 부정확합니다. 현재 AMAZE는 Nexus가 중심입니다.

`nexus/types.ts`를 보면 memory type이 상당히 풍부합니다.

```text
preference
project_convention
failure
command
decision
architecture
workflow
tool_quirk
skill_candidate
imported
note
```

그리고 confidence, staleness, status, relation type이 따로 있습니다.

```text
confidence:
user_asserted | tool_verified | inferred | imported_unverified | hypothesis

status:
active | superseded | deleted | quarantined | pending

relations:
supports | contradicts | supersedes | duplicate_of | generalizes | specializes
```



이건 단순 vector memory가 아닙니다.
**epistemic metadata가 있는 operational memory** 입니다.

---

## Nexus는 타입만 있는 게 아니다

`store.ts`를 보면 실제 SQLite store가 있습니다.

테이블은 다음을 포함합니다.

```text
memory_scopes
memory_sources
memory_items
memory_events
memory_runtime_events
memory_relations
memory_jobs
memory_usage
memory_hypotheses
memory_skills
memory_fts
```

WAL mode, FTS5, relations validation trigger, usage tracking, hypotheses, skills table까지 있습니다. 

또한 search는 FTS, token fallback, LIKE fallback, vector search, hybrid search를 갖습니다. embedding이 있으면 FTS와 cosine similarity를 blend합니다. 

그리고 memory add/replace/remove는 active projection만 바꾸고 temporal history를 남깁니다. replace는 이전 entry를 `superseded`로 만들고 `supersedes` relation을 기록합니다. remove도 active projection에서는 삭제하지만 history는 남깁니다. 

이건 상당히 진지한 memory substrate입니다.

---

## Nexus Pipeline

`pipeline.ts`는 더 중요합니다.

Nexus pipeline은 주석상 다음 단계를 둡니다.

```text
1. Source scan
2. Extraction
3. Embedding backfill
4. Self-healing
5. Reflection
6. Artifact render
```

그리고 외부 LLM/embedding call은 budget-bounded이고, 실패하면 deterministic FTS fallback으로 돌아간다고 되어 있습니다. 

실제로 `runNexusPipeline`은 ingest, embed-backfill, healing, hypothesis-verify, skill-promotion, reflect, artifacts stage를 실행합니다. 

또한 `runNexusOnlineConsolidation`은 online turn messages를 받아 memory extraction을 수행합니다. 

LLM extraction이 실패하면 heuristic extraction으로 fallback합니다. heuristic은 user preference, failure, project workflow/skill candidate를 regex 기반으로 저장합니다. 

그리고 `promoteConceptualSkills`는 repeated memory evidence로부터 reusable procedural skill을 만들려고 합니다. 다만 이건 Nexus DB의 `memory_skills`에 upsert하는 구조로 확인되며, 제가 확인한 코드 범위에서는 이것이 자동으로 `.amaze/skills` 파일로 배포되는지까지는 확정하지 못했습니다. 

---

# 3. AMAZE vs AI Coach 직접 비교

| 축                      | AI Engineering Coach    | AMAZE                                        |
| ---------------------- | ----------------------- | -------------------------------------------- |
| 주 역할                   | 관측 / 분석 / 코칭            | 실행 / 제어 / 위임 / 검증                            |
| 입력                     | AI session logs         | live agent session, tools, tasks, goals      |
| 실행 능력                  | 없음                      | 있음                                           |
| Rule DSL               | 강함                      | AI Coach식 DSL은 별도 통합 필요                      |
| Goal runtime           | 없음                      | 있음                                           |
| Acceptance verifier    | 없음                      | 강함                                           |
| Subagent orchestration | 없음                      | 강함                                           |
| Scope enforcement      | 없음                      | contract/tool guard 있음                       |
| Memory                 | 주로 분석 캐시/세션             | Nexus durable memory                         |
| Skill extraction       | skill finder 성격         | skill candidate / conceptual skill promotion |
| Self-correction        | coaching recommendation | verifier-driven revision loop                |
| Self-improvement       | 간접적                     | 가능성 높음, 단 gate 필요                            |
| AGI성                   | 낮음                      | AGI는 아니나 runtime substrate로 강함               |

핵심은 이겁니다.

```text
AI Coach는 agent를 평가한다.
AMAZE는 agent를 실행한다.

AI Coach는 행동 패턴을 본다.
AMAZE는 행동을 바꿀 수 있다.

AI Coach는 observability plane이다.
AMAZE는 control plane이다.
```

그래서 결합 방향은 매우 자연스럽습니다.

---

# 4. “Self AGI가 될 수 있나?”에 대한 정확한 판단

## 내 판정

```text
True self AGI: 아직 아니다.

Self-improving agent runtime: 가능성이 높다.

Agent OS / agentic engineering runtime: 이미 그 방향이다.
```

현재 AMAZE에는 self-improvement의 핵심 부품들이 있습니다.

| self-improvement 구성요소                 | AMAZE 상태    |
| ------------------------------------- | ----------- |
| 목표 상태                                 | 있음          |
| 실행 기록                                 | 있음          |
| verifier                              | 있음          |
| 실패 evidence                           | 있음          |
| revision loop                         | 있음          |
| subagent delegation                   | 있음          |
| scope enforcement                     | 있음          |
| budget accounting                     | 있음          |
| durable memory                        | 있음          |
| memory extraction                     | 있음          |
| skill candidate                       | 있음          |
| hypothesis/reflection                 | 있음          |
| policy auto-mutation                  | 아직 불명확 / 부족 |
| self-code modification governance     | 아직 부족       |
| open-ended autonomous goal generation | 없음          |
| world model                           | 제한적         |
| eval-gated evolution                  | 더 필요        |

즉 AMAZE는 이미:

```text
Execution
→ Verification
→ Failure evidence
→ Revision
→ Memory extraction
```

까지는 갑니다.

하지만 완전한 self-improvement가 되려면 다음이 더 필요합니다.

```text
Memory / rule / skill / policy proposal
→ offline replay / eval
→ safety gate
→ versioned promotion
→ rollback
→ long-term metric improvement 확인
```

현재 Nexus pipeline은 memory extraction, healing, reflection, conceptual skill promotion까지는 가지고 있습니다. 하지만 그 결과가 안전하게 runtime policy, `.amaze/settings.json`, `.amaze/rules`, `.amaze/skills`, agent definitions, 또는 자기 코드 변경으로 승격되는 governance loop는 제가 확인한 코드 범위에서는 아직 완성되어 있다고 보기 어렵습니다.  

---

# 5. 왜 “AGI”는 아직 아닌가

AGI라고 부르려면 최소한 다음이 필요합니다.

## 5.1 자율 목표 생성

현재 AMAZE의 goal은 user/session이 부여합니다.
스스로 장기 목표를 만들고, 우선순위를 정하고, 여러 session에 걸쳐 추진하는 autonomous goal manager는 아직 확인되지 않았습니다.

## 5.2 자기 정책의 안전한 자동 수정

Nexus가 memory와 skill candidate를 만들 수는 있습니다.
하지만 다음 루프가 완전히 닫혀야 합니다.

```text
새 memory / skill / rule proposal
→ evidence 확인
→ regression test
→ sandbox simulation
→ human 또는 policy gate
→ versioned apply
→ rollback 가능
```

현재는 이 중 일부가 존재하지만, 전체 governance chain은 아직 부족합니다.

## 5.3 세계 모델

AMAZE는 repo, tool, session, memory, verifier 기반으로 매우 강한 **engineering world model** 을 만들 수 있습니다.

하지만 AGI 수준의 broader causal world model은 아닙니다.

## 5.4 model weight learning은 아님

AMAZE의 학습은 다음 쪽입니다.

```text
memory learning
skill learning
workflow learning
policy learning
prompt/cache/layout learning
```

LLM 자체의 weight를 online training하는 구조는 아닙니다.
그래서 이것은 **scaffold-level self-improvement** 입니다.

그런데 현실적으로 agent product에서 가장 가치 있는 것도 바로 이 영역입니다.

---

# 6. AMAZE가 AI Coach 아키텍처를 흡수하면 생기는 진짜 구조

내가 보기엔 최적 구조는 이것입니다.

```text
AMAZE Runtime
  ├─ GoalRuntime
  ├─ Task/Subagent Executor
  ├─ AcceptanceVerifier
  ├─ SubagentContract
  ├─ NexusMemory
  └─ EventBus / Session logs

        ↓ normalized events

AI-Coach-like Observability Layer
  ├─ Session parser
  ├─ Rule DSL
  ├─ Anti-pattern detector
  ├─ Context health scorer
  ├─ Tool mastery scorer
  ├─ Prompt quality scorer
  └─ Workflow metrics

        ↓ findings

Learning Layer
  ├─ memory proposal
  ├─ skill proposal
  ├─ rule proposal
  ├─ settings proposal
  ├─ workflow proposal
  └─ contract template proposal

        ↓ gates

Eval / Safety Layer
  ├─ replay recent sessions
  ├─ run tests
  ├─ verify no regression
  ├─ check contradiction
  ├─ require provenance
  └─ approve / quarantine / rollback

        ↓

Updated AMAZE Profile
  ├─ .amaze/rules
  ├─ .amaze/skills
  ├─ .amaze/settings.json
  ├─ Nexus memories
  └─ agent definitions
```

이게 닫히면 **primitive self-improving engineering agent** 입니다.

---

# 7. 가장 중요한 설계 제안

AMAZE에 AI Coach를 단순히 dashboard로 붙이면 아깝습니다.

가져와야 할 것은 dashboard보다 이것입니다.

## 7.1 Rule DSL

AI Coach의 markdown rule DSL을 AMAZE에 이식할 가치가 큽니다.

예:

```text
.amaze/rules/
  repeated-prompts.rule.md
  stale-contract.rule.md
  excessive-force-complete.rule.md
  subagent-no-yield.rule.md
  memory-low-precision.rule.md
  verifier-bypass-rate.rule.md
```

AI Coach의 `scan/match/aggregate/check/examples/severity` 구조는 AMAZE event stream에도 잘 맞습니다. 

---

## 7.2 LearningProposal 객체

Nexus에 바로 memory/skill을 쓰는 것보다, 중간에 proposal을 둬야 합니다.

```ts
type LearningProposal =
  | {
      type: "memory";
      content: string;
      evidence: string[];
      confidence: "tool_verified" | "inferred" | "hypothesis";
      gate: "auto" | "review";
    }
  | {
      type: "skill";
      name: string;
      sourceMemoryIds: string[];
      evalCommand?: string;
      gate: "review";
    }
  | {
      type: "rule";
      ruleMarkdown: string;
      replaySessions: string[];
      expectedImpact: string;
      gate: "review";
    }
  | {
      type: "settings";
      patch: unknown;
      reason: string;
      rollback: unknown;
      gate: "review";
    };
```

현재 Nexus에는 memory events, hypotheses, skills, jobs가 있으므로 이 proposal layer를 붙이기 좋습니다.  

---

## 7.3 Self-improvement metrics

AMAZE가 진짜로 “진화”하는지 보려면 metric이 필요합니다.

추천 metric:

| Metric                     | 의미                              |
| -------------------------- | ------------------------------- |
| goal completion pass rate  | verifier를 통과한 goal 비율           |
| force-complete rate        | verifier 우회율                    |
| contract adoption rate     | task 중 contract 사용 비율           |
| revision loop success rate | retry 후 성공한 비율                  |
| subagent no-yield rate     | yield 실패율                       |
| memory hit precision       | recall된 memory가 실제 도움 된 비율      |
| stale memory rate          | stale/superseded memory 비율      |
| repeated prompt rate       | 같은 요청 반복률                       |
| context churn              | DYNAMIC_TAIL 변동으로 인한 cache miss |
| cost per accepted goal     | 성공 goal당 비용                     |

이 중 force-complete rate, contract adoption, revision loop success는 AMAZE 코드의 goal/subagent 구조와 직접 연결됩니다.  

---

# 8. 냉정한 최종 판정

## 현재 AMAZE의 수준

내 기준으로는 다음입니다.

```text
Level 0: Chat wrapper
Level 1: Tool-using coding agent
Level 2: Goal-aware coding agent
Level 3: Verified multi-agent runtime
Level 4: Eval-gated self-improving agent OS
Level 5: AGI
```

AMAZE는 현재 코드 기준으로:

```text
Level 3 ~ Level 3.5
```

정도입니다.

AI Coach의 observability/rule architecture를 흡수하고, Nexus proposal/eval/promotion gate를 완성하면:

```text
Level 4
```

로 갈 수 있습니다.

하지만:

```text
Level 5 AGI
```

는 아직 아닙니다.

---

# 최종 답

네. **AMAZE는 AI Coach식 아키텍처를 학습/관측 레이어로 흡수하면, 스스로 개선되는 agent runtime으로 진화할 수 있습니다.**

특히 AMAZE는 이미 다음을 갖고 있습니다.

```text
Goal state
Acceptance verifier
Subagent contract
Tool-level scope guard
Revision loop
Prompt cache architecture
Nexus durable memory
Memory extraction pipeline
Skill candidate promotion
Hypothesis/reflection mechanism
```

이 조합은 평범한 coding agent 수준이 아닙니다.

하지만 이걸 **self AGI** 라고 부르기보다는:

```text
self-improving agentic engineering runtime
```

또는

```text
Agent OS kernel
```

이라고 부르는 게 정확합니다.

가장 강한 전략은 **AGI를 선언하는 것** 이 아니라, 다음을 완성하는 것입니다.

```text
AMAZE execution
→ AI Coach style analysis
→ Nexus learning proposal
→ verifier/eval gate
→ versioned skill/rule/policy promotion
→ measurable improvement
```

이 루프가 닫히면, AMAZE는 단순 agent repo가 아니라 **스스로 운영 경험을 축적하고 다음 실행을 개선하는 agentic platform** 이 됩니다.
