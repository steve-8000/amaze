# Implementation Plan — (A) Subagent UI labels + (B) Durable orchestration/memory policy

Planning only. No files were edited. Targets, sequence, and verification below.

---

## Part A — Subagent UI label changes

### Findings (exact sources)
The displayed lines come from the vendored subagents extension renderer:

- **Top standalone title** (`subagent` / `parallel` / agent name / `chain`) is produced by the tool's `renderCall`:
  - `vendor/amaze-subagents/src/extension/index.ts:431-436`
    ```ts
    renderCall(args, _theme) {
      const params = args as { tasks?: ...; chain?: ...; agent?: string; async?: boolean; clarify?: boolean };
      const mode = params.tasks ? "parallel" : params.chain ? "chain" : params.agent ? params.agent : "subagent";
      const asyncBadge = params.async === true && params.clarify !== true ? " [async]" : "";
      return new Text(`${mode}${asyncBadge}`, 0, 0);
    }
    ```
  - The lowercase `subagent` / `parallel` the user sees are exactly the `mode` values here.
- **Box panel title** (`Subagent`) is the `SubagentBoxWrapper` header:
  - `vendor/amaze-subagents/src/extension/index.ts:447`
    ```ts
    : new SubagentBoxWrapper(inner, theme, "Subagent");
    ```
  - Wrapper renders the header at `vendor/amaze-subagents/src/tui/render.ts:1482` (`SubagentBoxWrapper`, header drawn ~line 1515).
- `name: "subagent"` (index.ts:395) and `label: "Subagent"` (index.ts:396) are tool identity/registration, not the visible duplicate title — leave them unchanged.

### Test constraint (must respect)
`vendor/amaze-subagents/test/unit/index-child-registration.test.ts:95-97` asserts `renderCall(...).text` **includes `[async]`** for async chains and **excludes it** for clarify. Any `renderCall` change must keep that contract or the test must be updated in the same step.

### Recommended change (smallest, keeps test green)
1. **Box title → `Executable`**: `index.ts:447` change string `"Subagent"` → `"Executable"`.
2. **Remove top `subagent`/`parallel` titles**: in `renderCall`, stop emitting the `mode` word; return only the async badge text (empty when not async):
   ```ts
   const asyncBadge = params.async === true && params.clarify !== true ? "[async]" : "";
   return new Text(asyncBadge, 0, 0);
   ```
   - Removes `subagent`, `parallel`, `chain`, and agent-name top titles (user only named the first two, but all are the same redundant header above the box; the box + box content already show mode/status).
   - Keeps `index-child-registration.test.ts` green: async chain still yields `[async]`; clarify yields `""`.

### Alternatives (note, not recommended)
- Full removal `return new Text("", 0, 0)` drops the `[async]` signal → **breaks** the existing test; would require editing that test too. Only choose if product wants zero top line including async.
- Suppress only `parallel`/`subagent` words while keeping `chain`/agent name is inconsistent and harder to justify; avoid.

### Risk to verify during implementation
- Confirm the host renders an empty `Text("")` as no visible line (no stray blank row). If a blank line appears, return a zero-height/empty component per host convention used elsewhere in `render.ts`.

---

## Part B — Durable subagent-first + memory policy (code, not verbal)

### Key finding: where policy is actually read
- Root repo `AGENTS.md` is a mirror of the global rules and is **not read at runtime** (global `~/.amaze/agent/AGENTS.md` states "Project-level `AGENTS.md` files are not read"). Editing repo `AGENTS.md` alone does **not** change agent behavior.
- The runtime system prompt is assembled in code by the dynamic-prompt builder:
  - `packages/coding-agent/src/core/dynamic-prompt/build.ts` → `buildDynamicSystemPrompt()` composes: identity → intent gate → parallel-tools → exploration → verification → tool-section → policies → style (+ tuning, context files, skills).
- **Gap:** there is **no Subagents section and no Memory section** in the dynamic-prompt builder. The Subagents/Memory rules only exist in the global AGENTS.md (personal config, outside the repo). That is why the behavior is not enforced per-turn and the user must keep re-instructing.

### Recommended durable target
Add the policy into the **dynamic-prompt builder (code)** so every turn carries it, mirroring the existing section pattern:

1. **New section file** `packages/coding-agent/src/core/dynamic-prompt/subagents.ts`
   - `buildSubagentsSection(): string` returning a `## Subagent Orchestration` block:
     - Default to subagent-first for non-trivial / parallelizable / context-heavy work; orchestrator stays a router/synthesizer and keeps the section long-running by delegating bounded tasks.
     - Use `{ action: "list" }` before delegating; route by role (context-builder for runtime instruction contracts, scout for recon, planner, reviewer, worker, oracle, researcher).
     - Keep trivial/self-contained work direct (avoid over-delegation).
     - Always verify child output before acting; keep sensitive/destructive/prod/credential work local until approved.
2. **New section file** `packages/coding-agent/src/core/dynamic-prompt/memory.ts`
   - `buildMemorySection(): string` returning a `## Memory` block:
     - Recall relevant memory at the start of non-trivial work; save durable prefs/facts/decisions/lessons after verification; never save secrets/speculation.
     - Fallback: when no memory tool is exposed in the runtime, surface a "Memory Candidate" in the final report instead (matches existing `## Report` convention).
3. **Wire into `build.ts`** `buildDynamicSystemPrompt()` sections array, in a sensible order, e.g. insert `buildSubagentsSection()` after `buildParallelToolsSection()` (delegation belongs with tool-use strategy) and `buildMemorySection()` near policies/verification. Keep blank-string separators consistent with existing entries.
4. **Optional, low-cost** keep repo `AGENTS.md` mirror in sync (Subagents/Memory wording) for human readers, but treat the dynamic-prompt code as the source of truth. Do not rely on it for runtime behavior.

### Why dynamic-prompt over AGENTS.md / vendor prompts
- It is the one place read on **every** turn for the orchestrator, in-repo, and already the established pattern for behavioral policy (intent gate, verification, policies). vendor/amaze-subagents prompts only fire for specific slash workflows, not every turn.

---

## Sequenced execution (smallest first)

1. **A1** edit box title `"Subagent"` → `"Executable"` (`index.ts:447`).
2. **A2** edit `renderCall` to emit badge-only (`index.ts:431-436`).
3. **B1** add `subagents.ts` + `memory.ts` section builders.
4. **B2** wire both into `build.ts` sections array.
5. **B3** add/adjust dynamic-prompt unit tests for the two new sections; update `build.test.ts` if it asserts section order/content.
6. **Docs** optional: sync repo `AGENTS.md` Subagents/Memory wording; add `changes.md` notes in `dynamic-prompt/` and vendor extension.

---

## Verification commands

UI (vendor subagents) — target the affected test first, then unit suite:
```bash
cd vendor/amaze-subagents
node --experimental-strip-types --test test/unit/index-child-registration.test.ts
node --experimental-strip-types --test test/unit/render-helpers.test.ts
npm run test:unit   # NOTE: full unit suite currently has PRE-EXISTING failures
                    # (builtin agent disabling, chain precedence, skills discovery)
                    # unrelated to these edits — confirm no NEW failures vs baseline.
```

Dynamic-prompt policy (coding-agent, vitest):
```bash
cd packages/coding-agent
npx vitest run test/dynamic-prompt/
```

Changed-file diagnostics: run the editor/LSP diagnostics on each edited `.ts` file (`index.ts`, `build.ts`, `subagents.ts`, `memory.ts`) and confirm clean.

Manual UI check: trigger a parallel `subagent` run and confirm (a) no top `subagent`/`parallel` line, (b) box header reads `Executable`, (c) async runs still show `[async]`.

---

## Open questions for parent/user
1. Part A: remove the top title for **all** modes (recommended) or keep `chain`/agent-name and only drop `subagent`/`parallel`?
2. Part A: is a lone `[async]` top line acceptable, or should async runs also have no top line (would require editing `index-child-registration.test.ts`)?
3. Part B: bake policy into dynamic-prompt code (recommended, affects all repo builds) vs. only the user's global `~/.amaze/agent/AGENTS.md` (personal, not in repo)?
4. `vendor/amaze-subagents/` is currently git-untracked — confirm edits there should be tracked/synced for persistence.
