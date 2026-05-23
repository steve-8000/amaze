# Phase7 — Memory Exchange Event Spec

status: spec-only (no implementation in this commit)

## Overview

Defines a portable, signed, append-only event shape that lets multiple Amaze agents, running in different processes, hosts, or identities, exchange memory mutations without sharing a SQLite file.

The protocol is substrate-independent. It works whether the receiving deployment materializes memory into `bun:sqlite`, libSQL with a remote primary, a CRDT log, or a future append-only ledger. Storage is downstream of this document; the event shape is the protocol-layer answer to agent collective intelligence.

The design intentionally keeps the event authoritative only as an assertion by one agent. A receiver may reject, quarantine, down-rank, or later supersede the assertion. The sender signs what it saw and what it recommends; it does not get to overwrite another agent's state by construction.

## Non-goals

- No wire transport defined. HTTP, WebSocket, IPFS, ActivityPub, local files, and message queues are all out of scope. The event SHOULD be transport-agnostic.
- No conflict-resolution algorithm prescribed. This spec defines the signals: contradiction, retraction, supersession, and usage. Resolution policy is a per-deployment choice.
- No identity or PKI bootstrap. The spec assumes each agent has a stable keypair. Key distribution, trust roots, rotation ceremony, revocation lists, and hardware-backed custody are out of scope.
- No shared SQLite file, locking protocol, or database replication requirement.
- No global memory ranking formula. Reputation, recency, scope affinity, confidence, and usage weighting are receiver-local policies.
- No backward-compatibility guarantees before 1.0.

## Event taxonomy

| kind | semantics | required payload fields |
| --- | --- | --- |
| `memory.added` | New memory item observed by emitting agent | `scope`, `target`, `category`, `memory_type`, `content`, `confidence` |
| `memory.retracted` | Emitter no longer endorses a previously emitted item | `refers_to`, `reason` |
| `memory.contradicted` | Emitter detected another agent's item contradicts new evidence | `refers_to`, `evidence_ref`, `severity` |
| `memory.superseded` | This item replaces a prior one through a typed merge | `refers_to`, `replacement_strategy` |
| `memory.usage_reported` | Telemetry: emitter actually consumed this item N times in a time window | `refers_to`, `count`, `window_start`, `window_end` |

Five event kinds are enough for v0. Resist adding more until at least three are in production use. Extra kinds will be cheap to invent and expensive to coordinate.

## Envelope schema (binding, v0)

```json
{
	"spec_version": "0.1",
	"event_id": "<ulid>",
	"event_kind": "memory.added | memory.retracted | memory.contradicted | memory.superseded | memory.usage_reported",
	"emitted_at": "<rfc3339 utc>",
	"agent": {
		"id": "<stable agent identifier>",
		"keypair_alg": "ed25519",
		"public_key": "<base64 url-safe>"
	},
	"scope": {
		"kind": "global | user | project | knowledge | failure | session",
		"key": "<scope-specific identifier or null>",
		"repo_root": "<optional repo root for project scope>"
	},
	"provenance": {
		"source": "reflection | conversation | tool_output | imported_legacy | derived",
		"upstream_event_ids": ["<event_id>", "..."],
		"confidence": "observed | inferred | curated | tool_verified"
	},
	"body": { "event-kind specific": true },
	"signature": "<base64 ed25519 over canonical JSON of all other fields>"
}
```

### Canonicalization and signing

Canonical JSON is required for signatures:

- Object keys sorted lexicographically at every level.
- No insignificant whitespace.
- UTF-8 encoded bytes.
- JSON strings emitted with the platform's standard JSON escaping rules, provided the resulting parsed value is identical before signing and verifying.
- Arrays preserve order; do not sort arrays unless the field-specific definition says the array is order-insensitive.

The `signature` MUST cover every envelope field except `signature` itself. A verifier reconstructs the envelope without `signature`, canonicalizes it, and verifies the bytes with `agent.public_key` and `agent.keypair_alg`.

`event_id` SHOULD be a ULID. Natural ordering is useful for local append-only ledgers and makes time-window repair easier. `emitted_at` remains the semantic timestamp; ULID ordering is an indexing convenience, not an authority on clock correctness.

`provenance.upstream_event_ids` enables chain tracing. A derived event can identify the prior assertions or rollups that caused it without copying their full bodies.

## Event body rules

### `memory.added`

Required body fields:

- `target`: one of the current `NexusMemoryTarget` values from `packages/coding-agent/src/nexus/types.ts`: `memory`, `user`, `project`, `knowledge`, `failure`.
- `category`: one of the current `NexusMemoryCategory` values, or `null` when uncategorized.
- `memory_type`: one of the current `NexusMemoryType` values.
- `content`: the portable memory text.
- `confidence`: one of the v0 protocol confidence values: `observed`, `inferred`, `curated`, `tool_verified`.

The envelope-level `scope` is repeated in the taxonomy table because a receiver cannot materialize an addition without it. In JSON it lives at the envelope level, not inside `body`.

### `memory.retracted`

Required body fields:

- `refers_to`: event id being withdrawn by the same or another agent.
- `reason`: concise machine-storable text explaining why the emitter no longer endorses the item.

Retraction is not deletion. It is a signed statement that should affect materialized status, ranking, or quarantine policy. The original event remains in the ledger.

### `memory.contradicted`

Required body fields:

- `refers_to`: event id being challenged.
- `evidence_ref`: URI or repo-relative path to the artifact justifying the contradiction.
- `severity`: one of `observation`, `retract_recommended`, `retract_required`.

A contradiction says, "I have evidence that conflicts with that assertion." It does not silently overwrite the target event.

### `memory.superseded`

Required body fields:

- `refers_to`: event id being replaced.
- `replacement_strategy`: one of `narrower`, `broader`, `corrected`, `merged`, or `scope_changed`.

A supersession event may also carry replacement fields used by the receiver to materialize a new memory row. If those fields are present, they SHOULD follow the `memory.added` body shape.

### `memory.usage_reported`

Required body fields:

- `refers_to`: event id whose materialized memory was used.
- `count`: positive integer count of uses.
- `window_start`: RFC3339 UTC timestamp.
- `window_end`: RFC3339 UTC timestamp later than `window_start`.

Usage events are telemetry, not endorsement. A high count means the receiving or emitting agent consumed the memory; it does not prove truth.

## Provenance and contradiction signaling

`memory.contradicted` carries a severity ladder:

- `observation`: the emitter found conflicting evidence, but the receiver can safely keep both assertions active while ranking or review logic decides.
- `retract_recommended`: the emitter believes the prior event is probably wrong and should be down-ranked or quarantined unless a trusted policy keeps it active.
- `retract_required`: the emitter found evidence strong enough that continuing to use the prior event is unsafe or materially misleading.

`evidence_ref` is a pointer, not an embedded archive. It MAY be a durable URI, an `artifact://` reference, a `pr://` or `issue://` reference, or a repo-relative path such as `docs/Phase6/storage-roadmap-decisions.md`. Receivers that cannot dereference the pointer may still store the contradiction and mark it unverified.

This is preferable to silent overwrite because receiving agents apply their own policy. Deterministic merge across agents requires deterministic signals, not opinions hidden inside last-writer-wins state. A deployment can choose to trust one agent more than another, but the ledger still exposes what happened.

## Worked examples

### Example 1: `memory.added` from an agent observing a tool quirk

```json
{
	"agent": {
		"id": "agent.local.macbook-pro.01",
		"keypair_alg": "ed25519",
		"public_key": "2cdGmYv6YhS2Rk0l9OJm9mYk3TjHq1gK0r5nV9LxQbA"
	},
	"body": {
		"category": "tool-quirk",
		"confidence": "tool_verified",
		"content": "The read tool returns structural summaries for parseable code when no line selector is supplied; use an explicit line range to inspect bodies.",
		"memory_type": "tool_quirk",
		"target": "memory"
	},
	"emitted_at": "2026-05-23T14:05:12Z",
	"event_id": "01JWM0K7S8Q0P3X9T4EV6M2R1A",
	"event_kind": "memory.added",
	"provenance": {
		"confidence": "tool_verified",
		"source": "tool_output",
		"upstream_event_ids": []
	},
	"scope": {
		"key": null,
		"kind": "global",
		"repo_root": null
	},
	"signature": "7l8S6xWnl1EJb7qJ4vFv1y7a9tZ2YwK2Q9O4qj5QY0gN1qP5hU0m9rA3c8eF2dL7QmPz8uY1sT4vW6xZ9aB0cD",
	"spec_version": "0.1"
}
```

### Example 2: `memory.contradicted` from a second agent that re-ran the same tool

```json
{
	"agent": {
		"id": "agent.ci.linux.02",
		"keypair_alg": "ed25519",
		"public_key": "8jQk1vdwtxlFgR2m4n0ZpAEVck9UbsY5o6Lh3SaTqI4"
	},
	"body": {
		"evidence_ref": "artifact://read-regression-2026-05-23",
		"refers_to": "01JWM0K7S8Q0P3X9T4EV6M2R1A",
		"severity": "observation"
	},
	"emitted_at": "2026-05-23T14:11:40Z",
	"event_id": "01JWM0XK9JZ7HTYF3P6A8D4C2M",
	"event_kind": "memory.contradicted",
	"provenance": {
		"confidence": "tool_verified",
		"source": "tool_output",
		"upstream_event_ids": ["01JWM0K7S8Q0P3X9T4EV6M2R1A"]
	},
	"scope": {
		"key": null,
		"kind": "global",
		"repo_root": null
	},
	"signature": "6Qv0lXnT9hE2rJ5cA1yB8zK4mF7uP3sD0wG9iL2oN5qR8tV1xY6aC3eH4jM7pS0d",
	"spec_version": "0.1"
}
```

### Example 3: `memory.usage_reported` telemetry rollup

```json
{
	"agent": {
		"id": "agent.local.macbook-pro.01",
		"keypair_alg": "ed25519",
		"public_key": "2cdGmYv6YhS2Rk0l9OJm9mYk3TjHq1gK0r5nV9LxQbA"
	},
	"body": {
		"count": 7,
		"refers_to": "01JWM0K7S8Q0P3X9T4EV6M2R1A",
		"window_end": "2026-05-23T15:00:00Z",
		"window_start": "2026-05-23T14:00:00Z"
	},
	"emitted_at": "2026-05-23T15:00:08Z",
	"event_id": "01JWM5F7V6N2Q8KTD9P0HA3C1B",
	"event_kind": "memory.usage_reported",
	"provenance": {
		"confidence": "observed",
		"source": "derived",
		"upstream_event_ids": ["01JWM0K7S8Q0P3X9T4EV6M2R1A"]
	},
	"scope": {
		"key": null,
		"kind": "global",
		"repo_root": null
	},
	"signature": "9zN4bK1sT7wQ3mL8cV2xH5pR0yD6fA9eG1jU4oI7qP2nS5tW8vX3aC6dF0hJ9kM",
	"spec_version": "0.1"
}
```

## Receiver behavior (recommended, not normative)

A well-behaved receiver SHOULD:

- Verify the signature before applying any event to materialized memory.
- Reject events whose `spec_version` is unsupported, unless a local migration policy explicitly accepts them.
- Store the raw canonical event in an append-only ledger separate from the materialized memory store.
- Preserve invalid or untrusted events in a quarantine ledger when useful for audit, rather than discarding evidence silently.
- Rebuild materialized state from the ledger so any subset of accepted events yields consistent state.
- Treat `memory.retracted`, `memory.contradicted`, and `memory.superseded` as relation events first, then decide whether to update status or ranking.
- Track per-agent reputation: accepted, contradicted, retracted, and locally rejected ratios should bias future ranking.
- Keep the original `agent.id`, `event_id`, and `signature` with the raw event. Do not rewrite them into local identifiers only.
- Avoid applying `memory.usage_reported` directly as truth. It can update usage counters or ranking features, but it is still telemetry.

## Mapping to current Amaze schema

Current code exposes memory domain types in `packages/coding-agent/src/nexus/types.ts` and storage columns in `packages/coding-agent/src/nexus/store.ts`. The v0 event shape maps to the existing store without requiring a shared database file.

| Exchange field | Current Amaze target | Mapping note |
| --- | --- | --- |
| `event_id` | `memory_events.id` or raw ledger id | Use as the stable protocol event id. If materialized into `memory_items.id`, preserve the raw event separately to avoid conflating assertion id with memory row id. |
| `event_kind` | `memory_events.event_type` | Existing `memory_events` is local audit state; exchange events need a raw append-only ledger before or beside this table. |
| `agent.id` | `memory_sources.source_id` or `memory_items.provenance` | Current schema has `source_id` on `memory_items` and `source` on `memory_events`; a receiver can derive or create a source record per agent. |
| `scope.kind`, `scope.key` | `memory_scopes.kind`, `memory_scopes.key`, `memory_items.scope_id` | `scope_id` is derived from `scope.kind` plus `scope.key` under receiver policy. |
| `scope.repo_root` | `memory_scopes.repoRoot` / `repo_root` equivalent in code model | Project scope can preserve repo root when the receiver recognizes the repository identity. |
| `body.target` | `memory_items.target` | Must match the current target enum: `memory`, `user`, `project`, `knowledge`, `failure`. |
| `body.category` | `memory_items.category` | Must match the current category enum or be `null`. |
| `body.memory_type` | `memory_items.memory_type` | Must match the current `NexusMemoryType` values to avoid lossy imports. |
| `body.content` | `memory_items.content` | Store the portable memory text exactly; presentation formatting is downstream. |
| `provenance.source` plus `agent.id` | `memory_items.provenance` and `memory_items.source_id` | Current `provenance` is a text column; receivers should retain enough data to reconstruct source, agent, and event id. |
| `body.confidence` | `memory_items.confidence` | See confidence compatibility note below. |
| `memory.usage_reported.body.count` | `memory_items.usage_count` | Roll up only after policy accepts the referenced event. |
| `memory.usage_reported.body.window_end` | `memory_items.last_used_at` | Use the max accepted `window_end`, not event arrival time. |
| `memory.contradicted.body.refers_to` | `memory_relations.relation = 'contradicts'` | Relation can be materialized between local row ids after resolving event ids. |
| `memory.superseded.body.refers_to` | `memory_relations.relation = 'supersedes'`; `memory_items.status = 'superseded'` | Status update is policy-dependent; the relation should remain append-only. |

Confidence compatibility requires care. The protocol examples use `observed`, `inferred`, `curated`, and `tool_verified`. Current `packages/coding-agent/src/nexus/types.ts` defines `NexusConfidence` as `user_asserted`, `tool_verified`, `inferred`, `imported_unverified`, and `hypothesis`. Therefore v0 implementers must either add a compatible translation layer or defer implementation until the enum is reconciled. The spec-level intent is that `body.confidence` and `provenance.confidence` preserve `observed | inferred | curated | tool_verified` without translation loss.

If implementation proceeds before reconciliation, do not silently collapse `observed` into `inferred` or `curated` into `user_asserted`. That would erase the difference between direct observation, human curation, and model inference.

## Open questions (do not pretend to resolve)

- Are scope keys globally unique or per-agent? If per-agent, how do two agents agree on "this is the same project"?
- Repository identity: git remote URL vs git repo root hash vs first commit SHA?
- How is a deprecated `spec_version` deprecated in practice?
- ULID vs UUIDv7?
- Should public keys be carried on every event, or should events carry a key id that resolves through a separate trust document?
- What is the minimum evidence durability required before a receiver should honor `retract_required`?

## Future-trigger conditions

Implementation should begin only when at least one of these is true:

- A second Amaze user explicitly requests "share memory with my other agent".
- Or a research collaboration wants federated agent traces.
- Or ADR D3 in `docs/Phase6/storage-roadmap-decisions.md` is triggered and the design wants protocol semantics on top of replication.

## Re-evaluation trigger (when to implement, not just spec)

- A second Amaze user explicitly requests "share memory with my other agent".
- OR a research collaboration wants federated agent traces.
- OR ADR D3 (libSQL) is triggered and the design wants protocol semantics on top of replication.

## Reference

- ADR `docs/Phase6/storage-roadmap-decisions.md` D3, D4.
- `docs/agi.md` Section 8 ("persona" caveats): this spec preserves the prior principle that events are guidance, not authority.
