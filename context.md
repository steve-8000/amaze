# Coding-agent TUI rendering paths: todowrite/todoread + bash summary

## Exact locations for TUI message boxes titled `AMAZE` and `User Prompt`

1. `packages/coding-agent/src/modes/interactive/components/assistant-message.ts`
   - `AssistantMessageComponent.render(width: number): string[]`
   - Title set via `renderOutputBlock({ header: "AMAZE", ... })`.
   - Severity: low (single render path; deterministic)

2. `packages/coding-agent/src/modes/interactive/components/user-message.ts`
   - `UserMessageComponent.render(width: number): string[]`
   - Title set via `renderOutputBlock({ header: "User Prompt", ... })`.
   - Severity: low (single render path; deterministic)

3. `packages/coding-agent/src/modes/interactive/interactive-mode.ts`
   - `addMessageToChat(...)` (assistant/message branches around lines ~3454 and ~3471)
   - Instantiates `new AssistantMessageComponent(...)` and `new UserMessageComponent(...)`, wiring these renderers into the TUI chat flow.
   - Severity: low (call-site only; no alternate render variants found).

## Tests exercising these boxes

1. `packages/coding-agent/test/assistant-message.test.ts`
   - Focuses on `AssistantMessageComponent.render(...)`.
   - Severity: low (Vitest coverage for assistant box shape and OSC marker behavior; does not assert literal header in assertions).

2. `packages/coding-agent/test/user-message.test.ts`
   - Focuses on `UserMessageComponent.render(...)`.
   - Severity: low (directly validates render output length and OSC placement for user message card).

## Likely test command

- `cd packages/coding-agent && npm test -- --run test/assistant-message.test.ts test/user-message.test.ts`

---

## Where tool result rendering for todowrite/todoread lives

1. `packages/coding-agent/src/modes/interactive/interactive-mode.ts`
   - `renderSessionContext(...)` (around lines `~3550+`): builds `ToolExecutionComponent` for assistant `toolCall` content and stores by `toolCallId`.
   - `handle event: tool_execution_end` (around `~3140` in `message_start` branch): finds pending component by `toolCallId` and calls `component.updateResult(...)`.
   - `getRegisteredToolDefinition(...)` (around `~1709`): resolves tool definition from `session.getToolDefinition(...)`.

2. `packages/coding-agent/src/modes/interactive/components/tool-execution.ts`
   - `ToolExecutionComponent.constructor(...)`: captures `toolDefinition` and built-in definition.
   - `updateDisplay(...)`: selects `callRenderer = this.getCallRenderer()` and `resultRenderer = this.getResultRenderer()` from the tool definition.
   - `createCallFallback()` / `createResultFallback()`: only used when custom renderers are missing.
   - `render(width)` and `getCallRenderer()/getResultRenderer()` chain in this component actually render tool call/result blocks in chat.

3. Todo tool renderers that supply the custom UI content:
   - `packages/coding-agent/src/core/extensions/builtin/todotools/tools/todoread.ts`
     - `renderCall(_args, theme)`
     - `renderResult(result, _options, theme)`
   - `packages/coding-agent/src/core/extensions/builtin/todotools/tools/todowrite.ts`
     - `renderCall(args, theme)`
     - `renderResult(result, _options, theme)`
   - Registration point:
     - `packages/coding-agent/src/core/extensions/builtin/todotools/index.ts`
       - `registerTodoReadTool(...)` and `registerTodoWriteTool(...)`
     - Loaded via `packages/coding-agent/src/core/extensions/builtin/index.ts` entry `todowrite`.

## Where bash summary lines like `✔ $ ... (timeout 300s)` are produced

1. `packages/coding-agent/src/core/tools/bash.ts`
   - `formatBashCall(args)` builds the display string: `theme.fg("toolTitle", bold("$ ")) + command + optional (timeout N s)`.
   - `createBashToolDefinition(...).renderCall(...)` returns:
     - `toolCallStatusPrefix(context, theme) + formatBashCall(args)`
     - This is where the status glyph and command text (including timeout suffix) is composed.

2. `packages/coding-agent/src/core/tools/render-utils.ts`
   - `toolCallStatusPrefix(...)` and `formatStatusIcon(...)` produce the leading status icon (checkmark on success, etc.) used by `renderCall` above.

3. The resulting call-line component is shown by the same `ToolExecutionComponent` render path in `interactive/components/tool-execution.ts` when `toolName === "bash"`.

## Minimal change recommendation

- No code change is required to **locate** these paths.
- If you want to normalize summary format across all call lines, minimal change would be:
  1. Adjust `formatBashCall` in `packages/coding-agent/src/core/tools/bash.ts` (or equivalent helpers in `render-utils.ts`) for exact timeout text formatting and icon policy,
  2. Re-run TUI snapshot/interaction test(s) around tool call rendering (targeted to interactive tool output),
  3. Keep todowrite/todoread renderers unchanged unless output shape is being changed intentionally.
