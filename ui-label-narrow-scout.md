### Recon targets for UI label update

**Render file/function targets**
- `vendor/amaze-subagents/src/extension/index.ts`
  - `tool.renderCall(args, _theme)` — returns standalone top text (`parallel`/`chain`/agent/`subagent`) that appears above the box.
  - `tool.renderResult(result, options, theme, context)` — wraps result with `SubagentBoxWrapper`.
  - `new SubagentBoxWrapper(inner, theme, "Subagent")` — boxed title text source for this tool.

**Related render component target**
- `vendor/amaze-subagents/src/tui/render.ts`
  - `SubagentBoxWrapper` (constructor/header handling + top border render logic using `this.header`).

**Directly related render tests**
- `vendor/amaze-subagents/test/unit/index-child-registration.test.ts`
  - `describe("subagent extension child mode")`
  - `it("does not show async badge for explicit foreground clarify chain calls")` (calls `registeredTool.renderCall(...)` and asserts rendered call text).

No other tests in this repo currently assert the boxed header string directly.
