Search prior conversation sessions for relevant content via Nexus FTS5 index.

Returns bounded anchors (`<path>:<line>` with a one-line excerpt) — not full messages.
Use the `read` tool with the returned anchor to inspect the surrounding context.

Parameters:
- `query` (required): FTS5 search expression. Plain phrases are auto-quoted; pass explicit `AND`/`OR`/`NOT`/`NEAR` operators for advanced matching.
- `scope`: `current_project` (default) limits to sessions whose cwd resolves to the same git origin / repo root as the caller; `all` searches every indexed session.
- `role`: filter by `user`, `assistant`, or `system` message role.
- `since`: ISO timestamp lower bound (`2026-05-01T00:00:00Z`).
- `limit`: max anchors to return (1–20, default 8).

The current session is auto-indexed at turn boundaries; older sessions are reindexed when the agent starts. If you searched recently and got no results, the index may not have caught your latest turn yet.
