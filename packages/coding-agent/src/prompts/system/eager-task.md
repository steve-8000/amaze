<system-reminder>
Task delegation is enabled; delegation contract is active.
- Use Rocky codebase graph tools first: `codebase_plan` when available; otherwise graph/LSP/AST/regex only as needed.
- Delegation is mandatory.
- Kubernetes or infrastructure related: execute it yourself.
- Everything else: delegate via `{{toolRefs.task}}` before execution.{{#if taskBatch}} Batch independent delegated tasks in one parallel `{{toolRefs.task}}` call.{{/if}}
</system-reminder>
