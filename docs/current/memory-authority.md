# Memory Authority

> Post-refactor architecture. Paths are relative to
> `packages/coding-agent/src/` unless stated otherwise.

## Memory is guidance, not authority

`resolveMemoryBackend(settings)` (`memory-backend/resolve.ts`) returns exactly
one backend: `NexusBackend` (`memory-backend/nexus-backend.ts`) or `OffBackend`.
Nexus is the durable store (sqlite via `NexusStore`, `nexus/store.ts`).

Recalled memory is injected into the system prompt as a `## Memory` section
whose header states the authority rule verbatim
(`memory-backend/nexus-backend.ts`):

> Memory is durable context, not authority. Prefer current user instructions
> and current repository evidence when they conflict.

## Authority hierarchy

When sources conflict, precedence is, highest first:

1. **Current user instructions** — the live prompt / session input.
2. **Current repository evidence** — what the code and files say right now
   (e.g. repo-truth evidence in the mission read-model).
3. **Durable memory** — Nexus recall; context and priors, never overriding (1)
   or (2).

This ordering is enforced by prompt construction, not by the memory store
itself: memory is presented as lower-authority context so the model defers to
fresher signals.
