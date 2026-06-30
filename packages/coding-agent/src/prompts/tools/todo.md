**Tasks referenced by verbatim content string, NEVER an auto-generated ID — no "task-1"/"task-N" exists. Pass the content text in the `task` field.**

Manages a phased task list. Pass `ops`: flat array of operations. Next pending task auto-promotes to `in_progress` on each completion. `pending` is a status, not an `op` — leave not-yet-started tasks implicit in `init`/`append`.

## Operations

|`op`|Required fields|Effect|
|---|---|---|
|`init`|`list: [{phase, items: string[]}]`|Initialize full list (replaces existing)|
|`init`|`items: string[]`|Flattened single-phase init|
|`start`|`task`|Mark in progress|
|`done`|`task` or `phase`|Mark completed|
|`drop`|`task` or `phase`|Mark abandoned|
|`rm`|`task` or `phase` (optional)|Remove task or phase's tasks; omit both to clear the list|
|`append`|`phase`, `items: string[]`|Append tasks to `phase`; lazily creates phase|
|`view`|—|Read-only: echo the list, no modify|

## Anatomy
- **Task content**: 5–10 words; what, not how. Unique identifier.
- **Phase name**: short noun phrase (e.g. `Foundation`, `Auth`, `Verification`). Unique identifier. NEVER prefix `1.`, `A)`, `Phase 1:`.

## Rules
- Mark tasks done immediately after finishing.
- Complete phases in order.
- Blocked? `append` a task to the active phase to unblock, or `drop`.
- Keep `task`/`phase` strings stable once introduced.
- Lost the exact task text? `view` echoes the list — NEVER guess from memory; a mismatched `task` string is an error.

## Goal-aligned evidence loops
- Split todo work the same way goal completion audits work: restate the objective as concrete deliverables, then make tasks for the smallest deliverable slices that can be proven independently.
- Map each slice to authoritative evidence before marking it done: file contents, command output, test pass status, audit count, smoke result, or equivalent observed proof.
- Match verification scope to the task claim. A narrow check completes only the narrow slice it proves; broader phases stay open until their own evidence exists.
- For explicit/implicit rubrics, scorecards, or long-running targets, structure phases around scorecard areas and tasks around the smallest point-scoring deliverable slices.
- Keep scoring/evidence details in task labels/phases and final reports; the tool schema accepts only phase names and task-label strings.
- End each scoring loop by reporting changed scope, verification command/result, score movement, remaining blocker, and next highest-ROI slice.

## When to create a list
- Task requires 3+ distinct steps
- User explicitly requests one
- User provides a set of tasks
- New instructions arrive mid-task — capture before proceeding

<critical>
User hands you a multi-step plan — phased todo, numbered/bulleted checklist, or "N bugs/items/tasks":
- You MUST `init` the list with EVERY item as its own task before working.
- Enumerate all; NEVER summarize into fewer tasks, sample "the important ones", drop items, or track the rest from memory.
</critical>
