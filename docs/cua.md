# CUA Computer Use

Amaze includes a built-in `cua` tool for computer-use automation through the Python `cua` package. Use it when the agent must interact with a real desktop, GUI app, VM/container sandbox, or local host GUI rather than inspecting files or using browser automation.

## Install

The tool launches a Python daemon. Install CUA in the Python environment visible to Amaze:

```sh
pip install cua
```

If `cua` is unavailable, actions that require it report `cuaAvailable: false` and include the import error.

## Configuration

Config files are merged key-by-key:

1. Global: `~/.amaze/cua.json`
2. Project: `.amaze/cua.jsonc` (overrides global keys)

Minimal local config:

```jsonc
{
  "mode": "local",
  "local": {
    "runtime": "auto",
    "image": { "os": "linux", "kind": "container" },
    "ephemeral": true
  }
}
```

Modes:

| Mode | Behavior |
| --- | --- |
| `local` | Starts or controls a local CUA sandbox via Docker/QEMU/Lume/Tart as configured. |
| `localhost` | Controls the host GUI directly. `start` is not available because there is no sandbox. |
| `cloud` | Uses CUA cloud when `cloud.apiKeyEnv` is set and present in the environment; otherwise falls back to `local` and reports a warning. |

Config fields:

| Field | Purpose |
| --- | --- |
| `local.runtime` | `auto`, `docker`, `qemu`, `lume`, or `tart`. |
| `local.image` | Default sandbox image `{ os, version, kind }`. |
| `local.ephemeral` | Whether local sandboxes are temporary. |
| `localhost.confirmDestructive` | Host-GUI safety switch for destructive actions. |
| `cloud.apiKeyEnv` | Environment variable containing the cloud API key; defaults to CUA's configured env behavior. |
| `cloud.image` / `cloud.region` | Cloud sandbox selection. |
| `python.executable` | Python executable for the daemon. |
| `python.startupTimeoutMs` / `python.requestTimeoutMs` | Daemon startup/request timeouts. |
| `telemetry.enabled` | CUA telemetry setting passed to the daemon config. |

Environment variables are documented in [environment-variables.md](./environment-variables.md). `CUA_API_KEY` is the usual cloud credential.

## Actions

| Action | Purpose |
| --- | --- |
| `start` | Start or reconnect a sandbox. Optional: `name`, `os`, `version`, `kind`, `runtime`. Not available in `localhost` mode. |
| `list` | List tracked/active sandboxes. |
| `stop` | Stop a sandbox by `name`. |
| `screenshot` | Capture a PNG screenshot from `sandbox` or the default target. |
| `click` | Click at `x`, `y`; optional `button` and `clicks`. |
| `type` | Type literal `text`. |
| `key` | Press one key chord or an array of chords via `keys`. |
| `scroll` | Scroll at `x`, `y`; prefer `dx` and `dy` for deltas. |
| `shutdown` | Stop tracked sandboxes and shut down the daemon. |

## Safety notes

- Prefer `local` sandbox mode for untrusted pages/apps.
- Use `localhost` only when the task explicitly requires controlling the host GUI.
- Capture a `screenshot` before coordinate-based `click`/`scroll` actions.
- Stop or `shutdown` sandboxes after a task when they are no longer needed.
