Create, update, or delete a managed skill in Rocky's canonical skill store (`ROCKY_SKILLS_DIR` or `~/.rocky/skills`).

Managed skills are for repeatable procedures worth codifying: a setup sequence, a debugging recipe, a project-specific workflow. This tool writes through Rocky MCP (`skill_upsert` / `skill_delete`) and does not write Amaze's legacy `~/.amaze/agent/managed-skills` store.

- `action: "create"` — fails if the skill already exists.
- `action: "update"` — overwrites the body; fails if the skill does not exist.
- `action: "delete"` — fails if the skill does not exist.

`name` is kebab-case (lowercase letters, digits, hyphens). The `description` drives discovery, so make it specific. Do not include frontmatter in `body`; it is generated from `name` and `description`.
