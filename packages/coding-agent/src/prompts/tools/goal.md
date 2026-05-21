Manage the active goal-mode objective.

Use a single `op` field:
- `create` starts a goal. Requires `objective`; optional `token_budget` must be positive. Use only when the user or system/developer instructions explicitly request goal mode and no goal exists. Do not infer goals from ordinary tasks.
- `get` returns the current goal and remaining token budget.
- `update` mid-goal pivot: partial-merge patch. Pass any of `objective`, `token_budget`, or `design_answers`. `design_answers` MERGES into existing answers — pass a key with empty string to remove it. Use when the user redirects scope, lifts/tightens a constraint, or shifts acceptance criteria; do NOT use to re-run the full Design Interview (that's one-shot at goal entry).
- `complete` marks the goal complete after you have verified every deliverable against current evidence. Do not use it to pause, stop, or acknowledge budget pressure.

Examples:
- `goal({"op":"create","objective":"Implement feature X","token_budget":50000})`
- `goal({"op":"get"})`
- `goal({"op":"update","design_answers":{"scope":"only feature X, drop Y","acceptance":"all tests + e2e green"}})`
- `goal({"op":"update","token_budget":80000})`
- `goal({"op":"complete"})`

Do not call `complete` because a budget is low or a turn is ending. Call it only when the goal is actually done, verified against current evidence, and no required work remains.
