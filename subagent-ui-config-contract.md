# Runtime Instruction Contract — Subagent UI & Config Changes

**Contract type:** `implementation_contract`  
**Date:** 2026-06-17  
**Scope:** `vendor/amaze-subagents/`  
**Context mode:** fresh (this document is self-contained)

---

## Goal

Implement five targeted changes to the subagent extension:

1. Remove standalone `renderCall` labels for single/parallel/agent names
2. Rename the Subagent box title to **Executable** everywhere
3. Surface `model` **and** `thinking` in parallel child result rows
4. Read `defaultThinkingLevel` from `~/.amaze/agent/settings.json` and apply it as the subagent thinking default
5. Make subagent delegation default to fresh context; replace implicit parent-context inheritance with explicit context-builder JSON contract handoff

---

## Success Criteria

- `bun test` (or `vitest run`) passes on all unit tests in `vendor/amaze-subagents/`
- No TypeScript type errors on changed files
- Widget titles, result box headers, and tool labels all read "Executable" (not "Subagent")
- Widget parallel child rows show `(model:thinking)` badge when both fields are populated
- `defaultThinkingLevel` from settings.json is applied to agent runs when no per-agent `thinking` or model suffix overrides it
- All six builtin agents that have `defaultContext: fork` remain callable with fork; new delegations where `context` is omitted still default fresh
- context-builder is always called with `context: "fresh"` and receives a structured JSON task body

---

## Codebase Inventory

### Changed Files (expected)

| File | Change area |
|---|---|
| `vendor/amaze-subagents/src/extension/index.ts` | renderCall body, tool label |
| `vendor/amaze-subagents/src/extension/fanout-child.ts` | tool label |
| `vendor/amaze-subagents/src/tui/render.ts` | widget title, result row thinking badge |
| `vendor/amaze-subagents/src/shared/types.ts` | `SingleResult.thinking` field |
| `vendor/amaze-subagents/src/agents/agents.ts` | `SubagentSettings`, `readSubagentSettings`, `applyBuiltinOverrides` |
| `vendor/amaze-subagents/src/runs/foreground/subagent-executor.ts` | `defaultThinkingLevel` plumbing, context-builder fresh enforcement |
| `vendor/amaze-subagents/src/runs/background/subagent-runner.ts` | `thinking` field written to `SingleResult` |
| `vendor/amaze-subagents/src/runs/foreground/execution.ts` | same — `thinking` written to `SingleResult` |

### Read-Only References

| File | Role |
|---|---|
| `vendor/amaze-subagents/src/shared/model-info.ts` | `THINKING_LEVELS`, `ThinkingLevel`, `resolveEffectiveThinking`, `splitKnownThinkingSuffix` |
| `vendor/amaze-subagents/src/shared/formatters.ts` | `formatModelThinking(model, thinking)` — already handles both fields |
| `vendor/amaze-subagents/src/agents/context-builder.md` | defines `thinking: medium`, no `defaultContext` (inherits "fresh" default) |
| `vendor/amaze-subagents/agents/planner.md` | `defaultContext: fork` |
| `vendor/amaze-subagents/agents/worker.md` | `defaultContext: fork` |
| `vendor/amaze-subagents/agents/oracle.md` | `defaultContext: fork` |
| `~/.amaze/agent/settings.json` | `{ "defaultThinkingLevel": "xhigh", "subagents": { "agentOverrides": { ... } } }` |

---

## Change 1 — Remove Standalone renderCall Labels

### Problem

`renderCall` in `extension/index.ts:434-438` currently returns either `[async]` or an empty `Text`:

```ts
renderCall(args, _theme) {
    const params = args as { async?: boolean; clarify?: boolean };
    const asyncBadge = params.async === true && params.clarify !== true ? "[async]" : "";
    return new Text(asyncBadge, 0, 0);
},
```

Separately, `buildSingleWidgetLines` at `tui/render.ts:870-878` renders two lines that expose the raw mode string as a standalone label:

```ts
const mode = widgetJobName(job);  // returns "single", "parallel", "chain", or "subagent"
const title = `async subagent ${mode}${count > 1 ? ` (${count})` : ""}`;   // line 874
// ...
`${widgetStatusGlyph(job, theme)} ${themeBold(theme, mode)}${stats}`,       // line 876
```

`mode` resolves to `job.mode ?? "subagent"` (render.ts:288). When mode is "single" the word "single" appears as a standalone label with no agent name attached; for "parallel"/"chain" the same raw enum value appears.

The expanded `renderSubagentResult` multi path (render.ts:1304-1310) also renders `modeLabel` (`d.mode`) as a bold standalone word:

```ts
const modeLabel = d.mode;  // "single" | "parallel" | "chain"
c.addChild(new Text(fit(`${icon} ${theme.fg("toolTitle", theme.bold(modeLabel))}${contextBadge} · ${multiLabel.headerLabel}${summaryStr}`)));
```

### Required Changes

**`extension/index.ts` — `renderCall`**

The function should return an empty `Text` unconditionally. The async badge (`[async]`) was the only content, and it duplicates what the async widget already conveys. Remove the badge:

```ts
renderCall(_args, _theme) {
    return new Text("", 0, 0);
},
```

Alternatively keep the badge but suppress agent name or mode label (there is none currently, so the change is a no-op). The key constraint is: **no agent name, no mode string ("single"/"parallel"/"chain") emitted from `renderCall`.**

**`tui/render.ts` — `buildSingleWidgetLines`**

Replace the standalone `mode` label on line 876 with the agent name (for single mode) or with the agents summary (for parallel/chain). The widget title on line 874 should drop the "subagent" word and instead read the agent name or a concise agent list:

```ts
// BEFORE
const mode = widgetJobName(job);
const title = `async subagent ${mode}${count && count > 1 ? ` (${count})` : ""}`;
return [
    `${theme.fg("toolTitle", themeBold(theme, title))} ${theme.fg("dim", "· background")}`,
    `${widgetStatusGlyph(job, theme)} ${themeBold(theme, mode)}${stats ? ` ${theme.fg("dim", "·")} ${stats}` : ""}`,
    ...
];

// AFTER (sketch — adjust to match existing formatting style)
const agentSummary = job.agents?.length
    ? formatWidgetAgents(job.agents)  // existing helper
    : widgetJobName(job);
const countSuffix = count && count > 1 ? ` (${count})` : "";
const title = `${agentSummary}${countSuffix}`;
return [
    `${theme.fg("toolTitle", themeBold(theme, title))} ${theme.fg("dim", "· background")}`,
    `${widgetStatusGlyph(job, theme)} ${themeBold(theme, agentSummary)}${stats ? ` ${theme.fg("dim", "·")} ${stats}` : ""}`,
    ...
];
```

**`tui/render.ts` — `renderSubagentResult` expanded multi path (~line 1304)**

Replace `modeLabel = d.mode` with a label derived from actual agent names:

```ts
// BEFORE
const modeLabel = d.mode;
c.addChild(new Text(fit(`${icon} ${theme.fg("toolTitle", theme.bold(modeLabel))}${contextBadge} · ...`)));

// AFTER
const agentLabel = d.mode === "single" && d.results[0]?.agent
    ? d.results[0].agent
    : d.chainAgents?.join(" → ") ?? d.mode;
c.addChild(new Text(fit(`${icon} ${theme.fg("toolTitle", theme.bold(agentLabel))}${contextBadge} · ...`)));
```

---

## Change 2 — Rename Subagent Box Title to Executable

### Current State

The `renderResult` hook in `extension/index.ts:445-447` already uses "Executable":

```ts
const wrapper =
    context.lastComponent instanceof SubagentBoxWrapper
        ? context.lastComponent
        : new SubagentBoxWrapper(inner, theme, "Executable");
return wrapper.setHeader("Executable").setInner(inner);
```

`SubagentBoxWrapper` (render.ts:1482) uses the passed `header` string in its `render()` method. ✅

**Remaining gaps:**

| Location | Current Value | Target |
|---|---|---|
| `extension/index.ts:396` | `label: "Subagent"` | `label: "Executable"` |
| `extension/fanout-child.ts:156` | `label: "Subagent"` | `label: "Executable"` |
| `tui/render.ts:874` | `async subagent ${mode}` in title string | Remove "subagent" (covered by Change 1) |

### Required Changes

**`extension/index.ts:396`**

```ts
// BEFORE
label: "Subagent",

// AFTER
label: "Executable",
```

**`extension/fanout-child.ts:156`**

```ts
// BEFORE
label: "Subagent",

// AFTER
label: "Executable",
```

No changes needed to `SubagentBoxWrapper` itself — it already takes `header` as a constructor argument.

---

## Change 3 — Model and Thinking in Parallel Child Rows

### Current State

**Widget rows** (`widgetParallelAgentDetails`, render.ts:418) already pass both fields:

```ts
const modelDisplay = modelThinkingBadge(theme, step.model, step.thinking);
// AsyncJobStep has model?: string and thinking?: string ✅
```

**Result rows** (`renderSubagentResult` multi loop, render.ts:1396) only pass `model`:

```ts
const modelDisplay = modelThinkingBadge(theme, r.model);  // r is SingleResult
// SingleResult.thinking does NOT exist → thinking is silently dropped
```

`formatModelThinking(model, thinking)` at `shared/formatters.ts:19` handles both and can extract thinking from model suffix (`:high`, `:xhigh`) via `splitKnownThinkingSuffix`. The `thinking` argument just enriches the display when the field is populated separately.

**`SingleResult`** at `shared/types.ts:387` currently has `model?: string` but no `thinking` field.

### Required Changes

**`shared/types.ts` — `SingleResult`**

Add `thinking` field alongside `model`:

```ts
export interface SingleResult {
    // ... existing fields ...
    model?: string;
    thinking?: string;   // <-- add this line
    attemptedModels?: string[];
```

**Writer side** — wherever `SingleResult` is assembled from a completed run, populate `thinking`. The two paths are:

- `runs/foreground/execution.ts` — foreground single/parallel result assembly
- `runs/background/subagent-runner.ts` — background result deserialization

In each location, find where `model` is assigned to the result object and add `thinking` from the same run config:

```ts
// pattern: wherever `model: effectiveModel` or `model: run.model` appears in result construction
thinking: resolveEffectiveThinking(effectiveModel, agentConfig.thinking),
//        ^ from shared/model-info.ts — already imported in executor
```

**`tui/render.ts` — result row (~line 1396)**

```ts
// BEFORE
const modelDisplay = modelThinkingBadge(theme, r.model);

// AFTER
const modelDisplay = modelThinkingBadge(theme, r.model, r.thinking);
```

Also fix the single-result compact renderer at render.ts:1023 for consistency:

```ts
// BEFORE
const modelDisplay = modelThinkingBadge(theme, r.model);

// AFTER
const modelDisplay = modelThinkingBadge(theme, r.model, r.thinking);
```

---

## Change 4 — defaultThinkingLevel from settings.json

### Current State

`~/.amaze/agent/settings.json` has:

```json
{
  "defaultThinkingLevel": "xhigh",
  "subagents": {
    "agentOverrides": { ... }
  }
}
```

`readSubagentSettings()` at `agents/agents.ts:386-415` reads only the `settings.subagents` key. The top-level `defaultThinkingLevel` is silently ignored. `SubagentSettings` interface (agents.ts:103) only carries `overrides` and `disableBuiltins`.

### Required Changes

**`agents/agents.ts` — `SubagentSettings`**

```ts
// BEFORE
interface SubagentSettings {
    overrides: Record<string, BuiltinAgentOverrideConfig>;
    disableBuiltins?: boolean;
}

// AFTER
interface SubagentSettings {
    overrides: Record<string, BuiltinAgentOverrideConfig>;
    disableBuiltins?: boolean;
    defaultThinkingLevel?: string;  // ThinkingLevel value from top-level settings key
}
```

**`agents/agents.ts` — `readSubagentSettings()`**

After the existing `subagents` block parsing, read the top-level `defaultThinkingLevel`:

```ts
function readSubagentSettings(filePath: string | null): SubagentSettings {
    if (!filePath) return EMPTY_SUBAGENT_SETTINGS;
    const settings = readSettingsFileStrict(filePath);

    // ... existing subagents parsing ...

    // NEW: read top-level defaultThinkingLevel
    let defaultThinkingLevel: string | undefined;
    const dtl = settings.defaultThinkingLevel;
    if (dtl !== undefined) {
        if (typeof dtl !== "string" || !THINKING_LEVELS.includes(dtl as ThinkingLevel)) {
            throw new Error(`settings.defaultThinkingLevel in '${filePath}' must be one of: ${THINKING_LEVELS.join(", ")}.`);
        }
        defaultThinkingLevel = dtl;
    }

    return { overrides: parsed, disableBuiltins, defaultThinkingLevel };
}
```

Import `THINKING_LEVELS` from `../shared/model-info.ts` (already available in the package).

**`agents/agents.ts` — `discoverAgents()` return type**

`discoverAgents` currently returns `{ agents, chains, ..., userSettingsPath, projectSettingsPath }`. The calling executor needs access to `defaultThinkingLevel`. Options:

- **(Preferred)** Add `defaultThinkingLevel?: string` to the discovery result and populate it from the merged settings (project wins over user, matching the `disableBuiltins` precedence pattern).
- Alternatively expose a separate `getDefaultThinkingLevel(cwd, scope)` function.

**`runs/foreground/subagent-executor.ts` — apply default thinking level**

After agent discovery (~line 2459 where `applyAgentDefaultContext` is called), apply the default thinking level when no per-agent thinking override is present:

```ts
// When building the amaze args for a run, resolve thinking:
// priority: explicit model suffix > per-agent AgentConfig.thinking > discovered defaultThinkingLevel
const effectiveThinking = agentConfig.thinking
    ?? discoveredDefaultThinkingLevel  // from discoverAgents result
    ?? undefined;
```

Pass `effectiveThinking` to `resolveEffectiveThinking(model, effectiveThinking)` when constructing the run config for each single/parallel/chain step. The `resolveEffectiveThinking` function in `model-info.ts` already handles the priority (model suffix beats config value).

---

## Change 5 — Fresh Context Default + context-builder JSON Contract Handoff

### Current State

**Context resolution** (`subagent-executor.ts:928-930`):

```ts
function resolveAgentExecutionContext(agent: AgentConfig | undefined, explicitContext): SubagentExecutionContext {
    if (explicitContext) return explicitContext;
    return agent?.defaultContext === "fork" ? "fork" : "fresh";
}
```

Fresh is already the implicit default when no agent `defaultContext` is set. Three builtin agents have `defaultContext: fork` in their frontmatter:
- `agents/planner.md`
- `agents/worker.md`  
- `agents/oracle.md`

`context-builder.md` has **no** `defaultContext` and thus already defaults to "fresh". ✅

The issue is with the **calling convention**: parent agents delegating to `context-builder` currently pass a raw text task (or no task) and let context-builder inherit whatever context mode the call happens to have. The goal is to make delegation to context-builder always: (a) use `context: "fresh"` and (b) carry a structured JSON contract body as the task.

### Required Changes

**Part A — Enforce fresh context for context-builder calls**

In `applyAgentDefaultContext()` at `subagent-executor.ts:916`, add a guard that forces `fresh` for any call targeting `context-builder` even if the parent params specify `context: "fork"`:

```ts
function applyAgentDefaultContext(params: SubagentParamsLike, agents: AgentConfig[]): SubagentParamsLike {
    if (params.context !== undefined) {
        // NEW: context-builder must always run fresh — override a fork request
        if (params.agent === "context-builder" && params.context === "fork") {
            return { ...params, context: "fresh" };
        }
        return params;
    }
    // ... existing logic ...
}
```

For parallel/chain calls where one step targets `context-builder`, `resolveAgentExecutionContext` already returns "fresh" (no `defaultContext: fork` on that agent). No additional change needed for those paths.

**Part B — context-builder JSON contract handoff convention (prompt / schema)**

This change is primarily instructional, but has a light code-surface:

The AGENTS.md preamble that is injected into the parent agent runtime already says (from `subagent-prompt-runtime.ts`):

> "The parent session owns delegation, orchestration, review fanout, and follow-up worker launches."

A new rule should be added there (or in the subagent tool description) to make the contract-handoff convention explicit:

```
When delegating to context-builder, always:
  1. Use context: "fresh" (context-builder must not inherit the parent thread).
  2. Pass a structured JSON task body conforming to the runtime-instruction-contract schema
     (contract_type, intent, target_runtime, goal, scope, context, instructions, validation).
  3. Do NOT pass raw prose requests that require context-builder to re-read the current
     conversation to understand the goal.
```

**Code surface for this rule:**

- `runs/shared/subagent-prompt-runtime.ts` — add the above rule to the `SUBAGENT_PARENT_PREAMBLE` or equivalent constant that is injected into the orchestrator's system prompt.
- `extension/schemas.ts` — consider adding a `ContextBuilderContract` TypeBox schema that validates the structured task object, but this is optional; the tool currently accepts free-form `task: string`.

**`runtime-instruction-contract.json` schema compatibility note:**  
The context-builder agent's own system prompt already defines and validates the JSON contract shape (tested in `test/unit/context-builder-contract.test.ts`). No changes needed there. The new code just enforces that callers pass a machine-readable task body rather than freeform prose.

---

## Validation Steps

| # | Command | Working Directory | Purpose |
|---|---|---|---|
| 1 | `bun test` or `npx vitest run` | `vendor/amaze-subagents/` | Full unit test suite — must pass |
| 2 | `npx tsc --noEmit` | `vendor/amaze-subagents/` | Type-check all changed files |
| 3 | Manual inspect: launch amaze, run `subagent({ agent: "oracle", task: "say hello" })` | any project | Confirm "Executable" box title, no "Subagent" visible |
| 4 | Manual inspect: run a parallel subagent call with known model | any project | Confirm model+thinking badge appears in each child row |
| 5 | Set `defaultThinkingLevel: "high"` in `~/.amaze/agent/settings.json` and inspect log | any project | Confirm thinking level applied to agent run |
| 6 | Call `subagent({ agent: "context-builder", context: "fork", task: "{...}" })` | any project | Confirm executor silently upgrades to "fresh" |

Pre-existing test coverage to verify still passes:

- `test/unit/context-builder-contract.test.ts` — validates context-builder system prompt shape
- `test/unit/types-fork-preamble.test.ts` — validates fork preamble constants
- `test/unit/widget-nested-render.test.ts` — validates widget render output (affected by label changes)

---

## Risks and Constraints

| Risk | Severity | Mitigation |
|---|---|---|
| `SingleResult.thinking` field added — downstream JSON serializers that do exact key-match may not round-trip it | Low | Field is `optional`; existing consumers ignore unknown fields |
| Renaming `label: "Subagent"` affects host apps that key off the label string | Medium | Audit host-side label usage before shipping; search for `"Subagent"` in the main amaze package |
| Forcing `context: "fresh"` for context-builder breaks a caller that explicitly needs fork | Low | The explicit `fork` override is rare and always intentional; the guard only fires for context-builder specifically; document the override path |
| `defaultThinkingLevel` parsed from top-level settings key — project-level `settings.json` may also have this key | Low | Apply same user/project precedence as `disableBuiltins`: project-level wins when both are set |
| Widget label refactor (Change 1) — `formatWidgetAgents` helper may truncate long agent name lists differently per terminal width | Low | Keep existing `truncLine` wrapping; use `widgetJobName` fallback when `job.agents` is empty |

---

## Out of Scope

- Changes to the `context-builder.md` system prompt itself (already compliant)
- Changing `defaultContext: fork` on `planner.md`, `worker.md`, `oracle.md` — those remain fork by agent definition; this contract does not touch agent frontmatter
- Structured-output schema for context-builder task input (TypeBox schema for the JSON contract body is optional; deferred unless caller validation is explicitly requested)
- UI changes to the clarify TUI (`runs/foreground/chain-clarify.ts`) — not in scope
