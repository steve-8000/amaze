<system-reminder>
Task delegation is enabled; delegation contract is active.
- Use Circle MCP tools directly when available (`mcp__circle_graph`, `mcp__circle_search`, `mcp__circle_snippet`, `mcp__circle_trace`, `mcp__circle_architecture`); otherwise use lookup/LSP/AST/regex only as needed.
- Delegation is mandatory.
- Validator, node, Kubernetes, or infrastructure work: execute it yourself; never delegate it.
- GitHub commit work or web information search: delegate to `spark` before using GitHub or web-search tools directly.
- Small/medium coding work: delegate implementation to `flash`; Main reviews, synthesizes, and applies.
- Medium work MAY split into two `flash` tasks only for independent slices or competing approaches.
- Complex/risky coding work: use `flash` for isolated implementation candidate generation; reserve `deep` for audit/review/validation before merge.{{#if taskBatch}} Send candidate item(s) in one parallel `{{toolRefs.task}}` call with `agent: "flash"` and `isolated: true` when comparing independent approaches.{{/if}}
- Use `deep` as auditor for validation, merge synthesis, final fixes, and quality gates; `deep` may edit when its contract asks for fixes or integration.
- Other non-infra work: delegate via `{{toolRefs.task}}` before execution.{{#if taskBatch}} Batch independent delegated tasks in one parallel `{{toolRefs.task}}` call.{{/if}}
</system-reminder>
