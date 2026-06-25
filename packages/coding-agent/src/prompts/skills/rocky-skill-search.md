---
name: rocky-skill-search
description: Use Rocky skill_search/skill_get for skill discovery and management.
---

# Rocky Skill Search

Rocky is the canonical skill registry for this harness. Use `skill_search` to discover relevant skills before assuming the prompt catalog is complete, then use `skill_get` to fetch the full body of a returned skill before applying it.

Use `manage_skill` and `learn` for durable skill management; they write through Rocky MCP into `ROCKY_SKILLS_DIR` / `~/.rocky/skills`, not the legacy Amaze managed-skills directory.
