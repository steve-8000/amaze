Discover, read, create, update, or delete managed skills in Circle's canonical skill store.

Use `skill_search` to discover relevant skills before assuming the prompt catalog is complete. Use `skill_get` or `skill://<name>` to fetch the full body of a returned skill before applying it.

Managed skills are for repeatable procedures worth codifying: a setup sequence, a debugging recipe, a project-specific workflow. This tool writes through the Circle skill backend and does not write Amaze's legacy `~/.amaze/agent/managed-skills` store.

- `action: "create"` — fails if the skill already exists.
- `action: "update"` — overwrites the body; fails if the skill does not exist.
- `action: "delete"` — fails if the skill does not exist.

`name` is kebab-case (lowercase letters, digits, hyphens). The `description` drives discovery, so make it specific. Do not include frontmatter in `body`; it is generated from `name` and `description`.
