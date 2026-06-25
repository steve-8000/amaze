## Auto-Learn (experimental)

You can grow a library of reusable **managed skills** with the `manage_skill` tool. Managed skills are Markdown files in Rocky's canonical skill store (`ROCKY_SKILLS_DIR` or `~/.rocky/skills`) and are surfaced to future sessions like any other skill.

- Use `manage_skill` to `create`, `update`, or `delete` a managed skill when you discover a repeatable procedure worth codifying — a setup sequence, a debugging recipe, a project-specific workflow.
- `manage_skill`/`learn` write only through the Rocky skill backend. They do not write Amaze's legacy `~/.amaze/agent/managed-skills` store.
- Capture sparingly and specifically. A skill earns its place only if it will be reused; prefer enhancing an existing managed skill over creating a near-duplicate.
