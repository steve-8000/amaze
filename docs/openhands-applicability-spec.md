# OpenHands control-plane patterns for Amaze AGI Runtime

## Scope and source baseline

This document records what Amaze should and should not take from `https://github.com/OpenHands/OpenHands` when Amaze is treated as an **AGI Runtime**, not as a chat-agent product being wrapped in a web service.

Source inspected locally:

- Clone path: `tmp/OpenHands`
- Remote: `https://github.com/OpenHands/OpenHands.git`
- Revision: `2d34bb7`
- License note: OpenHands root says core repo and images are MIT licensed except `enterprise/`, which is source-available under its own license. Do not copy from `enterprise/` into Amaze without a separate license review.

Amaze context inspected:

- `packages/coding-agent/docs/mission-control-rag/10-agency-kernel-architecture.md`
- `packages/coding-agent/src/autonomy/store.ts`
- `packages/coding-agent/src/autonomy/types.ts`
- `packages/coding-agent/src/autonomy/objective-runtime.ts`
- `packages/coding-agent/src/autonomy/scheduler.ts`
- `packages/coding-agent/src/mission/core/mission-runtime.ts`
- `packages/coding-agent/src/mission/store.ts`
- `packages/coding-agent/src/cognition/index.ts`
- `packages/coding-agent/src/task/index.ts`
- `packages/coding-agent/src/gateway/runner.ts`
- `.amaze/config.yml`

## Executive conclusion

Do **not** port OpenHands into Amaze as an app-server/conversation product.

OpenHands is useful to Amaze mainly as a reference for **control-plane patterns**:

1. durable startup tasks with visible phases;
2. append/search event APIs;
3. sandbox identity via per-sandbox API keys;
4. webhook/event ingress from isolated workers;
5. pending-message queues during async startup;
6. skill source precedence and compatibility aliases;
7. optional browser/API projections once the runtime is already authoritative.

Those are support systems. They must feed Amaze's AGI Runtime; they must not replace it.

Amaze's real P0 work remains:

1. Objective Runtime;
2. durable Objective -> Mission binding;
3. Observe / Plan / Act / Verify / Learn loop;
4. automatic research when freshness or unknowns require it;
5. multi-agent scheduler with explicit role authority;
6. runtime event ledger as replay/audit history;
7. verifier-authoritative completion.

## Correct framing

OpenHands is an **Agent Product**:

```text
Conversation
  -> Message
  -> Agent response
  -> UI/session state
```

Amaze is aiming at an **AGI Runtime**:

```text
Objective
  -> Mission
  -> Plan DAG
  -> Action
  -> Evidence
  -> Verification
  -> Replan / Learn / Continue
```

That difference changes the adoption strategy.

Amaze should not ask, "How do we attach OpenHands to Amaze?"

Amaze should ask, "Which OpenHands control-plane patterns help the Objective Runtime run durably, observably, and safely across restarts, sandboxes, and operators?"

## OpenHands product shape

OpenHands currently positions itself as several related products:

1. **Software Agent SDK**: composable Python library providing the agent engine.
2. **CLI**: terminal coding-agent UX similar to Claude Code/Codex.
3. **Local GUI**: FastAPI app server plus React single-page app, with REST APIs and sandbox-backed conversations.
4. **Cloud**: hosted GUI with integrations and collaboration.
5. **Enterprise**: self-hosted cloud, source-available under a separate enterprise license.

The cloned repository mainly contains the local GUI/app-server layer and integration glue around published packages:

- `openhands-sdk==1.28.0`
- `openhands-agent-server==1.28.0`
- `openhands-tools==1.28.0`

The local GUI app server delegates actual agent execution to an **agent-server running inside a sandbox**. The app server owns conversation metadata, settings, secrets, sandbox lifecycle, event persistence, and frontend APIs.

## OpenHands architecture summary

### Runtime topology

OpenHands separates the system into three runtime planes:

```text
React frontend
  -> FastAPI app server (`openhands/app_server`)
     -> sandbox service starts/resumes/stops containers
        -> per-sandbox agent-server process
           -> SDK agent, workspace, tools, events
```

The app server is not the agent loop. It is the control plane around sandboxed agent servers.

Relevant files:

- `openhands/app_server/app.py`: FastAPI app, `/api/v1` routers, `/mcp` mount, static frontend mount, CORS/cache/rate-limit middleware.
- `openhands/app_server/v1_router.py`: central API router composition.
- `openhands/app_server/app_conversation/live_status_app_conversation_service.py`: conversation creation, sandbox selection, setup, agent-server start request, metadata persistence.
- `openhands/app_server/sandbox/docker_sandbox_service.py`: Docker-backed sandbox lifecycle and port exposure.
- `openhands/app_server/event/event_router.py`: event search/count/batch routes.
- `openhands/app_server/event_callback/webhook_router.py`: sandbox-to-app-server webhooks for conversation and event updates.
- `frontend/src/api/README.md`: typed frontend API service/query-hook convention.

### Conversation startup flow

The important OpenHands V1 conversation path:

1. Frontend calls `POST /api/v1/app-conversations`.
2. `start_app_conversation` returns the first `AppConversationStartTask` immediately and consumes the rest in a background task.
3. `LiveStatusAppConversationService._start_app_conversation`:
   - resolves the user id and optional parent conversation inheritance;
   - creates a durable start task;
   - finds or starts a sandbox according to `SandboxGroupingStrategy`;
   - waits for sandbox readiness;
   - resolves an agent-server URL from sandbox exposed ports;
   - seeds LLM profiles into the sandbox;
   - resolves working directory, optionally grouping by conversation id;
   - runs repository setup: clone/init Git, `.openhands/setup.sh`, `.openhands/pre-commit.sh`, skill setup;
   - builds `StartConversationRequest` with agent, LLM, workspace, tools, secrets, hooks, and plugins;
   - posts to `{agent_server_url}/api/conversations`;
   - persists `AppConversationInfo` with sandbox id, repository, branch, model, trigger, parent id, tags;
   - installs default event callbacks such as auto-title;
   - marks the startup task `READY` or records redacted error detail.
4. Follow-up messages go through `POST /api/v1/app-conversations/{id}/send-message`, which is intentionally a thin proxy to the agent-server.

Amaze should reuse the **startup task pattern**, not the conversation model.

### Sandbox model

OpenHands Docker sandbox behavior:

- Container name prefix default: `oh-agent-server-`.
- Each sandbox gets a random `SESSION_API_KEY` stored in container env.
- Exposed ports default to:
  - `AGENT_SERVER` on container port `8000`
  - `VSCODE` on `8001`
  - `WORKER_1` on `8011`
  - `WORKER_2` on `8012`
- Bridge networking maps container ports to random free host ports unless host networking is enabled.
- Health checks call `/health` on the agent-server URL.
- App-server webhook URL is injected as `OH_WEBHOOKS_0_BASE_URL` using `host.docker.internal:{host_port}/api/v1/webhooks`.
- Containers are paused/resumed/deleted rather than being purely ephemeral.
- `max_num_sandboxes` is enforced by pausing old sandboxes.

This is relevant to Amaze only after the AGI Runtime has an authoritative Objective/Mission/Event model. The sandbox is an execution isolation boundary, not the runtime authority.

### Event and webhook model

OpenHands has two event paths:

1. **Query path**: `GET /api/v1/conversation/{conversation_id}/events/search`, `/count`, and batch `GET` retrieve persisted events with filters and pagination.
2. **Ingress path**: sandbox agent-server posts webhooks back to the app server:
   - `POST /api/v1/webhooks/conversations`: create/update conversation metadata, tags, metrics, agent kind, model.
   - `POST /api/v1/webhooks/events/{conversation_id}`: persist event batches, update stats, reflect agent-initiated LLM switches, detect terminal states, execute callbacks in background.

Webhook authentication uses the per-sandbox `X-Session-API-Key`, and `valid_sandbox` resolves sandbox identity from that key. This is a strong pattern: event ingestion is scoped to the sandbox identity instead of trusting arbitrary conversation ids.

Amaze should adapt this as:

```text
sandbox/session worker
  -> authenticated webhook ingress
     -> RuntimeEventLedger
        -> MissionStore projections
           -> operator/API/browser views
```

The webhook must never become the completion authority. Completion remains verifier-authoritative.

### Skills / microagents

OpenHands skills are markdown prompts with optional YAML frontmatter. Sources include:

1. Public/shareable skills in `OpenHands/skills/`.
2. Repository-specific instructions in `.openhands/skills/` or legacy `.openhands/microagents/`.
3. User/org/project/sandbox skills merged via agent-server APIs in V1.

Amaze already has `.amaze/skills/` and project/user skill loading. The useful OpenHands parts are not the existence of skills, but:

- explicit source precedence and merge behavior;
- backward-compatible aliases (`skills` vs `microagents`);
- clear distinction between keyword-triggered reusable expertise and always-active repository instructions;
- one canonical loader rather than duplicate parsing in the control plane.

### Frontend architecture

OpenHands frontend is a React app with:

- route-level components under `frontend/src/routes/`;
- typed API services under `frontend/src/api/`;
- TanStack Query hooks wrapping service calls;
- stores for conversation, events, command/terminal, and agent state;
- startup task polling, archived conversation mode, websocket provider, and tabbed surfaces.

This is useful later if Amaze builds a browser Mission Control. It is not P0 for the AGI Runtime.

## Amaze AGI Runtime target

`packages/coding-agent/docs/mission-control-rag/10-agency-kernel-architecture.md` defines the target:

```text
User Goal
  -> Objective Contract
  -> Mission
  -> Plan DAG
  -> Tool Actions
  -> Evidence
  -> Verification
  -> Replan / Learn / Continue
  -> Completion
```

The runtime is not a prompt, a self-report marker, or a detached supervisor. It is a closed loop with durable identity, policy-gated actions, evidence capture, verifier authority, and learning from terminal mission outcomes.

Target modules:

| Module | Target responsibility |
| --- | --- |
| `ObjectiveScheduler` | Select active objectives and continuation candidates. |
| `MissionBinder` | Ensure every autonomous unit of work has mission identity and objective contract binding. |
| `ActionPlanner` | Produce/revise the Plan DAG from objective, constraints, world model, and prior plan. |
| `RuntimePolicyEngine` | Enforce role, proposal, continuation, budget, scope, and tool-permission gates. |
| `ActionExecutor` | Dispatch tool actions and subagent tasks through gateway seams. |
| `EvidenceCollector` | Record observations, tool outcomes, task results, world-model claims, verifier evidence refs, and event-log entries. |
| `CompletionVerifier` | Decide pass/fail/pending against criteria and lifecycle gates. |
| `Replanner` | Continue/replan/block/learn/complete from verifier result and new evidence. |

Current Amaze already has important seams:

- `ObjectiveStore` persists objectives, statuses, progress, parent objectives, and objective events.
- `ObjectiveContract` types define criteria, evidence requirements, scope guards, budget guards, freshness policy, and role policy.
- `objective-runtime.ts` explicitly states that a Mission finishing does **not** end an Objective.
- `reevaluateObjective`, `generateNextMissions`, and `settleObjective` implement repeated mission generation and objective progress evaluation.
- `ObjectiveScheduler` can re-evaluate terminal missions, persist progress/status, and generate follow-up missions through runtime hooks.
- `MissionStore` persists mission plans, tasks, acceptance criteria, world-model claims, budgets, scope guards, proposals, and terminal outcomes.
- The architecture doc says MissionStore must be the durable agency source of truth; gateway stores are projections.

Therefore, the correct roadmap is not "wrap the CLI in an HTTP app." The correct roadmap is "make the Objective Runtime authoritative, then expose it."

## Corrected priority order

### P0. Objective Runtime authority

**Problem**

A one-shot Mission can end without the durable Objective being genuinely complete.

```text
Objective: Make Amaze an AGI Runtime
  -> Mission #31
  -> Mission ends
  -> Objective still has remaining work
```

If the Objective is not authoritative, each day becomes a disconnected mission.

**Required shape**

```text
Objective
  state
  progress
  nextAction
  blockedReason
  acceptanceCriteria
  evidenceRefs
  freshnessPolicy
  rolePolicy
  missionBindings[]
```

**Implementation direction**

- Promote `ObjectiveContract` from type-level target to durable runtime input.
- Add/verify explicit Objective -> active Mission binding instead of relying only on `projectId` or inferred session association.
- Persist objective progress after every mission terminal transition.
- Keep terminal Objective statuses separate from terminal Mission states.
- Make `needs_replan` runnable; keep `paused`/`blocked` non-runnable until external unblock.

**OpenHands relevance**

Low. OpenHands startup tasks can inspire visible state transitions, but OpenHands' `AppConversation` model should not be imported.

### P0. Observe / Plan / Act / Verify / Learn loop

**Problem**

AGI behavior requires a durable closed loop, not a single planning pass.

**Required loop**

```text
Observe durable state
  -> Plan or revise Plan DAG
  -> Select executable action(s)
  -> Execute through policy gates
  -> Collect evidence
  -> Verify criteria
  -> Replan / Learn / Continue / Complete
```

**Implementation direction**

- Drive ticks from Objective/Mission/Event state, not transient process memory.
- Use `MissionStore` as the source of truth for plan, task, evidence, criteria, verifier output, and terminal outcomes.
- Treat gateway/session data as execution projection only.
- Make every tick idempotent after crash/restart.

**OpenHands relevance**

Medium for event persistence and query APIs. Low for agent loop design.

### P0. Runtime event ledger

**Problem**

Operators and future runtime ticks must know why a decision happened.

**Required event kinds**

```text
objective.created
objective.status_changed
mission.bound
plan.created
plan.revised
action.queued
action.started
action.completed
research.requested
research.evidence_added
policy.allowed
policy.denied
verification.started
verification.passed
verification.failed
replan.requested
learning.recorded
```

Events must include:

- stable event id;
- mission id;
- optional objective id;
- optional session/sandbox id;
- actor/role;
- occurredAt;
- payload;
- evidence refs;
- idempotency key where needed.

**OpenHands relevance**

High. OpenHands has useful event search, count, pagination, and webhook ingestion patterns. Amaze should adapt these to MissionStore/runtime events, not conversation events.

### P0. Automatic Research Agent

**Problem**

Research cannot be optional for an AGI Runtime. When the runtime detects unknowns, stale facts, external APIs, current docs, versions, release notes, issues, or ambiguous claims, it should route to research automatically.

**Required behavior**

```text
Unknown or stale claim detected
  -> Research action queued
  -> Researcher gathers sources
  -> Evidence refs persisted
  -> Planner/Replanner continues with cited evidence
```

**Implementation direction**

- Use `ObjectiveFreshnessPolicy.researchRequired` and `maxSourceAgeDays` as runtime inputs.
- Add research-needed events and evidence refs.
- Make planner/replanner refuse to proceed on freshness-sensitive unknowns without research evidence.
- Store source URLs/check dates for load-bearing external findings.

**OpenHands relevance**

Low. OpenHands has optional integrations; Amaze needs a runtime research policy.

### P1. Multi-agent scheduler

**Problem**

A planner doing most work alone is not an AGI runtime. The runtime must schedule role-specific work with bounded authority.

**Required roles**

```text
Planner
Researcher
Builder
Reviewer
Verifier
SRE
Security
MemoryCurator
```

**Implementation direction**

- Use `ObjectiveContract.rolePolicy` and `.amaze/config.yml` role-to-model routing.
- Derive action role from plan step kind and risk.
- Enforce capabilities: read/write/commands/infrastructure/completion approval.
- Schedule independent actions in parallel only when dependencies and scope allow.
- Keep verifier authority separate from builder self-report.

**OpenHands relevance**

Low to medium. OpenHands shows product-level agent/server separation, but Amaze already has subagent tooling and should build on that.

### P1. Durable Objective -> Mission history

**Problem**

A durable objective may require many missions over days. Those missions must be linked and interpretable.

**Required shape**

```text
Objective
  ├─ Mission #31
  ├─ Mission #32
  └─ Mission #33
```

Each Mission must record:

- why it was created;
- which objective criteria it targets;
- which evidence it produced;
- terminal verdict;
- what the next objective action is.

**Implementation direction**

- Add or formalize a mission binding table/read model if `projectId` is insufficient.
- Persist generation reason from `ObjectiveSettlement.reason`.
- Store addressed objective criteria/metrics and evidence refs.
- Let objective progress be reconstructed from mission outcomes and events.

**OpenHands relevance**

Medium. Startup task state and conversation inheritance are useful analogies, but the entity must be Objective/Mission, not Conversation/Message.

### P2. Sandbox Runtime

**Problem**

Remote/browser/untrusted execution needs isolation and identity.

**OpenHands pattern to adapt**

- Per-sandbox `SESSION_API_KEY`.
- Exposed URL records by logical name.
- Health-check transition from starting to running/error.
- Pause/resume/delete lifecycle.
- Max sandbox count with old-sandbox pausing.
- Webhook callback URL injected into sandbox env.

**Amaze mapping**

```text
Amaze control/runtime host
  -> SandboxService.startSandbox(objectiveId, missionId)
     -> container running Amaze worker/session endpoint
        -> authenticated event webhook ingress
        -> MissionStore/runtime event ledger
```

**Non-goals**

- Do not make sandboxing mandatory for local CLI.
- Do not run arbitrary setup scripts implicitly in local mode.
- Do not let sandbox event callbacks become completion authority.

### P2. Startup task / visible state machine

**Problem**

Users and operators need to know whether the runtime is planning, blocked, researching, verifying, or waiting for approval.

**OpenHands pattern to adapt**

OpenHands exposes startup states such as created, sandbox starting, workspace preparing, agent starting, ready, and error.

**Amaze runtime states should be objective/mission/action oriented**

```text
OBJECTIVE_CREATED
MISSION_BINDING
PLANNING
RESEARCH_REQUIRED
RESEARCH_RUNNING
PLAN_READY
ACTION_QUEUED
SUBAGENT_RUNNING
WAITING_APPROVAL
WAITING_EXTERNAL_INPUT
VERIFYING
REPLANNING
LEARNING
COMPLETED
FAILED
BLOCKED
PAUSED
```

These should be projections over runtime events, not a separate truth.

### P2. Webhook/event ingress

**Problem**

If workers run in sandboxes or remote contexts, the runtime host needs authenticated event ingestion.

**OpenHands pattern to adapt**

- `X-Session-API-Key` authenticates sandbox-originating events.
- Server resolves sandbox identity from the key.
- Event batches are persisted before callbacks/side effects.
- Terminal state detection uses structured events.

**Amaze mapping**

```http
POST /api/v1/runtime/events/{mission_id}
X-Amaze-Session-Key: ...
```

The server should validate:

- session/sandbox key;
- mission binding;
- objective binding if provided;
- event idempotency key;
- actor/role authorization.

### P3. HTTP API and browser Mission Control

A browser/API layer is useful only after the runtime state model is correct.

Correct API scope:

```http
GET  /api/v1/objectives
POST /api/v1/objectives
GET  /api/v1/objectives/{objective_id}
GET  /api/v1/objectives/{objective_id}/missions
GET  /api/v1/missions/{mission_id}
GET  /api/v1/missions/{mission_id}/events/search
GET  /api/v1/runtime/start-tasks/{task_id}
POST /api/v1/missions/{mission_id}/actions/approve
POST /api/v1/missions/{mission_id}/actions/reject
POST /api/v1/runtime/events/{mission_id}
```

Browser UI should show:

- objective list and objective progress;
- mission tree per objective;
- plan DAG;
- action queue and role ownership;
- evidence cards;
- research citations;
- verifier decisions;
- policy gates;
- event timeline;
- blocked/paused reasons;
- approval controls.

It should not be a conversation-first chat UI.

## OpenHands adoption matrix

| OpenHands idea | Adopt? | Priority | Amaze mapping | Notes |
| --- | --- | --- | --- | --- |
| Startup task | Yes | P2 | Runtime state projection over Objective/Mission events | Good pattern, but states must be AGI-runtime states. |
| Event search/count/pagination | Yes | P0/P1 | Runtime event ledger query API | Feed MissionStore projections. |
| Sandbox `SESSION_API_KEY` | Yes | P2 | `AmazeSessionKey` for sandbox/worker event ingress | Strong identity boundary. |
| Webhook ingress | Yes | P2 | Authenticated runtime event ingestion | Never completion authority. |
| Pending messages | Partial | P2/P3 | Queue operator input while objective/mission worker starts | Useful for gateways/browser. |
| Skill precedence | Yes | P2 | Canonical Amaze loader plus compatibility aliases | Avoid duplicate skill systems. |
| Browser service/query hooks | Later | P3 | Browser Mission Control over runtime DTOs | Useful after API contract. |
| Conversation model | No | None | Do not import | Objective/Mission is the core. |
| Agent-server split | No by default | None | Existing runtime/subagents remain core | Consider only for sandbox worker endpoint. |
| Python FastAPI app server | No | None | Do not port directly | TypeScript/Bun-first unless Rocky has bounded need. |
| Enterprise code | No | None | License review required | Do not copy. |
| Repo setup hooks | Partial | P2 | `.amaze/setup.sh` only in explicit sandbox/remote mode | Disabled by default for untrusted repos. |
| Provider integrations | Selective | P3 | Interface lessons only | Do not import broad layer. |

## What not to bring over

### Conversation-centered model

Do not map Amaze's core runtime to:

```text
AppConversation
  -> messages
  -> assistant response
```

Amaze's authority should be:

```text
ObjectiveContract
  -> MissionStore mission
  -> Plan DAG
  -> actions/evidence/verifier events
```

Conversation/messages may exist as an operator interface, but they are not the runtime source of truth.

### Chat UI as the primary product surface

A browser Mission Control may be useful later. It should not drive the architecture now.

If built, it should be mission/objective/evidence oriented rather than chat oriented.

### Separate Agent Server as default architecture

OpenHands uses:

```text
App Server
  -> Agent Server
```

Amaze already has:

```text
MissionControl
  -> Runtime
  -> SubAgents / tools / gateway seams
```

Adding another agent-server boundary would duplicate lifecycle, policy, and event authority unless it is specifically a sandbox worker endpoint.

### Python app server port

Amaze is TypeScript/Bun-first. A Python FastAPI sidecar would duplicate config, auth, models, session state, and lifecycle unless there is a sharply bounded Rocky-specific reason.

### Assistant self-report completion

OpenHands event plumbing is useful, but Amaze must keep verifier-authoritative completion. A message saying "done" is evidence at most; it is not terminal authority.

## Revised roadmap

### Phase 1: Objective Runtime authority

Deliverables:

- Durable `ObjectiveContract` persistence or explicit binding from existing `Objective` to contract fields.
- Objective -> active Mission binding through MissionStore.
- Objective progress reconstructed from mission outcomes and evidence refs.
- `needs_replan` path that generates new missions without ending the objective.
- Terminal Objective status only after verifier-backed objective completion.

Acceptance:

- A completed Mission with unmet Objective criteria causes a follow-up Mission or `needs_replan`, not silent objective completion.
- Restarting the process preserves objective progress and next action.

### Phase 2: Runtime event ledger

Deliverables:

- Append-only runtime event schema with objective/mission/session ids, type, actor, payload, evidence refs, and idempotency key.
- Event writes for scheduling, binding, planning, action dispatch, tool result, research, policy, verification, replan, learning, and terminal transitions.
- Projection that renders objective state, mission state, action state, and visible startup/runtime status.

Acceptance:

- An operator can answer "why did the runtime do this?" from events and evidence refs.
- Projections can be rebuilt from MissionStore plus runtime events.

### Phase 3: Research and evidence loop

Deliverables:

- Freshness policy enforcement from `ObjectiveContract.freshnessPolicy`.
- Research action scheduling for unknown/stale external facts.
- Research evidence refs persisted into MissionStore/runtime events.
- Planner/replanner resumes after research evidence is available.

Acceptance:

- A freshness-sensitive objective cannot proceed on stale or missing external facts without a research event and cited evidence.

### Phase 4: Multi-agent scheduler

Deliverables:

- Role-aware action scheduler using `RolePolicy` and `.amaze/config.yml` model role routing.
- Parallel dispatch for independent research/build/review/verify actions.
- Capability gates for repository writes, commands, infrastructure, and completion approval.
- Verifier role remains separate from builder self-report.

Acceptance:

- A plan with independent research/build/review tasks schedules them by dependency and role, with policy events for each action.

### Phase 5: OpenHands-derived sandbox/control plane

Deliverables:

- `SandboxService` interface with Docker implementation.
- Per-sandbox session key and logical exposed URLs.
- Health-check lifecycle and pause/resume/delete operations.
- Authenticated webhook ingress that appends runtime events.
- Pending operator messages while worker startup is incomplete.

Acceptance:

- A mission can run in a sandboxed Amaze worker while the host remains the Objective/Mission/Event authority.

### Phase 6: HTTP/browser projection

Deliverables:

- Objective/Mission/Event HTTP DTOs.
- Event search/count/pagination endpoints.
- Browser Mission Control showing objective progress, mission tree, plan DAG, evidence, verifier, policy gates, and action approvals.
- Query-hook discipline if a React frontend is used.

Acceptance:

- Browser/API clients can observe and steer the AGI Runtime without reading internal tables and without becoming runtime authority.

## Minimal runtime DTO sketch

```ts
export type ObjectiveRuntimeStatus =
  | "OBJECTIVE_CREATED"
  | "MISSION_BINDING"
  | "PLANNING"
  | "RESEARCH_REQUIRED"
  | "RESEARCH_RUNNING"
  | "PLAN_READY"
  | "ACTION_QUEUED"
  | "SUBAGENT_RUNNING"
  | "WAITING_APPROVAL"
  | "WAITING_EXTERNAL_INPUT"
  | "VERIFYING"
  | "REPLANNING"
  | "LEARNING"
  | "COMPLETED"
  | "FAILED"
  | "BLOCKED"
  | "PAUSED";

export interface RuntimeEventDto {
  eventId: string;
  objectiveId?: string;
  missionId: string;
  sessionId?: string;
  sandboxId?: string;
  type: string;
  actor: {
    kind: "runtime" | "role" | "user" | "sandbox" | "tool";
    role?: string;
  };
  occurredAt: string;
  payload: Record<string, unknown>;
  evidenceRefs: string[];
  idempotencyKey?: string;
}

export interface ObjectiveProjectionDto {
  objectiveId: string;
  status: ObjectiveRuntimeStatus;
  progressScore: number;
  activeMissionId?: string;
  missionIds: string[];
  nextAction?: string;
  blockedReason?: string;
  evidenceRefs: string[];
  updatedAt: string;
}
```

## Implementation risks

| Risk | Mitigation |
| --- | --- |
| Web-service-ifying before the runtime is authoritative | Make Objective/Mission/Event authority P0; HTTP/browser are projections only. |
| Importing OpenHands conversation assumptions | Use Objective/Mission language in all DTOs and stores. |
| Duplicate state in gateway/app/sandbox stores | MissionStore and runtime event ledger are source of truth; gateway/app stores are projections. |
| Sandbox events spoofing mission state | Per-sandbox key, mission binding validation, idempotency keys, actor/role checks. |
| Completion based on assistant text | CompletionVerifier writes terminal authority events. |
| Research remaining optional | Enforce freshness policy as a planner/replanner gate. |
| Multi-agent parallelism causing unsafe writes | Role policy, dependency graph, scope guards, and mutation approval gates. |
| Skill precedence confusion | One canonical Amaze loader; compatibility paths feed it. |
| Python/TypeScript split-brain | Keep runtime/control plane in TypeScript unless a bounded Rocky service is explicitly chosen. |
| Enterprise license contamination | Do not copy from `enterprise/` without separate review. |

## Bottom line

The old framing, "OpenHands applicability for Amaze," was too broad and too product-oriented.

The corrected framing is:

> OpenHands is a reference for control-plane mechanics around an agent runtime. Amaze should borrow those mechanics only where they strengthen an Objective/Mission-centered AGI Runtime.

OpenHands ideas worth taking now:

1. event query/ingress patterns for a runtime event ledger;
2. visible startup/runtime task states;
3. sandbox identity with per-sandbox API keys;
4. webhook ingestion from isolated workers;
5. pending input during async startup;
6. skill source precedence and compatibility aliases.

OpenHands ideas to keep out of Amaze's core:

1. conversation as the primary runtime entity;
2. chat UI as the architectural center;
3. separate agent-server topology as the default;
4. Python FastAPI app-server port;
5. assistant self-report as completion authority.

Amaze should first complete the AGI Runtime: Objective Contract, Objective -> Mission binding, Plan DAG, actions, evidence, verification, replan, learning, research, role scheduling, and event sourcing. After that, OpenHands-style sandbox/API/browser patterns become useful projections and execution envelopes.
