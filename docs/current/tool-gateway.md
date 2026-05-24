# Tool Gateway

> Post-refactor architecture. Paths are relative to
> `packages/coding-agent/src/` unless stated otherwise.

`ToolGateway` (`tools/gateway/tool-gateway.ts`) runs a model tool call through a
fixed policy pipeline before the tool's `execute()`:

```
PolicyGate → PermissionGate → MutationScopeGuard → TimeoutPolicy → execute
```

Stages live alongside the gateway:

- `PolicyGate` — optional first-stage gate (e.g. a mission policy engine).
  Defaults to allow-all in the skeleton.
- `PermissionGate` (`tools/gateway/permission-gate.ts`) — permission checks.
- `MutationScopeGuard` (`tools/gateway/mutation-guard.ts`) — mutation-scope
  enforcement.
- `TimeoutPolicy` (`tools/gateway/timeout-policy.ts`) — per-call timeout.
- Risk classification: `tools/gateway/risk-classifier.ts` (`classifyRisk`).

On any policy denial the gateway short-circuits with a failed `ToolResult`
(carrying a `DenyStage` of `policy | permission | mutation`) rather than
throwing.

## Status

The gateway is **additive and opt-in**: no existing tool call path is routed
through it yet. The agent loop still dispatches tools directly via
`target.execute(...)` in `session/agent-session.ts`. Tools are described by
`ToolDescriptor` (`tools/registry/tool-descriptor.ts`) and registered through
`ToolRegistry` (`tools/registry/tool-registry.ts`); legacy registrations bridge
in via `tools/registry/legacy-registrations.ts`. Lifecycle hooks on the gateway
are optional callbacks with no event emission in the skeleton.
