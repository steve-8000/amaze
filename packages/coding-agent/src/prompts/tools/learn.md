Capture a reusable lesson by persisting it as a managed skill.

Use after solving something whose insight will pay off again: a non-obvious fix, a project convention you had to discover, a workflow that worked.

`skill` is required. Use it to create or update the managed skill that should preserve the lesson. If `skill.body` is omitted, the lesson text becomes the generated `SKILL.md` body (with optional context added).

Managed skills are written through the Circle skill backend into Circle's canonical skill store. They do not write Amaze's legacy `~/.amaze/agent/managed-skills` store.

Capture sparingly and specifically. One strong, reusable lesson beats several vague ones.
