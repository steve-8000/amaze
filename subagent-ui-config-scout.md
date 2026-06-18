# subagent-ui-config-scout

1) Parallel progress child row rendering (`Agent 1/3: scout · ...`)
- `vendor/amaze-subagents/src/tui/render.ts`: `resultRowLabel`, `renderSubagentResult`, `buildMultiProgressLabel`, `buildChainRenderEntries`, `modelThinkingBadge`, `widgetStepStatus`
- Tests: `vendor/amaze-subagents/test/integration/render-widget.test.ts`, `vendor/amaze-subagents/test/unit/run-status.test.ts`

2) Single running row rendering (`scout (model · thinking low)` style)
- `vendor/amaze-subagents/src/tui/render.ts`: `renderSubagentResult`, `modelThinkingBadge`, `resultStatusLine`, `formatProgressStats`
- `vendor/amaze-subagents/src/runs/background/async-status.ts`: `formatStepLine`
- Tests: `vendor/amaze-subagents/test/integration/render-widget.test.ts`, `vendor/amaze-subagents/test/integration/async-status.test.ts`

3) `subagents.agentOverrides` settings parsing
- `vendor/amaze-subagents/src/agents/agents.ts`: `readSubagentSettings`, `parseBuiltinOverrideEntry`, `parseOverrideStringArrayOrFalse`, `applyBuiltinOverride`, `applyBuiltinOverrides`, `buildBuiltinOverrideConfig`, `removeBuiltinAgentOverride`
- Tests: `vendor/amaze-subagents/test/unit/agent-overrides.test.ts`

4) Context default handling (`fresh` vs `fork`)
- `vendor/amaze-subagents/src/extension/schemas.ts`: `context` schema field description
- `vendor/amaze-subagents/src/runs/foreground/subagent-executor.ts`: `applyAgentDefaultContext`, `resolveAgentExecutionContext`, `resolveTopLevelParallelTaskContexts`, `resolveChainTaskContexts`, `wrapChainTasksForContexts`
- `vendor/amaze-subagents/src/shared/types.ts`: `DEFAULT_FORK_PREAMBLE`, `wrapForkTask`
- Tests: `vendor/amaze-subagents/test/integration/fork-context-execution.test.ts`, `vendor/amaze-subagents/test/unit/types-fork-preamble.test.ts`, `vendor/amaze-subagents/test/unit/agent-frontmatter.test.ts`

5) `defaultThinkingLevel` touchpoint
- Not in `vendor/amaze-subagents` search results.
- Closest concrete setting parser/use: `packages/coding-agent/src/core/settings-manager.ts` (`getDefaultThinkingLevel`, `setDefaultThinkingLevel`), `packages/coding-agent/src/core/model-resolver.ts` (`findInitialModel`, `defaultThinkingLevel` fallback path), `packages/coding-agent/test/settings-manager.test.ts`
