# Subagent Context Architecture Cleanup

Date: 2026-06-24

## Goal

Redesign the coding-agent subagent and context-injection architecture so that every byte sent to a model has one clear owner, one explicit policy gate, and one observable audit path.

This document is based on the current implementation in `packages/coding-agent/` and `packages/agent/`. It is intended as a development guide, not a retrospective note.

## Current Source-Grounded Model

The final provider boundary is in `packages/agent/src/agent-loop.ts`.

Current request flow:

1. `context.messages`
2. `config.transformContext(messages, signal)`
3. `config.convertToLlm(messages)`
4. `normalizeMessagesForProvider(...)`
5. `Context { systemPrompt, messages, tools }`
6. `config.transformProviderContext(llmContext, model)`
7. provider `streamFn`

Important consequences:

- Only `systemPrompt`, converted `messages`, `tools`, and provider-context transforms reach the model.
- `display: false` does not exclude a message from the model. It only hides it from the UI.
- `custom_message.content` participates in LLM context.
- `custom_message.details` is extension/session metadata and is not sent to the LLM.
- IRC labels placed in `details` are UI/history metadata. IRC message text rendered into `content` is real model context.
- A background task success does not automatically wake the parent session today because task jobs are registered with `deliverOnSuccess: false`.
- Async job failures and non-task async completions can still enter model context through async delivery, `YieldQueue`, and idle prompt injection.

Primary source references:

- `packages/agent/src/agent-loop.ts` - provider context construction.
- `packages/coding-agent/src/session/messages.ts` - `AgentMessage[]` to LLM message conversion.
- `packages/coding-agent/src/session/session-entries.ts` - `custom_message` context contract.
- `packages/coding-agent/src/sdk.ts` - system prompt rebuild, extension context hooks, provider transforms.
- `packages/coding-agent/src/session/agent-session.ts` - prompt assembly, hidden messages, auto continuations, IRC wakeups.
- `packages/coding-agent/src/task/index.ts` - task tool and subagent spawning.

## Source Evidence Matrix

This section separates verified source behavior from intended architecture.

| Behavior | Verified Source | Runtime Meaning |
|---|---|---|
| Provider context is built after context transforms and before provider streaming | `packages/agent/src/agent-loop.ts` | The final cost boundary is provider `Context`, not UI transcript entries. |
| `custom_message.content` is model-visible | `packages/coding-agent/src/session/messages.ts`, `packages/coding-agent/src/session/session-entries.ts` | Hidden custom messages still cost tokens unless excluded before conversion. |
| `custom_message.details` is not model-visible | `packages/coding-agent/src/session/messages.ts` | Labels, job ids, and IRC metadata in `details` are safe for UI/storage only. |
| `sendCustomMessage(..., { triggerTurn: true })` can start an agent-initiated turn | `packages/coding-agent/src/session/agent-session.ts` | This is a major internal automation bypass unless routed through `TurnScheduler`. |
| Queued hidden next-turn messages can prompt later | `AgentSession.#queueHiddenNextTurnMessage`, `#promptQueuedHiddenNextTurnMessages` | A message can be stored while streaming and become model-visible after the current turn. |
| Idle queued messages can call `agent.continue()` | `AgentSession.#scheduleQueuedMessageDrain` | Queue drain is an automatic turn source and needs scheduler admission. |
| `YieldQueue` can call `agent.prompt(...)` when idle | `AgentSession` `YieldQueue.injectIdle`, `packages/coding-agent/src/session/yield-queue.ts` | Async/yield delivery is a model-turn source separate from task spawning. |
| Background task success is retained, not delivered | `packages/coding-agent/src/task/index.ts` with `deliverOnSuccess: false`; `packages/coding-agent/src/async/job-manager.ts` | Completed subagent result is retrievable, but does not itself auto-prompt the parent. |
| Background task failure is delivered | `AsyncJobManager.register` catches failures and calls `#enqueueDelivery` | Failed background jobs can still inject follow-up context via async delivery. |
| Completed task/subagent history remains addressable | `packages/coding-agent/test/task/task-spawn.test.ts` | Loop prevention must distinguish transcript/history access from live revival. |

## Current Context Injection Inventory

### System Prompt Inputs

These are assembled before the request and become `context.systemPrompt`.

- Base coding-agent system prompt.
- `AGENTS.md` and context files.
- Rule and always-apply rule summaries.
- Tool inventory and optional inline tool descriptors.
- Model identity when `includeModelInPrompt` is enabled.
- Workspace tree when `includeWorkspaceTree` is enabled.
- Memory backend developer instructions.
- Auto-learn guidance when the tool set supports it.
- MCP server instructions, truncated per server.
- User append prompt and custom system prompt.

Current config-sensitive defaults:

- `includeWorkspaceTree`: default `false`.
- `inlineToolDescriptors`: default `false`.
- `includeModelInPrompt`: default `true`.
- `memory.backend`: default `off`, but the inspected local config uses `rocky`.
- `compaction.enabled`: default `true`.
- `compaction.strategy`: default `snapcompact`.

### Message Inputs

These enter through `AgentMessage[]` and become provider messages through `convertToLlm`.

- User prompts.
- Developer messages.
- Assistant messages.
- Tool results.
- Bash and Python execution results unless `excludeFromContext` is set.
- File mentions, rendered as developer `<file path="...">...</file>` blocks.
- Custom hidden messages such as plan mode, goal mode, image description notices, eager todo/task preludes, todo reminders, TTSR injections, session-stop continuations, auto-learn nudges, IRC messages, and extension messages.

### Provider Transform Inputs

These mutate the final outgoing provider context.

- Extension `context` hook mutates or adds `AgentMessage[]` before conversion.
- Extension `before_provider_request` can mutate the provider payload.
- Snapcompact inline transforms can move selected prompt/tool-result content into image payloads.
- Secret obfuscation can rewrite outgoing message text.
- Owned/in-band dialect mode can append tool-calling instructions to the system prompt and encode tool history into messages.

### Automatic Turn Sources

These can create model requests without a direct new user prompt.

- Compaction auto-continue.
- Todo completion reminders.
- `session_stop` extension continuation.
- Empty-stop retry.
- Unexpected-stop retry.
- TTSR interrupt continuation.
- IRC wakeups.
- IRC auto-reply when async is disabled.
- Async/yield queue idle injections and queued-message drains.
- Auto-learn capture turn when `autolearn.autoContinue` is enabled.
- Background task failures through async delivery.

Not automatic turns by themselves:

- Successful background task/subagent completion. The task job stores `resultText`, but `deliverOnSuccess: false` prevents a parent wake.
- Transcript/history reads such as `history://AgentName`. These are explicit tool/context reads, not autonomous continuations.

## Problems To Fix

### 1. Hidden Context Is Too Easy To Add

Many features add `display: false` custom messages. That is correct for UI, but misleading for context cost. The system lacks a central ledger that says why a hidden message entered the model context.

Required correction: hidden messages must carry a context policy and audit reason, not only a custom type.

### 2. Prompt Assembly, Context Injection, And Turn Scheduling Are Interleaved

`AgentSession` currently owns prompt preparation, auto-turn recovery, compaction checks, extension hooks, IRC delivery, todo nudges, TTSR recovery, and task lifecycle glue. This makes loop prevention difficult because a feature can inject context and schedule a turn from a local branch.

Required correction: split provider-context assembly from automatic turn scheduling.

### 3. Subagent Contracts Are Not A First-Class Runtime Boundary

The desired model is contract-based delegation: a subagent receives a thin subagent system prompt plus a task contract, not the full parent prompt. The current implementation has several inherited paths: settings, tools, memory backend, MCP manager, IRC, plan context, output schema, and extension/runtime state.

Required correction: subagent creation must go through one `SubagentLaunchSpec` object that lists inherited and blocked surfaces explicitly.

### 4. Auto Continuation Has Multiple Owners

Loop risk comes from independent continuation sources rather than from one obvious loop. Session stop, todo reminders, compaction, TTSR, retry, IRC, and async work can all create additional turns.

Required correction: all automatic turns must be admitted through one `TurnScheduler` with budgets and dedupe keys.

### 5. Config Defaults Are Useful For Main Agents But Too Expensive For Subagents

Main agents can benefit from memory, todo reminders, auto-learn, eager task guidance, and broad tools. Subagents should be narrower by default.

Required correction: create a separate subagent context profile with conservative defaults.

## Target Architecture

### Layer 1: Context Sources

Introduce a small internal model for all model-visible context.

Proposed type:

```ts
export type ContextVisibility = "provider" | "ui" | "storage";

export type ContextSourceKind =
	| "system"
	| "user"
	| "tool_result"
	| "file_mention"
	| "extension"
	| "memory"
	| "mcp"
	| "irc"
	| "todo"
	| "task"
	| "compaction"
	| "retry"
	| "ttsr"
	| "autolearn"
	| "goal"
	| "plan";

export interface ContextEnvelope {
	kind: ContextSourceKind;
	visibility: ContextVisibility;
	customType?: string;
	owner: string;
	reason: string;
	tokenRisk: "low" | "medium" | "high";
	content: AgentMessage | string[];
}
```

This type does not need to replace `AgentMessage` immediately. It can start as a metadata wrapper used by injection helpers.

Rule: anything that reaches `convertToLlm` must have an owner and reason.

### Layer 2: ContextPolicy

Add one policy gate that decides whether a context source can enter a given session kind.

Inputs:

- `agentKind`: main or subagent.
- `taskDepth`.
- `launchMode`: user, contract-subagent, eval, advisor, background.
- `sourceKind`.
- `customType`.
- `settings`.
- `contract`.

Outputs:

- allow provider context.
- allow UI/storage only.
- drop.
- cap/truncate.
- require audit warning.

Initial policy:

| Source | Main Agent | Contract Subagent |
|---|---|---|
| Thin subagent system prompt | N/A | allow |
| Parent full system prompt | allow | deny |
| User task contract | allow | allow |
| Memory instructions | allow by config | deny by default |
| MCP server instructions | allow by config | deny by default unless tool is exposed |
| Auto-learn | allow by config | deny |
| Todo reminders | allow by config | deny by default |
| Task eager prelude | allow by config | deny |
| IRC incoming content | allow when IRC enabled | allow only while live/running |
| Session-stop continuation | allow top-level only | deny |
| TTSR injection | allow | allow only if rule source applies to subagent |
| Extension context hook | allow | deny by default unless extension declares subagent-safe |

### Layer 3: ContextAssembler

Move provider-context assembly into a focused component.

Responsibilities:

- Build system prompt sections.
- Collect turn messages.
- Apply `ContextPolicy`.
- Produce `AgentMessage[]`.
- Produce an audit summary for debug and tests.

Non-responsibilities:

- It must not schedule turns.
- It must not wake IRC recipients.
- It must not run compaction.
- It must not mutate provider payload directly.

Suggested files:

- `packages/coding-agent/src/context/context-source.ts`
- `packages/coding-agent/src/context/context-policy.ts`
- `packages/coding-agent/src/context/context-assembler.ts`
- `packages/coding-agent/src/context/context-audit.ts`

### Layer 4: TurnScheduler

Introduce one scheduler for every automatic model request.

Responsibilities:

- Accept requests from compaction, todo, session-stop, IRC, TTSR, retry, async/yield, and auto-learn.
- Apply per-session and per-source budgets.
- Dedupe repeated continuation requests.
- Block subagent revival after completed contract runs.
- Emit audit events with source, reason, and remaining budget.

Proposed type:

```ts
export type AutoTurnSource =
	| "compaction"
	| "todo-reminder"
	| "session-stop"
	| "empty-stop-retry"
	| "unexpected-stop-retry"
	| "ttsr"
	| "irc"
	| "yield"
	| "autolearn"
	| "async-yield";

export interface AutoTurnRequest {
	source: AutoTurnSource;
	sessionId: string;
	dedupeKey: string;
	message: AgentMessage;
	triggerTurn: boolean;
	maxPerSession: number;
	maxConsecutive: number;
}
```

Initial hard limits:

- `session-stop`: max 3 per top-level session, existing behavior preserved.
- `empty-stop-retry`: max 3, existing behavior preserved.
- `unexpected-stop-retry`: max 3, existing behavior preserved.
- `todo-reminder`: use `todo.reminders.max`.
- `ttsr`: max 3 automatic continuations per session; rule repeat eligibility remains owned by `TtsrManager`.
- `irc`: no wake after subagent contract completion.
- `autolearn`: no automatic turn unless `autolearn.autoContinue` is true; max 3 automatic capture turns per session.
- `async-yield`: max 3 idle prompt injections per session unless a direct user turn resets the budget.

### Layer 5: SubagentLaunchSpec

Subagent creation should be driven by one immutable launch spec.

Proposed type:

```ts
export interface SubagentLaunchSpec {
	id: string;
	agentName: string;
	displayName: string;
	modelProfile: "claude_high" | "claude_low" | "codex_high" | "codex_low" | "xai" | "local_llm";
	thinking: "low" | "medium" | "high" | "auto";
	taskDepth: number;
	contract: SubagentContract;
	contextProfile: "contract";
	tools: {
		allow: string[];
		deny: string[];
	};
	irc: {
		enabled: boolean;
		revivable: boolean;
	};
	memory: {
		mode: "off" | "tools-only" | "full";
	};
	extensions: {
		allowContextHooks: boolean;
	};
}
```

The config should still expose model choice directly through names such as `claude_high`, `claude_low`, `codex_high`, `codex_low`, `xai`, and `local_llm`. The launch spec maps those configured profiles to runtime model IDs and thinking levels.

Contract subagents should default to:

- `contextProfile: "contract"`.
- `memory.mode: "off"`.
- no parent full system prompt.
- thin subagent system prompt.
- task contract as the primary user/developer context.
- `revivable: false` after completion.
- no session-stop continuation.
- no auto-learn.
- no eager task/todo prelude.

### Layer 6: Context Audit Output

Every provider request should be able to expose a compact audit object in debug logs or tests.

Example:

```json
{
	"sessionId": "abc",
	"agentKind": "sub",
	"requestReason": "task",
	"systemSections": ["thin-subagent", "contract"],
	"messageSources": [
		{ "kind": "task", "customType": "subagent-contract", "tokenRisk": "medium" },
		{ "kind": "irc", "customType": "irc:incoming", "tokenRisk": "low" }
	],
	"deniedSources": [
		{ "kind": "memory", "reason": "contract subagent memory.mode=off" },
		{ "kind": "autolearn", "reason": "disabled for subagents" }
	]
}
```

The audit must be generated before provider-specific transforms so it captures coding-agent intent. A second optional provider audit can be emitted after `before_provider_request` for debugging extensions.

## Desired Runtime Flow

### Main Agent User Turn

1. User prompt enters `AgentSession.prompt`.
2. `TurnScheduler` clears consecutive auto-turn counters for direct user input.
3. `ContextAssembler` collects system prompt and turn messages.
4. `ContextPolicy` allows main-agent sources based on settings.
5. `Agent.prompt(messages)` runs.
6. `agent-loop` performs final conversion and provider call.
7. Post-turn features request automatic turns through `TurnScheduler`, not directly through `agent.continue()` or hidden prompt helpers.

### Contract Subagent Turn

1. Task tool builds `SubagentLaunchSpec`.
2. Launch spec builds a `SubagentContract`.
3. `ContextAssembler` selects thin subagent prompt and contract only.
4. Parent context is included only if explicitly copied into the contract.
5. Subagent runs to completion.
6. Result is returned through structured output/yield/final transcript.
7. Completed contract subagent becomes transcript-only and cannot be revived by IRC.

### IRC Message To Running Subagent

1. IRC bus delivers message.
2. If subagent is running, `TurnScheduler` admits an IRC aside.
3. `ContextPolicy` allows `irc:incoming` content only for live/running contract sessions.
4. If the subagent is completed, the message is rejected or reported as transcript-only.

## Development Plan

### Phase 1: Audit Without Behavior Change

Goal: make current context behavior observable.

Tasks:

1. Add `ContextSourceKind`, `ContextAuditEntry`, and `ContextAudit` types.
2. Add small helpers for creating hidden custom messages with explicit owner/reason metadata.
3. Log or test audit entries before provider conversion.
4. Add tests proving:
   - `display:false` messages are provider-visible.
   - `details` are not provider-visible.
   - IRC `details` labels are not provider-visible.
   - `custom_message.content` is provider-visible.

### Phase 2: Centralize Automatic Turns

Goal: prevent loop bugs by routing every automatic continuation through one admission gate.

Tasks:

1. Add `TurnScheduler`. Done in `packages/coding-agent/src/session/turn-scheduler.ts`.
2. Route session-stop continuation through it. Done in `AgentSession.#emitSessionStopEvent`.
3. Route todo reminders through it. Done in `AgentSession.#checkTodoCompletion`.
4. Route TTSR continuation through it. Done for both deferred follow-up and interrupt retry paths.
5. Route compaction auto-continue through it. Done for post-compaction auto-continue prompts.
6. Route IRC wakeups through it. Done for idle incoming messages and stranded IRC aside wake turns.
7. Route empty-stop and unexpected-stop retries through it. Done in the retry guard handlers.
8. Route yield/checkpoint reminder continuations through it. Done for the rewind-before-yield reminder path.
9. Route auto-learn capture continuations through it. Done for `autolearn.autoContinue`.
10. Add tests for dedupe and max consecutive turns. Done for the scheduler itself, session-stop, todo reminders, TTSR, empty-stop, unexpected-stop, compaction auto-continue, yield rewind reminders, auto-learn capture turns, and IRC idle wake turns.

Current automatic turn coverage:

| Source | Scheduler Status | Source Location |
|---|---|---|
| `session-stop` | routed | `packages/coding-agent/src/session/agent-session.ts` |
| `todo-reminder` | routed | `packages/coding-agent/src/session/agent-session.ts` |
| `ttsr` | routed | deferred `followUp` and interrupt retry in `AgentSession` |
| `empty-stop-retry` | routed | `AgentSession.#handleEmptyAssistantStop` |
| `unexpected-stop-retry` | routed | `AgentSession.#handleUnexpectedAssistantStop` |
| `compaction` | routed | post-compaction auto-continue, context-promotion retry, overflow/incomplete retry, and compaction queued-message drain paths are routed |
| `irc` | routed | idle incoming messages and stranded-aside wake turns are routed; completed contract subagents are transcript-only and non-revivable |
| `yield` | routed | rewind-before-yield reminder and queued-message drain continuations are routed |
| `autolearn` | routed | `AutoLearnController` auto-continue capture path |
| `async-yield` | routed | `YieldQueue.injectIdle` and async delivery idle prompt injection |
| `task-background` | no success auto-turn | task success uses `deliverOnSuccess: false`; task failures flow through `async-yield` delivery |

Phase 2 source decisions are now implemented for the listed sources. Remaining work moves to the contract launch/context profile tasks below.

### Phase 3: Contract Subagent Context Profile

Goal: stop subagents from inheriting expensive main-agent context by default.

Tasks:

1. Add `SubagentLaunchSpec`.
2. Add `ContextPolicy` decisions for main vs contract subagent.
3. Build thin subagent system prompt from static markdown.
4. Pass task contract as the only required context.
5. Explicitly deny memory instructions, auto-learn, eager task/todo, and session-stop continuation for contract subagents.
6. Add tests proving a contract subagent request does not contain parent full system prompt.

Implementation file map:

- Create `packages/coding-agent/src/task/subagent-launch-spec.ts` for the immutable launch object and validation.
- Create `packages/coding-agent/src/task/subagent-contract.ts` for contract text, role, constraints, and expected return shape.
- Create `packages/coding-agent/src/prompts/thin-subagent-system.md` for the static thin subagent system prompt.
- Modify `packages/coding-agent/src/task/index.ts` so task spawning builds a launch spec before calling the executor.
- Modify `packages/coding-agent/src/task/executor.ts` so subprocess launch receives only launch-spec-approved context.
- Modify `packages/coding-agent/src/session/agent-session.ts` only at the construction/context assembly boundary; do not add new local prompt strings.

### Phase 4: Config Cleanup

Goal: make runtime behavior easy to reason about from config.

Tasks:

1. Keep user-facing model profile keys:
   - `claude_high`
   - `claude_low`
   - `codex_high`
   - `codex_low`
   - `xai`
   - `local_llm`
2. For each profile, allow:
   - model ID
   - thinking level
   - optional provider override
3. Add `task.contextProfile` with default `contract`.
4. Add subagent-specific defaults:
   - memory off
   - autolearn off
   - todo reminders off
   - eager task off
   - session-stop continuation off
5. Keep main-agent defaults unchanged unless explicitly configured.

Recommended config shape:

```yaml
subagents:
  profiles:
    claude_high:
      model: claude-opus-4.8
      thinking: high
    claude_low:
      model: claude-sonnet-4.6
      thinking: medium
    codex_high:
      model: codex-5.5
      thinking: high
    codex_low:
      model: 5.3-codex-spark
      thinking: low
    xai:
      model: grok-4.3
      thinking: high
    local_llm:
      model: gemma-12b
      thinking: low
  contextProfile: contract
  memory: off
  autolearn: false
  todoReminders: false
  eagerTaskPrelude: false
  sessionStopContinuation: false
```

The profile keys are user-facing config keys. They should not be hidden behind a second internal naming layer.

### Phase 5: Remove Legacy Direct Paths

Goal: eliminate hidden bypasses.

Tasks:

1. Replace direct `sendCustomMessage(... triggerTurn: true)` paths for internal automation with `TurnScheduler`.
2. Route direct `#scheduleAgentContinue(...)` automation paths through the continuation-turn API.
3. Replace direct hidden message creation with typed context-source helpers.
4. Restrict extension context hooks in subagents unless declared subagent-safe.
5. Add provider-request audit snapshots for regression tests.

Do not route all public or extension `sendCustomMessage` calls yet. External extension behavior is a compatibility surface; first route only internal automation call sites with known source ownership.

## Test Strategy

Contract-level tests should assert provider-visible behavior, not implementation details.

Required tests:

- Provider context conversion:
  - hidden custom content appears.
  - custom details do not appear.
  - excluded bash/python results do not appear.
- System prompt profile:
  - main agent includes configured memory instructions.
  - contract subagent excludes parent full prompt and memory instructions.
- Automatic turn scheduler:
  - session-stop continuation capped.
  - repeated IRC wake for completed contract subagent is denied.
  - auto-learn does not auto-run unless `autolearn.autoContinue` is true.
  - todo reminders respect max count.
- Task launch:
  - `task.eager: always` affects main agent only.
  - contract subagent gets thin prompt plus contract.
  - completed contract subagent persists `revivable: false`.
- Extension hooks:
  - main agent honors `context` and `before_provider_request`.
  - contract subagent blocks context hook unless explicitly allowed.

Use focused package-local verification:

```bash
bun --cwd=packages/coding-agent run check:types
bun test packages/coding-agent/src/session/__tests__/turn-scheduler.test.ts
bun test packages/coding-agent/test/agent-session-concurrent.test.ts
bun test packages/coding-agent/test/tools/irc.test.ts
bun test packages/coding-agent/test/async-yield-queue.test.ts
bun test packages/coding-agent/test/task/task-spawn.test.ts
```

If full package verification fails due unrelated repo state, record the unrelated failure and run targeted tests for changed areas.

## Implementation Backlog

Use this backlog as the development order. Each item should land with its focused tests before moving to the next item.

### Task A: Finish Automatic Turn Admission

Files:

- Modify `packages/coding-agent/src/session/turn-scheduler.ts`.
- Modify `packages/coding-agent/src/session/agent-session.ts`.
- Modify `packages/coding-agent/src/session/yield-queue.ts` only if the scheduler hook cannot be cleanly injected from `AgentSession`.
- Test `packages/coding-agent/src/session/__tests__/turn-scheduler.test.ts`.
- Test `packages/coding-agent/test/async-yield-queue.test.ts`.

Steps:

- [x] Add a continuation-turn request type that does not require appending a new `AgentMessage`.
- [x] Preserve the existing message-turn request behavior for `session-stop`, `todo-reminder`, `ttsr`, `irc`, `autolearn`, and retry guards.
- [x] Route `#scheduleQueuedMessageDrain` through the continuation-turn admission gate.
- [x] Route `YieldQueue.injectIdle` through source `async-yield`.
- [x] Add a test where four idle async completions produce only three automatic idle prompts before a direct user turn.
- [x] Run:

```bash
bun --cwd=packages/coding-agent run check:types
bun test packages/coding-agent/src/session/__tests__/turn-scheduler.test.ts packages/coding-agent/test/async-yield-queue.test.ts
```

Expected result: type check passes; scheduler and async-yield tests pass.

### Task B: Lock Background Task Completion Semantics

Files:

- Modify `packages/coding-agent/test/task/task-spawn.test.ts`.
- Modify `packages/coding-agent/src/task/index.ts` only if the current `deliverOnSuccess: false` contract is accidentally violated.
- Modify `packages/coding-agent/src/async/__tests__/job-manager.test.ts` if lower-level delivery coverage needs a stronger assertion.

Steps:

- [x] Add or strengthen a task-spawn test proving successful background task completion stores `resultText` and does not call the manager completion callback.
- [x] Add a failure-path test proving failed background task output is delivered through async delivery.
- [x] Keep the user-facing spawn text explicit: success is read via `history://...` or job polling; failures surface automatically.
- [x] Run:

```bash
bun --cwd=packages/coding-agent run check:types
bun test packages/coding-agent/test/task/task-spawn.test.ts packages/coding-agent/src/async/__tests__/job-manager.test.ts
```

Expected result: successful background tasks do not wake the parent; failures still surface.

### Task C: Enforce Completed-Subagent IRC Policy

Files:

- Modify `packages/coding-agent/src/tools/irc.ts` or the current IRC tool location if it has moved.
- Modify `packages/coding-agent/src/task/registry.ts` or the current `AgentRegistry` implementation.
- Modify `packages/coding-agent/test/tools/irc.test.ts`.
- Review `packages/coding-agent/test/task/persisted-revive.test.ts` and `packages/coding-agent/test/task/executor-subagent-reminders.test.ts`.

Steps:

- [x] Define one runtime state for completed contract subagents: `revivable: false`.
- [x] Make IRC wake reject completed contract subagents before scheduling a turn.
- [x] Return a transcript-only result that tells the caller to read history or spawn a new task, without injecting model-visible IRC content.
- [x] Add a test where IRC to a completed contract subagent does not call `agent.prompt`.
- [x] Run:

```bash
bun --cwd=packages/coding-agent run check:types
bun test packages/coding-agent/test/tools/irc.test.ts packages/coding-agent/test/task/persisted-revive.test.ts packages/coding-agent/test/task/executor-subagent-reminders.test.ts
```

Expected result: live subagents can receive IRC; completed contract subagents cannot be revived.

### Task D: Introduce Subagent Launch Spec

Files:

- Create `packages/coding-agent/src/task/subagent-launch-spec.ts`.
- Create `packages/coding-agent/src/task/subagent-contract.ts` if contract rendering grows beyond the launch-spec builder.
- Modify `packages/coding-agent/src/task/index.ts`.
- Modify `packages/coding-agent/src/task/executor.ts`.
- Test `packages/coding-agent/test/task/task-spawn.test.ts`.
- Add a focused launch-spec test under `packages/coding-agent/test/task/`.

Steps:

- [x] Define `SubagentLaunchSpec` with model profile, thinking level, contract, context profile, tool allow/deny lists, IRC revivability, memory mode, and extension context-hook policy.
- [x] Build the launch spec before any subprocess/session creation.
- [x] Pass the launch spec into the executor and use it as the revivability source for terminal contract subagents.
- [x] Pass only launch-spec-approved provider-context fields into the executor.
- [x] Add tests proving profile keys `claude_high`, `claude_low`, `codex_high`, `codex_low`, `xai`, and `local_llm` are the supported user-facing profile keys.
- [x] Add a task-spawn test proving a config-selected model profile is present on the executor launch spec.
- [x] Run:

```bash
bun --cwd=packages/coding-agent run check:types
bun test packages/coding-agent/test/task/subagent-launch-spec.test.ts packages/coding-agent/test/task/task-spawn.test.ts
```

Expected result: subagent launch is controlled by one immutable object.

### Task E: Add Contract Context Profile

Files:

- Create `packages/coding-agent/src/context/context-policy.ts`.
- Create or expand `packages/coding-agent/src/context/context-audit.ts`.
- Use the existing thin prompt at `packages/coding-agent/src/prompts/system/subagent-system-prompt.md`.
- Modify the session construction/context assembly boundary in `packages/coding-agent/src/session/agent-session.ts`.
- Test provider-visible request dumps or context conversion tests under `packages/coding-agent/test/`.

Steps:

- [x] Add policy decisions for main agent vs contract subagent.
- [x] Deny parent full system prompt, memory instructions, auto-learn, eager task/todo preludes, and extension context hooks for contract subagents by default.
- [x] Allow only thin subagent prompt, task contract, selected tools, and live IRC content.
- [x] Emit audit entries for both allowed and denied sources.
- [x] Add tests proving a contract subagent session uses only the thin prompt, strips parent context payloads, disables memory/autolearn/eager prompts, and disables extension context hooks by default.
- [x] Run:

```bash
bun --cwd=packages/coding-agent run check:types
bun test packages/coding-agent/test/task/subagent-launch-spec.test.ts packages/coding-agent/test/task/task-spawn.test.ts packages/coding-agent/src/context/__tests__/context-policy.test.ts packages/coding-agent/test/task/executor-pass-through.test.ts packages/coding-agent/test/task/executor-subagent-reminders.test.ts
```

Expected result: contract subagents receive the thin prompt plus contract, not the main-agent prompt stack.

## Recommended Immediate Config During Refactor

For local development while this architecture is being implemented:

```yaml
task.eager: preferred
autolearn.enabled: false
compaction.idleEnabled: false
task.maxConcurrency: 1
task.maxRecursionDepth: 1
```

Rationale:

- `task.eager: always` is the biggest current pressure toward subagent creation.
- `autolearn.enabled: true` adds hidden context after substantive turns.
- Lower recursion keeps subagent behavior inspectable while policies are being rebuilt.

This is not the final product default. It is a development safety profile.

## Acceptance Criteria

The cleanup is complete when:

1. A developer can inspect one audit object and know why every provider-visible context item was included.
2. Contract subagents never receive the full parent system prompt by default.
3. All automatic turns pass through one scheduler with source budgets.
4. Completed contract subagents cannot be revived by IRC.
5. Config clearly separates model selection from context policy.
6. Tests prove provider-visible context, not just UI/session metadata.
7. The task tool can still use IRC for live coordination while preventing completed-subagent loops.

## Non-Goals

- Do not remove IRC.
- Do not remove extensions.
- Do not remove memory for main agents.
- Do not change provider APIs.
- Do not rewrite the entire `AgentSession` in one step.
- Do not make internal model profile names user-facing aliases beyond the requested config keys.

## Open Decisions

These should be decided before implementation:

1. Whether extension context hooks are globally disabled in contract subagents or allowed through an explicit manifest flag.
2. Whether `rocky` memory tools should be exposed to contract subagents as tools-only while keeping memory system instructions disabled.
3. Whether task contracts should be developer messages or user messages. Developer messages give stronger instruction priority, but user messages better preserve the contract relationship model.
4. Whether provider audit snapshots should be log-only or persisted into session debug entries.
