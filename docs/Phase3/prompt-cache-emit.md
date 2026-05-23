# Prompt cache observability emission

`SessionEvent` declares `prompt.cache`, but the Phase2 observability coverage audit marks it unimplemented because the current prompt-cache policy path does not expose reliable read/write token detail to an emitter; implement this only after provider response metadata and cache miss classification are available on the production turn path, then update the audit row in `docs/Phase2/observability-coverage.md` from `unimplemented` to `covered` with a direct emission test.
