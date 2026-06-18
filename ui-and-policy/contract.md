# Runtime Instruction Contract — UI Labels + Orchestration Policy

```json
{
  "contract_type": "runtime_instruction_contract",
  "schema_version": "1.0",
  "intent": "implementation",
  "target_runtime": "worker",
  "routing": {
    "reason": "Two parallel workstreams: (A) UI label changes in subagent rendering code, (B) durable policy patch to AGENTS.md for subagent-first orchestration and memory handling.",
    "confidence": "high"
  },
  "goal": {
    "summary": "Remove top standalone 'subagent'/'parallel' text above the progress box, rename boxed title 'Subagent' → 'Executable', and encode subagent-first + memory-candidate policy into AGENTS.md.",
    "why": "User should not need to repeat reminders about using subagents or memory — they must be structural defaults, not verbal promises.",
    "success_criteria": [
      "renderCall returns null/empty so no standalone title appears above the progress box",
      "SubagentBoxWrapper is constructed with 'Executable' instead of 'Subagent'",
      "tool label field matches 'Executable'",
      "AGENTS.md Subagents section enforces subagent-first as structural default, not a suggestion",
      "AGENTS.md Memory section explains memory-candidate surfacing when tool unavailable",
      "Existing unit tests for renderCall / SubagentBoxWrapper still pass"
    ]
  },
  "scope": {
    "in": [
      "vendor/amaze-subagents/src/extension/index.ts — renderCall, renderResult, tool label",
      "/Users/steve/rocky/amaze/AGENTS.md — Subagents section, Memory section"
    ],
    "out": [
      "vendor/amaze-subagents/src/tui/render.ts — SubagentBoxWrapper class itself is fine; only its instantiation changes",
      "Core runtime files in packages/coding-agent/src/core/",
      "Any other agent prompt files — only AGENTS.md is canonical per its own Authority rule"
    ]
  },
  "context": {
    "user_request": "Remove top 'subagent'/'parallel' standalone title, rename box title 'Subagent' to 'Executable', enforce subagent-first orchestration and memory handling in AGENTS.md",
    "relevant_files": [
      {
        "path": "vendor/amaze-subagents/src/extension/index.ts",
        "lines": "395-396, 434-439, 444-448",
        "relevance": "tool name/label, renderCall (produces standalone title text), renderResult (instantiates SubagentBoxWrapper with header string)"
      },
      {
        "path": "vendor/amaze-subagents/src/tui/render.ts",
        "lines": "1482-1522",
        "relevance": "SubagentBoxWrapper class — the header arg passed at construction becomes the box title"
      },
      {
        "path": "AGENTS.md",
        "lines": "1-44",
        "relevance": "Global rule set. Subagents and Memory sections need hardening. Authority rule says this file is the single source of truth."
      }
    ],
    "evidence": [
      "renderCall line 436: mode = params.tasks ? 'parallel' : ... : 'subagent' — this Text node IS the top standalone title",
      "renderResult line 447: new SubagentBoxWrapper(inner, theme, 'Subagent') — third arg is the box header",
      "tool definition line 396: label: 'Subagent' — tool label shown in various list contexts",
      "AGENTS.md Subagents section is written as guidance (Delegate bounded... Give each...) not as an enforced default",
      "AGENTS.md Memory section says 'Recall... Save...' but gives no behavior when memory tool is absent"
    ],
    "assumptions": [
      "Removing the renderCall text node entirely (returning null) hides the standalone title — confirm TUI renders no title line for null return",
      "The tool name field ('subagent') must stay as-is — it's the internal tool identifier used across the runtime (event matching, ENV vars, etc.)",
      "AGENTS.md at repo root is symlinked from ~/.amaze/agent/AGENTS.md — editing the repo file updates the global config"
    ],
    "unknowns": [
      "Whether renderCall returning null vs an empty Text is safe — check ToolDefinition type for renderCall return type",
      "Whether any test asserts the exact string 'Subagent' in the box header or 'parallel'/'subagent' in renderCall output"
    ]
  },
  "instructions": {
    "must_do": [
      "Change renderCall to return null (or empty Text if null is not a valid return) so no standalone title renders",
      "Change SubagentBoxWrapper construction header arg from 'Subagent' to 'Executable'",
      "Change tool label from 'Subagent' to 'Executable'",
      "Patch AGENTS.md Subagents section to make subagent-first the structural default: non-trivial exploration, implementation, review, planning, and research MUST go through the appropriate subagent; direct execution is the exception for single-file trivial reads or immediate answers",
      "Patch AGENTS.md Memory section to specify: when memory tool is available recall at turn start for non-trivial work, save after verification; when unavailable surface memory candidates in the Report section of every response",
      "Run the unit test for renderCall / SubagentBoxWrapper to confirm no regression"
    ],
    "must_not_do": [
      "Do not rename the tool name field ('subagent') — it is used as an identifier throughout the runtime",
      "Do not touch SubagentBoxWrapper class body — only the instantiation call site changes",
      "Do not add new sections to AGENTS.md — patch existing Subagents and Memory sections in place"
    ],
    "suggested_approach": [
      "1. Check ToolDefinition renderCall return type to decide null vs empty Text",
      "2. Edit index.ts: renderCall returns null/empty, renderResult header 'Executable', label 'Executable'",
      "3. Edit AGENTS.md: Subagents section rewritten as hard rule not a suggestion, Memory section extended with unavailable-tool fallback",
      "4. Run targeted tests for the changed rendering code",
      "5. Verify AGENTS.md reads as intended"
    ]
  },
  "validation": {
    "required": true,
    "commands": [
      {
        "command": "cd vendor/amaze-subagents && node --experimental-strip-types --test test/unit/widget-nested-render.test.ts test/unit/tool-description.test.ts",
        "cwd": "vendor/amaze-subagents",
        "purpose": "Check rendering and tool description tests pass after label changes"
      },
      {
        "command": "npx tsc --noEmit -p tsconfig.json 2>&1 | head -30",
        "cwd": "/Users/steve/rocky/amaze",
        "purpose": "Type-check the index.ts change"
      }
    ],
    "evidence_required": [
      "Test output showing 0 failures for targeted unit tests",
      "No new TypeScript errors in vendor/amaze-subagents/src/extension/index.ts"
    ]
  },
  "permissions": {
    "requires_user_approval": false,
    "reasons": []
  },
  "escalation": {
    "ask_user_when": [
      "renderCall return type does not allow null and empty Text causes layout issues"
    ],
    "stop_when": [
      "A test asserts the exact string 'Subagent' as the box header — surface it before renaming"
    ]
  },
  "output_contract": {
    "format": "code changes + updated AGENTS.md",
    "required_sections": [
      "index.ts patch (renderCall, renderResult header, tool label)",
      "AGENTS.md patch (Subagents section, Memory section)",
      "Test run evidence"
    ]
  },
  "handoff": {
    "next_agent": "worker",
    "task_prompt": "Apply the following changes exactly as specified in this contract.\n\n## Change 1 — vendor/amaze-subagents/src/extension/index.ts\n\n### 1a. tool label (line 396)\nChange `label: \"Subagent\"` → `label: \"Executable\"`\n\n### 1b. renderCall (lines 434-439)\nCheck ToolDefinition renderCall return type. If null is allowed, return null so no standalone title renders. If null is not allowed, return new Text('', 0, 0) (empty string). Do not return mode-derived text.\n\n### 1c. renderResult header (line 447)\nChange `new SubagentBoxWrapper(inner, theme, \"Subagent\")` → `new SubagentBoxWrapper(inner, theme, \"Executable\")`\n\n## Change 2 — AGENTS.md\n\n### 2a. Subagents section — rewrite as structural default\nReplace the current three-bullet guidance with:\n```\n## Subagents\n- Default to subagents for all non-trivial work: exploration, implementation, planning, review, research, and multi-file changes go through the appropriate role (context-builder / planner / worker / reviewer / oracle / researcher / scout). Direct execution is the exception — only for trivial single-step reads or immediate factual answers.\n- Before starting non-trivial work, call agent_run list to confirm available runtimes, then delegate with a goal, scope, limits, and expected output.\n- Verify every subagent output before acting on it or passing it downstream.\n- Keep sensitive, destructive, production, credential, and external-messaging work local until explicitly approved.\n```\n\n### 2b. Memory section — add unavailable-tool fallback\nAppend to the existing Memory bullets:\n```\n- When the memory tool is unavailable, surface memory candidates at the end of every response under a 'Memory Candidate' heading with the candidate value and reason. Do not skip this step.\n```\n\n## Verification\nRun: `cd vendor/amaze-subagents && node --experimental-strip-types --test test/unit/widget-nested-render.test.ts test/unit/tool-description.test.ts`\nExpect: 0 failures. If any test asserts the exact string 'Subagent' as a box header, stop and report before renaming."
  }
}
```

---

## Edit Targets Summary

| File | Location | Change |
|------|----------|--------|
| `vendor/amaze-subagents/src/extension/index.ts` | line 396 `label:` | `"Subagent"` → `"Executable"` |
| `vendor/amaze-subagents/src/extension/index.ts` | lines 434–439 `renderCall` | return `null` or `new Text('', 0, 0)` — no mode text |
| `vendor/amaze-subagents/src/extension/index.ts` | line 447 `renderResult` | `"Subagent"` → `"Executable"` in SubagentBoxWrapper ctor |
| `AGENTS.md` | Subagents section | Replace 3-bullet guidance with hard structural default rule |
| `AGENTS.md` | Memory section | Append unavailable-tool fallback (surface candidates in Report) |

## Risks

1. **renderCall null return** — ToolDefinition may type renderCall as `Component` not `Component | null`. Read the type before patching.
2. **Test string pinning** — `test/unit/tool-description.test.ts` already asserts the tool description text; it should not assert the box header, but verify before renaming.
3. **AGENTS.md symlink** — confirmed `~/.amaze/agent/AGENTS.md → /Users/steve/rocky/amaze/AGENTS.md`. Editing the repo file updates the live config immediately.
4. **`name: "subagent"` must stay** — this is the runtime identifier for event matching (`event.toolName !== "subagent"`), ENV vars, and result dispatch. Only `label` and the rendered header change.
