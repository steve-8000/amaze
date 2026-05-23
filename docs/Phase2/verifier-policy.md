# Verifier uncertain policy
> **Status**: landed (2026-05-23) — reference


`goal.uncertainPolicy` controls how `AcceptanceVerifier.summarize` treats criteria that return `uncertain`.

| Policy | Verifier mode | Operator effect |
| --- | --- | --- |
| `allow` | `audit` | `uncertain` is reported but does not block completion; only `fail` blocks. |
| `warn` | `audit` | Same completion behavior as `allow`, plus a `verifier.criterion` warning event for each uncertain criterion. |
| `block-manual` | `contract` | Criteria whose blocking policy is `uncertain-blocks` block completion when uncertain, but an explicit force-complete remains available. |
| `block-all` | `contract` | Criteria whose blocking policy is `uncertain-blocks` block completion when uncertain, with no force-complete path. |

## Worked examples

### `allow`

A goal has an `lsp-clean` criterion. The verifier cannot reach an LSP provider, so the criterion returns `uncertain`. In `allow`, runtime summarizes in `audit` mode: the result is visible in the audit record, but completion can proceed because there is no `fail`.

### `warn`

A goal has a `llm-judged` criterion and no judge runner is configured, so the criterion returns `uncertain`. In `warn`, runtime still summarizes in `audit` mode and allows completion, but emits a warning event so operators can see that a human-judged or model-judged check was not proven.

### `block-manual`

A goal has a `scope-include` criterion with the default `uncertain-blocks` policy. If changed-file attribution is ambiguous and the criterion returns `uncertain`, runtime summarizes in `contract` mode and treats that criterion as failing. Completion is blocked unless an operator explicitly force-completes after reviewing the evidence.

### `block-all`

A goal has an `lsp-clean` criterion with the default `uncertain-blocks` policy. If diagnostics are unavailable and the criterion returns `uncertain`, runtime summarizes in `contract` mode and treats the goal as failed. No force-complete path is available; the missing diagnostics or criterion evidence must be resolved.
