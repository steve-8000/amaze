# Operator CLI review
> **Status**: landed (2026-05-23) — reference


Scratch runs were executed under `/tmp/amaze-cli-review*` with a temporary `HOME`, a synthetic observability JSONL session, and temporary SQLite databases. CLI entry used for working invocations: `bun --cwd packages/coding-agent src/cli.ts ...`. `bun --cwd packages/coding-agent run src/cli.ts ...` was also tried first and only printed Bun's `run` usage, so it is not the usable source-tree entry form.

## Scenario A: I want to know how often I force-completed last week.

Verdict: `works`

Commands:

```sh
env AMAZE_OBSERVABILITY_DIR=/tmp/amaze-cli-review.40kjpfkc/obs \
  bun --cwd packages/coding-agent src/cli.ts metrics show --window 7d --json --sink /tmp/amaze-cli-review.40kjpfkc/obs

env AMAZE_OBSERVABILITY_DIR=/tmp/amaze-cli-review.40kjpfkc/obs \
  bun --cwd packages/coding-agent src/cli.ts observe export --session review-a --filter goal.complete --since 1778928017969
```

Observed output:

```text
EXIT: 0
--- stdout ---
[
  {
    "name": "goal.completion.passRate",
    "value": 0.3333333333333333,
    "window": {
      "total": 5,
      "start": 1779360017969,
      "end": 1779360017969,
      "since": 1778928018236
    },
    "sampleN": 3
  },
  {
    "name": "goal.forceCompleteRate",
    "value": 0.6666666666666666,
    "window": {
      "total": 5,
      "start": 1779360017969,
      "end": 1779360017969,
      "since": 1778928018236
    },
    "sampleN": 3
  },
  {
    "name": "subagent.contractAdoption",
    "value": 0,
    "window": {
      "total": 5,
      "start": 1779360017969,
      "end": 1779360017969,
      "since": 1778928018236
    },
    "sampleN": 0
  },
  {
    "name": "subagent.revisionSuccess",
    "value": 0,
    "window": {
      "total": 5,
      "start": 1779360017969,
      "end": 1779360017969,
      "since": 1778928018236
    },
    "sampleN": 0
  },
  {
    "name": "subagent.noYieldRate",
    "value": 0,
    "window": {
      "total": 5,
      "start": 1779360017969,
      "end": 1779360017969,
      "since": 1778928018236
    },
    "sampleN": 0
  },
  {
    "name": "memory.hitPrecision",
    "value": 0.25,
    "window": {
      "total": 5,
      "start": 1779360017969,
      "end": 1779360017969,
      "since": 1778928018236
    },
    "sampleN": 1
  },
  {
    "name": "memory.staleRate",
    "value": 1,
    "window": {
      "total": 5,
      "start": 1779360017969,
      "end": 1779360017969,
      "since": 1778928018236
    },
    "sampleN": 1
  },
  {
    "name": "prompt.cacheChurn",
    "value": 0,
    "window": {
      "total": 5,
      "start": 1779360017969,
      "end": 1779360017969,
      "since": 1778928018236
    },
    "sampleN": 0
  },
  {
    "name": "cost.perAcceptedGoal",
    "value": 0,
    "window": {
      "total": 5,
      "start": 1779360017969,
      "end": 1779360017969,
      "since": 1778928018236
    },
    "sampleN": 3
  },
  {
    "name": "verifier.bypassRate",
    "value": 0,
    "window": {
      "total": 5,
      "start": 1779360017969,
      "end": 1779360017969,
      "since": 1778928018236
    },
    "sampleN": 3
  }
]
--- stderr ---
```

```text
EXIT: 0
--- stdout ---
{"type":"goal.complete","sessionId":"s1","ts":1779360017969,"verdict":"force"}
{"type":"goal.complete","sessionId":"s2","ts":1779360017969,"verdict":"pass"}
{"type":"goal.complete","sessionId":"s3","ts":1779360017969,"verdict":"force"}
--- stderr ---
```

Notes: `metrics show --window 7d --json` gives the exact `goal.forceCompleteRate`; `observe export` provides raw event evidence. Counting only force-complete rows still requires a visual scan or JSON processing outside the CLI.

## Scenario B: A rule flagged a proposal. I want to read the evidence, run the sandbox replay, and approve.

Verdict: `missing-affordance` — see [Phase3 stub](../Phase3/cli-rules-run-aggregate-ratio.md).

Commands:

```sh
env AMAZE_OBSERVABILITY_DIR=/tmp/amaze-cli-review.40kjpfkc/obs \
  bun --cwd packages/coding-agent src/cli.ts rules list

env AMAZE_OBSERVABILITY_DIR=/tmp/amaze-cli-review.40kjpfkc/obs \
  bun --cwd packages/coding-agent src/cli.ts rules run --since 1778928017969

bun --cwd packages/coding-agent src/cli.ts proposals show mpi80n70944f860e0eb38015 --db /tmp/amaze-cli-review2.k6f3pfd2/proposals.db

bun --cwd packages/coding-agent src/cli.ts proposals approve mpi80n70944f860e0eb38015 --db /tmp/amaze-cli-review2.k6f3pfd2/proposals.db --reason reviewed

bun --cwd packages/coding-agent src/cli.ts proposals apply mpi8181pc9375c33943c9417 --db /tmp/amaze-cli-review3.mntn2_hw/proposals.db --settingsPath /tmp/amaze-cli-review3.mntn2_hw/settings.json
```

Observed output:

```text
EXIT: 0
--- stdout ---
force-complete-rate	builtin	warning
memory-low-precision	builtin	warning
repeated-prompts	builtin	warning
request-cache-churn	builtin	warning
session-memory-recall-decay	builtin	warning
stale-contract	builtin	high
subagent-no-yield	builtin	warning
verifier-bypass-rate	builtin	high
workspace-force-complete-trend	builtin	high
--- stderr ---
```

```text
EXIT: 1
--- stdout ---
{"ruleId":"force-complete-rate","severity":"high","count":2,"windowSize":3,"sampleEvents":[{"type":"goal.complete","sessionId":"s1","ts":1779360017969,"verdict":"force"},{"type":"goal.complete","sessionId":"s3","ts":1779360017969,"verdict":"force"}],"message":"High force-complete rate: 2 matching events in 3 event window"}
--- stderr ---

[Uncaught Exception] Error: Unsupported rule aggregate: ratio $.usedHits / $.hits
    at evaluateRule (/Users/steve/roy/amaze/amaze/packages/coding-agent/src/rules/evaluator.ts:39:13)
    at runRulesRunCommand (/Users/steve/roy/amaze/amaze/packages/coding-agent/src/cli/rules.ts:42:19)
    at async run (/Users/steve/roy/amaze/amaze/packages/coding-agent/src/commands/rules.ts:40:10)
    at async run (/Users/steve/roy/amaze/amaze/packages/utils/src/cli.ts:421:17)
    at processTicksAndRejections (native:7:39)
```

```text
EXIT: 0
--- stdout ---
{
  "type": "settings",
  "patch": {
    "autonomy.enabled": true
  },
  "reason": "Enable reviewed autonomy preview",
  "rollback": {
    "autonomy.enabled": false
  },
  "regressionCommands": [
    {
      "argv": [
        "bun",
        "--version"
      ]
    }
  ],
  "lastEvalReport": {
    "passed": true,
    "stage": "done",
    "signals": {
      "ruleFinding": "force-complete-rate"
    },
    "durationMs": 5,
    "patchHash": "demo",
    "sandbox": {
      "ok": true,
      "perCommand": [
        {
          "argv": [
            "bun",
            "--version"
          ],
          "exit": 0,
          "stdout": "1.3.14\\n",
          "stderr": "",
          "durationMs": 1,
          "timedOut": false
        }
      ],
      "revertedCleanly": true
    }
  },
  "id": "mpi80n70944f860e0eb38015",
  "createdAt": 1779533026668,
  "status": "pending",
  "gate": "review",
  "evidence": {
    "sessionIds": [
      "review-a"
    ],
    "eventRefs": [
      "review-a:1"
    ],
    "ruleFindings": [
      "force-complete-rate"
    ],
    "sampleN": 3
  },
  "provenance": {
    "source": "rule",
    "ruleId": "force-complete-rate"
  }
}
--- stderr ---
```

```text
EXIT: 0
--- stdout ---
approved mpi80n70944f860e0eb38015
--- stderr ---
```

```text
EXIT: 0
--- stdout ---
applied mpi8181pc9375c33943c9417 mpi818am-843d7226-7f58-45a8-8dab-a6969dd6bdea
--- stderr ---
```

Notes: proposal show/approve/apply can work when the proposal row already has a fresh sandbox eval. The operator workflow is not end-to-end because `rules run` crashes on a built-in rule after emitting the first finding, and there is no CLI command that reruns the proposal sandbox replay on demand before approval/apply. The apply flag is also camelCase (`--settingsPath`), not kebab-case (`--settings-path`); the latter exits with `TypeError: Unknown option '--settings-path'`.

## Scenario C: Memory recall returned stale facts. I want to find them, mark superseded, and re-search.

Verdict: `missing-affordance` — see [Phase3 stub](../Phase3/cli-memory-stale-fact-workflow.md).

Commands:

```sh
bun --cwd packages/coding-agent src/cli.ts memory doctor

bun --cwd packages/coding-agent src/cli.ts memory migrate-legacy rockey --dry-run
```

Observed output:

```text
EXIT: 0
--- stdout ---
Nexus status: ok
- maintenance: ok
- session-reindex: ok
- knowledge-migration: ok
--- stderr ---
```

```text
EXIT: 0
--- stdout ---
no legacy data found for rockey
--- stderr ---
```

Notes: the `memory` CLI exposes `doctor` and `migrate-legacy` only. It does not expose memory search, stale-hit inspection, mark-superseded/quarantine, or a re-search loop, so the scenario cannot be completed from the operator CLI.

## Scenario D: Autonomy is OFF but I want to preview what a metric→sub-goal proposal would look like.

Verdict: `missing-affordance` — see [Phase3 stub](../Phase3/cli-objective-preview.md).

Commands:

```sh
bun --cwd packages/coding-agent src/cli.ts objective disable

bun --cwd packages/coding-agent src/cli.ts objective create --db /tmp/amaze-cli-review.40kjpfkc/objectives.db --title "Reduce force-complete rate" --metric goal.forceCompleteRate --target 0.05 --direction down

bun --cwd packages/coding-agent src/cli.ts objective list --db /tmp/amaze-cli-review.40kjpfkc/objectives.db
```

Observed output:

```text
EXIT: 0
--- stdout ---
autonomy.enabled=false
--- stderr ---
```

```text
EXIT: 0
--- stdout ---
mpi7w7v7c9dc5f6b7ba56322	active	Reduce force-complete rate	goal.forceCompleteRate down 0.05
--- stderr ---
```

```text
EXIT: 0
--- stdout ---
ID	STATUS	TITLE	ARGET
mpi7w7v7c9dc5f6b7ba56322	active	Reduce force-complete rate	goal.forceCompleteRate down 0.05
--- stderr ---
```

Notes: `objective disable` works and objective CRUD works, but there is no preview/dry-run command for metric-to-sub-goal proposal generation while autonomy is off. The closest command mutates state by creating an active objective.

## Scenario E: Something is wrong. Where do I look first?

Verdict: `missing-affordance` — see [Phase3 stub](../Phase3/cli-root-doctor.md).

Commands:

```sh
bun --cwd packages/coding-agent src/cli.ts doctor --help

bun --cwd packages/coding-agent src/cli.ts memory doctor

env AMAZE_OBSERVABILITY_DIR=/tmp/amaze-cli-review2.k6f3pfd2/obs \
  bun --cwd packages/coding-agent src/cli.ts metrics show --window 7d --sink /tmp/amaze-cli-review2.k6f3pfd2/obs
```

Observed output:

```text
EXIT: 0
--- stdout ---
AI coding assistant

USAGE
  $ amaze launch [MESSAGES] [FLAGS]

ARGUMENTS
  MESSAGES   Messages to send (prefix files with @)

FLAGS
      --model=<value>                 Model to use (fuzzy match: "opus", "gpt-5.2", or "openai/gpt-5.2")
      --smol=<value>                  Smol/fast model for lightweight tasks (or AMAZE_SMOL_MODEL env)
      --slow=<value>                  Slow/reasoning model for thorough analysis (or AMAZE_SLOW_MODEL env)
      --plan=<value>                  Plan model for architectural planning
      ...
--- stderr ---
```

```text
EXIT: 0
--- stdout ---
Nexus status: ok
- maintenance: ok
- session-reindex: ok
- knowledge-migration: ok
--- stderr ---
```

```text
EXIT: 0
--- stdout ---
goal.completion.passRate: 0.3333 (n=3)
goal.forceCompleteRate: 0.6667 (n=3)
subagent.contractAdoption: 0 (n=0)
subagent.revisionSuccess: 0 (n=0)
subagent.noYieldRate: 0 (n=0)
memory.hitPrecision: 0 (n=0)
memory.staleRate: 0 (n=0)
prompt.cacheChurn: 0 (n=0)
cost.perAcceptedGoal: 0 (n=3)
verifier.bypassRate: 0 (n=3)
--- stderr ---
```

Notes: there is no registered root `doctor` subcommand. `doctor --help` routes to default `launch` help because unknown subcommands are treated as launch arguments. Operators must know to check `memory doctor`, `metrics show`, `rules run`, and observability exports separately.
