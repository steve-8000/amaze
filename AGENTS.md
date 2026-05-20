# Amaze Agent Guide

Use this repository as the source-controlled runtime profile for the global `amaze` command.

## Profile files

Keep these in git:

- `.amaze/settings.json`
- `.amaze/skills/`
- `AGENTS.md`
- `README.md`

Do not commit local runtime state, credentials, sessions, caches, logs, or build outputs.

## Models

Default:

- `openai-codex/gpt-5.5`

Subagents:

- `explore`: `openai-codex/gpt-5.5`
- `plan`: `anthropic/claude-opus-4-7`
- `reviewer`: `anthropic/claude-opus-4-7`
- `oracle`: `openai-codex/gpt-5.5`
- `researcher`: `xai/grok-4.3`
- `visual_qa`: `openai-codex/gpt-5.5`
- `task`: `openai-codex/gpt-5.5`
- `quick_task`: `openai-codex/gpt-5.5`

## Subagents

Active roster:

- `quick_task`
- `task`
- `explore`
- `plan`
- `reviewer`
- `oracle`
- `researcher`
- `visual_qa`

Do not reintroduce:

- `designer`
- `librarian`
- `designer` model role

Use subagents only when they add value. Small, clear work should stay in the main agent.

## Prompt cache and memory policy

Session role:

- Top-level orchestrator: no `taskDepth`, no `parentTaskPrefix`
- Subagent: `taskDepth > 0` or `parentTaskPrefix` is present

Orchestrator:

- Uses compact main context.
- Keeps only nearest context in the system prompt.
- Excludes large static context such as workspace tree and skill listing.
- Keeps long-lived goal/todo/integration state.
- Uses provider/global prompt-cache retention default, currently long in the AI layer.
- Has `task.eager = true` so non-trivial execution should be delegated.

Subagents:

- Use full project context.
- Receive root/nearest context, workspace tree, and skill listing.
- Have `task.eager = false` to prevent recursive delegation drift.
- Use short prompt-cache retention to avoid long-cache write premium for short one-shot workers.
- Return concise yielded results for parent integration.

Operational rule: parent orchestrates and verifies; subagents execute bounded high-context work.

## User-facing output

Do not show raw deliberation, exploratory self-talk, or long reasoning traces.

Show only:

- conclusion
- key evidence
- risk or tradeoff
- next action or result

Project setting `hideThinkingBlock = true` suppresses provider reasoning summaries where supported. Keep it enabled.



## Skills

Project skills are vendored under `.amaze/skills/`.

Keep them practical, short, and source-controlled.

## Secrets

Never commit secrets.

Do not store raw API keys, OAuth tokens, private keys, or personal data in docs, settings, prompts, skills, or logs.

Use provider login flows or local credential storage.

## Local OpenAI-compatible servers

Do not export fake OpenAI credentials globally.

For a local server, prefix the command explicitly:

```sh
OPENAI_BASE_URL="$LOCAL_OPENAI_BASE_URL" OPENAI_API_KEY="$LOCAL_OPENAI_API_KEY" <command>
```

## Verify

Before sharing or publishing changes:

```sh
bun check
```
