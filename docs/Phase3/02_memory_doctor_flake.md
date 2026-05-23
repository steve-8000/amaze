# T12.2 — memory-doctor aggregate `sessions\0` flake

## Current state (grounded)

`docs/Phase2/closing-report.md:32-34`:
```
fail: test/cli/memory-doctor.test.ts > memory doctor > prints degraded status and the affected Nexus item
Expected to contain: "- session-reindex: ok"
Received: "Nexus status: degraded\n- maintenance: startup write failed\n- session-reindex: Error: ENOENT: no such file or directory, open '.../sessions\0'\n- knowledge-migration: ok\n"
```

Per-directory `test/cli` rerun: exit 0. Aggregate context only. Same flake observed in Phase1's closing report — pre-existing.

The smoking gun is the **null byte** (`\0`) at the end of the `sessions` path. Possible causes:
- A test fixture allocates a path via Bun.spawn output or a C-string that retained its terminator.
- A temp directory name accumulates across tests with state pollution (memoised path with mutation).
- A path-join with a non-string value coerced through `String()` that included a null byte.

## Acceptance

1. `test/cli/memory-doctor.test.ts` passes in both isolation AND when run as part of the full Phase3 aggregate sweep.
2. The root cause is documented in the closing report: which test polluted state, which path was constructed with a null byte, and what fix removes it.
3. No assertion in `memory-doctor.test.ts` is loosened. The fix removes the null byte at its source, not by adjusting expected strings.

## Implementation outline

1. Reproduce the failure under the aggregate sweep command:
   ```
   bun --cwd packages/coding-agent test test/autonomy test/metrics test/observability test/task test/learning test/rules test/nexus test/goals test/cli test/subagent test/memory-backend test/edit test/tools
   ```
2. Bisect using `bun --cwd packages/coding-agent test <subset>` to identify which other directory's run pollutes state before `test/cli`.
3. Inspect path construction in the offending test setup or fixture. Common culprits:
   - `path.join(tmpDir, '\0sessions')` from a mis-encoded environment variable.
   - SQLite database file path carrying a binary value.
   - A `Bun.spawn` output captured as raw bytes including a terminator.
4. Patch at the source — the test fixture or the memory-doctor production code that builds the path. Prefer fixing test isolation (each test should provide a fresh temp dir with a clean path string).

## Boundaries

- Touch: whichever test files or src files carry the bug (likely `test/cli/memory-doctor.test.ts`, possibly a shared fixture under `test/cli/` or a memory-doctor src file under `src/cli/memory.ts` / `src/commands/memory.ts`).
- Do NOT loosen assertions.
- Do NOT skip the test.

## Verification

- `bun --cwd packages/coding-agent test test/cli/memory-doctor.test.ts` exit 0 (isolation, unchanged from current).
- Aggregate command listed in step 1 above exits 0.
- `bun run check:ts` exit 0.
