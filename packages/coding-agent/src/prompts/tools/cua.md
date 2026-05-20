Computer-use automation through CUA.

Use this tool when you need to interact with a real desktop, app, VM/container sandbox, or the local host GUI.

Actions:
- `start`: start or reconnect a sandbox. Optional fields: `name`, `os` (`linux`, `macos`, `windows`, `android`), `version`, `kind` (`vm`, `container`), `runtime` (`auto`, `docker`, `qemu`, `lume`, `tart`). Not available in `localhost` mode.
- `list`: list tracked/active sandboxes.
- `stop`: stop a sandbox by `name`.
- `screenshot`: capture a PNG screenshot from `sandbox` or the default target.
- `click`: click at `x`, `y`; optional `button` and `clicks`.
- `type`: type literal `text`.
- `key`: press one key chord or an array of chords via `keys`.
- `scroll`: scroll at `x`, `y`; prefer `dx` and `dy` for deltas.
- `shutdown`: stop tracked sandboxes and shut down this tool's daemon.

Modes come from `.amaze/cua.jsonc` in the project or `~/.amaze/cua.json` globally. Project config overrides global config key-by-key. Default mode is `local`; `localhost` controls the host GUI directly and does not use sandboxes; `cloud` uses CUA cloud if its configured API key environment variable is set, otherwise the tool falls back to local mode and reports a warning.

If the Python `cua` package is unavailable, install it with `pip install cua` before using actions that require CUA.
