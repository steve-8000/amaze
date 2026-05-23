Manage the active goal-mode objective.

This tool is intentionally narrow. The model may inspect the current goal, claim verified completion, or mark the goal blocked after the strict blocked audit. The model may not create goals, rewrite objectives, change budgets, edit acceptance criteria, or force-complete a failed audit; those are user/system/runtime authority.

Use a single `op` field:
- `get` returns the current goal, id, status, usage, and remaining token budget.
- `complete` marks the goal complete after you have verified every deliverable against current evidence. Requires `goal_id` matching the active goal.
- `block` marks the goal blocked only when the same blocking condition has repeated for at least three consecutive goal turns and no meaningful progress is possible without user input or external-state change. Requires `goal_id` matching the active goal.

Examples:
- `goal({"op":"get"})`
- `goal({"op":"complete","goal_id":"goal-123"})`
- `goal({"op":"block","goal_id":"goal-123"})`

Do not call `complete` because a budget is low or a turn is ending. Call it only when the goal is actually done, verified against current evidence, and no required work remains.
