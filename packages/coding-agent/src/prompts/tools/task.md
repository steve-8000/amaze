{{#if asyncEnabled}}{{#if batchEnabled}}Spawns subagents to work in the background — one per `tasks[]` item; a single spawn is a one-item batch.{{else}}Spawns ONE subagent per call to work in the background.{{/if}}

- Spawning is non-blocking: the call returns immediately with the agent id{{#if batchEnabled}}s{{/if}} and job id{{#if batchEnabled}}s{{/if}}; each result is delivered automatically when that agent yields.
- Parallelism = {{#if batchEnabled}}multiple `tasks[]` items in ONE call. MUST batch into one `tasks[]` (share `context` once). Separate `task` calls ONLY for a different `agent` type or unrelated `context`{{else}}multiple `task` calls in one assistant message{{/if}}.
- If genuinely blocked on a result, wait with `job poll`; otherwise keep working. `job cancel` terminates a task and **cannot carry a message** — only for stalled/abandoned work.
{{else}}{{#if batchEnabled}}Runs subagents synchronously — one per `tasks[]` item; a single spawn is a one-item batch.{{else}}Runs ONE subagent synchronously per call.{{/if}}

- Spawning is blocking: the call returns only after the agent{{#if batchEnabled}}s{{/if}} finish; results arrive inline.
- Parallelism = {{#if batchEnabled}}multiple `tasks[]` items in ONE call. MUST batch into one `tasks[]` (share `context` once). Separate `task` calls ONLY for a different `agent` type or unrelated `context`{{else}}multiple `task` calls in one assistant message{{/if}}.
{{/if}}
{{#if ircEnabled}}
- Coordinate with agents via `irc` using their ids. Agents reach you and their siblings live the same way.
{{/if}}

<parameters>
{{#if batchEnabled}}- `agent`: optional default agent type for all `tasks[]`; omit only when every task item sets `agent`
{{else}}- `agent`: REQUIRED non-empty agent type to spawn; choose one from `<agents>`{{/if}}
{{#if batchEnabled}}
- `context`: shared background prepended to every assignment — goal, constraints, shared contract (see context-fmt); REQUIRED, session-specific only
- `tasks`: tasks to spawn — one subagent per item, all in parallel:
  - `agent`: agent type for this item; defaults to top-level `agent` when omitted
  - `assignment`: complete self-contained instructions; one-liners and missing acceptance criteria are PROHIBITED
  - `id`: stable agent id, CamelCase, ≤32 chars; generated when omitted
  - `description`: UI label only — subagent never sees it
  - `role`: optional short specialization label for roster display and contract context
{{#if isolationEnabled}}
  - `isolated`: run this spawn in an isolated env; returns patches. Isolated agents are torn down at completion — not addressable afterwards
{{/if}}
{{else}}
- `id`: stable agent id, CamelCase, ≤32 chars; generated when omitted
- `description`: UI label only — subagent never sees it
- `role`: optional short specialization label for roster display and contract context
- `assignment`: complete self-contained instructions; one-liners and missing acceptance criteria are PROHIBITED
{{#if isolationEnabled}}
- `isolated`: run in isolated env; returns patches. Isolated agents are torn down at completion — not addressable afterwards
{{/if}}
{{/if}}
</parameters>

<rules>
- Pick the agent by job type:
  - `ultra`: hardest architecture, root-cause analysis, and implementation.
  - `deep`: auditor for validation, merge synthesis, final fixes, and quality gates.
  - `flash`: fast implementer for small/medium work and independent candidate generation.
  - `spark`: GitHub commit workflows and web information search.
- Small/medium coding work SHOULD start with `flash`; complex/risky comparisons SHOULD use `flash` for isolated implementation candidates and `deep` for review, audit, validation, or merge synthesis.
- Use the simplest correct agent. When unsure between two, choose the more capable one.
- **Maximize fan-out only when the work naturally splits.** Issue the widest {{#if batchEnabled}}`tasks[]` batch{{else}}set of parallel `task` calls{{/if}} that has clear, non-overlapping contracts.
- **Subagents do not verify, lint, or format unless explicitly contracted to.** You run final project-wide gates once across the union of changed files.
- No globs, no "update all", no package-wide scope unless the contract explicitly names the package-wide change.
- Subagents have no conversation history. Every fact, file path, and direction they need MUST be explicit in {{#if batchEnabled}}`context` or the item's `assignment`{{else}}the `assignment`{{/if}}.
{{#if batchEnabled}}
- **Shared background** lives in `context` once — never duplicated across assignments. Pass large payloads via `local://<path>` URIs, not inline.
{{else}}
- **Shared background**: write it ONCE to a `local://` file (e.g. `local://ctx.md`) and reference that path in each assignment. Pass large payloads via `local://<path>` URIs, not inline.
{{/if}}
- Prefer agents that investigate **and** edit in one pass when affected files are known. Use `finder` first only when the target area is genuinely unknown.
- **Read-only agents**: Agents tagged READ-ONLY have no edit/write tools. NEVER hand them an assignment that requires changing files.
</rules>

<parallelization>
{{#if ircEnabled}}
Test: can task B run correctly without seeing A's output? If no, sequence A → B — **unless** B can reasonably ask A for the missing piece over `irc`. Live coordination beats a serial waterfall when the contract is small and easy to describe in a DM.
Still sequence when one task produces a large, evolving contract (generated types, schema migration, core module API) the other consumes wholesale — IRC round-trips do not replace a finished artifact.
Parallel when tasks touch disjoint files, are independent refactors/tests, or only need occasional clarification that can be resolved peer-to-peer.
{{else}}
Test: can task B run correctly without seeing A's output? If no, sequence A → B.
Sequential when one task produces a contract (types, API, schema, core module) the other consumes.
Parallel when tasks touch disjoint files or are independent refactors/tests.
{{/if}}
{{#if ircEnabled}}Sequenced follow-ups SHOULD message the agent that produced the prerequisite — it already holds the context.{{/if}}
</parallelization>

{{#if batchEnabled}}
<context-fmt>
# Goal         ← one sentence: what the batch accomplishes
# Constraints  ← MUST/NEVER rules and session decisions
# Contract     ← exact types/signatures if tasks share an interface
</context-fmt>
{{/if}}

<assignment-fmt>
# Goal     ← what must be finished
# Scope    ← exact files/areas allowed and explicit non-goals
# Steps    ← expected order; include investigation first when needed
# Done     ← observable completion criteria
# Report   ← exact result format to yield
</assignment-fmt>

<agents>
{{#if spawningDisabled}}
Agent spawning is disabled for this context.
{{else}}
{{#list agents join="\n"}}
# {{name}}{{#if readOnly}} — READ-ONLY (no edit/write/exec tools){{/if}}
{{description}}
{{/list}}
{{/if}}
</agents>
