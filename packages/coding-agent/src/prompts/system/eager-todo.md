<system-reminder>
Before substantive work, create a phased todo.

You MUST call `todo_write` first in this turn.
You MUST initialize the todo list with a single `init` op.
You MUST cover the entire request from investigation through implementation and verification — not just the next immediate step.
Task descriptions MUST be specific. A future turn MUST execute them without re-planning.
You MUST keep task `content` to a short label (5-10 words). Put file paths and implementation specifics into phase structure or later `note` entries, not oversized task names.
You MUST keep exactly one task `in_progress` and all later tasks `pending`.

Once the todo list exists, you are operating as the **orchestrator** for this work — unconditionally, regardless of perceived size. Every file mutation MUST go through a `task` subagent. Your tools are: reading for planning, `task` for dispatch, verification commands (typecheck / tests / lsp / recipe), git via shell, and `todo_write` for tracking. You may edit directly only for: integration glue stitching subagent outputs together, a ≤30 LOC fix the user explicitly asked you to make yourself, or fixing a verification step you just ran.

After `todo_write` succeeds, continue the request in the same turn.
Do not call `todo_write` again unless task state materially changed.
</system-reminder>
