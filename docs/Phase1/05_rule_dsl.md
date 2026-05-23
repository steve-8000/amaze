# Phase 1C-05 — Rule DSL Engine (`.amaze/rules/*.rule.md`)

> **출처**: `docs/Phase0/03_gpt.md` §7.1 (AI Coach Rule DSL 흡수).
> **위상**: P2. Phase 04 (observability) 완료 후.

## Goal

```yaml
title: Evaluate deterministic, markdown-authored rules over the session event stream
why: |
  Amaze는 지금 LLM judge나 reflection으로 "이상 패턴"을 잡는다. 비싸고 불안정하다.
  AI Coach의 markdown rule DSL은 scan/match/aggregate/check/severity 의 결정형 평가로 동일 일을 한다.
  Trust gate(빌트인/personal/project)와 inheritance도 그대로 가치 있다.
scope:
  include:
    - packages/coding-agent/src/rules/**
    - .amaze/rules/**
    - packages/coding-agent/src/cli/rules.ts
  exclude:
    - packages/coding-agent/src/observability/**  # 입력 schema만 의존
```

## Rule 파일 형식

```yaml
---
id: force-complete-rate
name: High force-complete rate
group: verifier-discipline
severity: warning   # info | warning | high | critical
trust: built-in     # built-in | personal | project
fileTypes: []
inherits: []
---

# Description
Force-completing goals bypasses acceptance verifier and risks self-contamination.

# Detection

```detect
scan: events
match: $.type == "goal.complete" && $.verdict == "force"
aggregate: count
window: { last: 200, type: "goal.complete" }
check: $count / $windowSize > thresholds.maxRate
thresholds:
  maxRate: 0.05
severity:
  if: $count / $windowSize > 0.15 then "high"
  else if: $count / $windowSize > 0.05 then "warning"
```

# Examples
- session abc123 force-completed goal "refactor X" with 2 failing criteria

# How to Improve
Use revision loop or fix failing criteria; reserve force only for human override.
```

## Acceptance Criteria

```yaml
- id: rule-parser
  check: {type: command-exit, argv: [bun,test,packages/coding-agent/tests/rules/parser.test.ts], expected: 0}
- id: rule-evaluator
  check: {type: command-exit, argv: [bun,test,packages/coding-agent/tests/rules/evaluator.test.ts], expected: 0}
- id: rule-loader-trust-gate
  check: {type: command-exit, argv: [bun,test,packages/coding-agent/tests/rules/loader-trust.test.ts], expected: 0}
- id: rule-cli
  check: {type: command-exit, argv: [bun,test,packages/coding-agent/tests/cli/rules.test.ts], expected: 0}
- id: builtin-rules-present
  check: {type: file-exists, path: .amaze/rules/builtin/force-complete-rate.rule.md}
```

## Tasks

### T5.1 — Markdown frontmatter + detect block parser

```json
{
  "id": "RuleParser",
  "description": "frontmatter + ```detect 블록 + 본문 섹션 파싱",
  "assignment": "rules/parser.ts: parseRuleMarkdown(text) -> Rule. Rule = {id,name,group,severity,trust,fileTypes,inherits,detect:{scan,match,aggregate,window,check,thresholds,severity},description,examples,howToImprove,tests?}. detect 블록은 YAML로 파싱. JSONPath 유사 표현(`$.type`)과 변수($count, $windowSize, thresholds.*) 만 지원. 임의 코드 실행 금지. 신규 테스트 rules/parser.test.ts: 위 예시 + 잘못된 형식 reject.",
  "contract": {
    "role": "rule-parser",
    "scope":{"include":["packages/coding-agent/src/rules/parser.ts","packages/coding-agent/tests/rules/parser.test.ts"],"exclude":[]},
    "inputArtifact":"docs/Phase1/05_rule_dsl.md",
    "outputContract":{"mustProduce":["parser","test"]},
    "successCriteria":[
      {"id":"parser-test","check":{"type":"command-exit","argv":["bun","test","packages/coding-agent/tests/rules/parser.test.ts"],"expected":0}}
    ],
    "escalation":{"onUncertainty":"ask-parent","budgetCap":200000}
  }
}
```

### T5.2 — Safe expression evaluator

```json
{
  "id": "RuleExpressionEval",
  "description": "match/check expression evaluator (sandboxed)",
  "assignment": "rules/expr.ts: 토큰화 + AST 평가. 지원: `$.field`, 리터럴(string/number/bool), 비교(==/!=/<=/>=/</>), 논리(&&/||/!), 산술(+,-,*,/), thresholds.* 참조, $count, $windowSize, $now. 함수 호출, member access(.path), bracket access만 허용. eval / new Function 절대 금지. 신규 테스트: 각 연산자 + 악성 표현 reject.",
  "contract": {
    "role": "safe-expr-eval",
    "scope":{"include":["packages/coding-agent/src/rules/expr.ts","packages/coding-agent/tests/rules/expr.test.ts"],"exclude":[]},
    "inputArtifact":"docs/Phase1/05_rule_dsl.md",
    "outputContract":{"mustProduce":["evaluator","test"]},
    "successCriteria":[
      {"id":"expr-test","check":{"type":"command-exit","argv":["bun","test","packages/coding-agent/tests/rules/expr.test.ts"],"expected":0}}
    ],
    "escalation":{"onUncertainty":"ask-parent","budgetCap":200000}
  }
}
```

### T5.3 — Rule evaluator over SessionEvent stream

```json
{
  "id": "RuleEvaluator",
  "description": "scan=events|requests|sessions, aggregate=count|ratio|distinct, window 처리",
  "assignment": "rules/evaluator.ts: evaluateRule(rule, events: SessionEvent[]): RuleFinding | null. RuleFinding = {ruleId, severity, count, windowSize, sampleEvents:[…3], message}. window는 last:N|since:ts|byType. dynamic severity 표현은 expr evaluator 재사용. 신규 테스트 rules/evaluator.test.ts: force-complete-rate fixture로 maxRate 초과 시 finding, 미초과 시 null.",
  "contract": {
    "role": "rule-evaluator",
    "scope":{"include":["packages/coding-agent/src/rules/evaluator.ts","packages/coding-agent/tests/rules/evaluator.test.ts"],"exclude":[]},
    "inputArtifact":"docs/Phase1/05_rule_dsl.md",
    "outputContract":{"mustProduce":["evaluator","test"]},
    "successCriteria":[
      {"id":"eval-test","check":{"type":"command-exit","argv":["bun","test","packages/coding-agent/tests/rules/evaluator.test.ts"],"expected":0}}
    ],
    "escalation":{"onUncertainty":"ask-parent","budgetCap":220000}
  }
}
```

### T5.4 — Loader + trust gate (built-in / personal / project)

```json
{
  "id": "RuleLoaderTrust",
  "description": "3-tier loader, project/personal rule은 first-use approval",
  "assignment": "rules/loader.ts: 빌트인은 packages/coding-agent/src/rules/builtin/*.rule.md, personal은 ~/.amaze/rules/*, project는 .amaze/rules/*. project/personal은 unknown hash 발견 시 prompt for approval, approved hash는 ~/.amaze/rules/.trusted.json 에 저장. inherits 체인 해석. 신규 테스트 loader-trust.test.ts: untrusted project rule은 loader 결과에서 빠지고, approve 후 포함.",
  "contract": {
    "role": "rule-loader",
    "scope":{"include":["packages/coding-agent/src/rules/loader.ts","packages/coding-agent/src/rules/builtin/**","packages/coding-agent/tests/rules/loader-trust.test.ts"],"exclude":[]},
    "inputArtifact":"docs/Phase1/05_rule_dsl.md",
    "outputContract":{"mustProduce":["loader","trust store","test"]},
    "successCriteria":[
      {"id":"loader-test","check":{"type":"command-exit","argv":["bun","test","packages/coding-agent/tests/rules/loader-trust.test.ts"],"expected":0}}
    ],
    "escalation":{"onUncertainty":"ask-parent","budgetCap":220000}
  }
}
```

### T5.5 — Builtin rule set (seed)

```json
{
  "id": "BuiltinRules",
  "description": "최초 빌트인 rule 6종",
  "assignment": "다음 rule들을 packages/coding-agent/src/rules/builtin/*.rule.md 에 작성: force-complete-rate, subagent-no-yield, repeated-prompts, stale-contract, memory-low-precision, verifier-bypass-rate. 각 rule은 detection block이 evaluator로 평가 가능해야 하며, examples/how-to-improve 섹션 포함. 파일이 .amaze/rules/builtin/ 으로 install 시 복사되도록 빌드 설정도 점검.",
  "contract": {
    "role": "builtin-rules",
    "scope":{"include":["packages/coding-agent/src/rules/builtin/**",".amaze/rules/builtin/**","packages/coding-agent/tests/rules/builtin-smoke.test.ts"],"exclude":[]},
    "inputArtifact":"docs/Phase1/05_rule_dsl.md",
    "outputContract":{"mustProduce":["6 rule md files","smoke test loads all"]},
    "successCriteria":[
      {"id":"builtin-test","check":{"type":"command-exit","argv":["bun","test","packages/coding-agent/tests/rules/builtin-smoke.test.ts"],"expected":0}},
      {"id":"force-rule-file","check":{"type":"file-exists","path":".amaze/rules/builtin/force-complete-rate.rule.md"}}
    ],
    "escalation":{"onUncertainty":"ask-parent","budgetCap":180000}
  }
}
```

### T5.6 — CLI: `amaze rules`

```json
{
  "id": "RulesCli",
  "description": "list / show / lint / run / approve",
  "assignment": "amaze rules list, amaze rules show <id>, amaze rules lint <path>, amaze rules run --since <ts>, amaze rules approve <id|path>. run은 JSONL sink에서 events 로딩 후 모든 rule 평가, finding을 stdout 또는 --json. 신규 테스트 cli/rules.test.ts.",
  "contract": {
    "role": "rules-cli",
    "scope":{"include":["packages/coding-agent/src/cli/rules.ts","packages/coding-agent/tests/cli/rules.test.ts"],"exclude":[]},
    "inputArtifact":"docs/Phase1/05_rule_dsl.md",
    "outputContract":{"mustProduce":["cli","test"]},
    "successCriteria":[
      {"id":"rules-cli-test","check":{"type":"command-exit","argv":["bun","test","packages/coding-agent/tests/cli/rules.test.ts"],"expected":0}}
    ],
    "escalation":{"onUncertainty":"ask-parent","budgetCap":150000}
  }
}
```

## 병렬화

T5.1 / T5.2 병렬 → T5.3 → (T5.4, T5.5, T5.6) 병렬.

## 종료 조건

- 최소 6개 빌트인 rule 이 `amaze rules run` 으로 실행되고 findings 생성
- project rule trust gate 가 unknown hash 차단
