# Development

See [AGENTS.md](../../../AGENTS.md) at the monorepo root for fork-specific guidelines (`changes.md` contract, extension-first philosophy, tab indent / 120 width, etc.).

## Setup

```bash
git clone https://github.com/code-yeongyu/amaze
cd amaze
npm install
npm run build
```

Run from source:

```bash
/path/to/amaze/pi-test.sh
```

The script can be run from any directory. amaze keeps the caller's current working directory.

## Forking / Rebranding

This repo is itself a rebrand of upstream `pi-mono` to `amaze`. The runtime identity (CLI name, config dir, env var prefix) is configured via `package.json`:

```json
{
  "amazeConfig": {
    "name": "amaze",
    "configDir": ".amaze"
  }
}
```

Change `name`, `configDir`, and `bin` field for your fork. Affects CLI banner, config paths, and environment variable names.

## Path Resolution

Three execution modes: npm install, standalone binary (`bun build --compile`), tsx from source.

**Always use `src/config.ts`** for package assets:

```typescript
import { getPackageDir, getThemesDir } from "./config.js";
```

Never use `__dirname` directly for package assets.

## Debug Command

`/debug` (hidden) writes to `~/.amaze/agent/amaze-debug.log`:
- Rendered TUI lines with ANSI codes
- Last messages sent to the LLM

## Testing

```bash
npm test            # Vitest across workspaces (skips live-API; default test runner)
./pi-test.sh        # Launch the CLI from source via tsx for manual testing (--no-env unsets API keys)
npm run check       # Biome + tsgo + browser-smoke + web-ui check (pre-commit equivalent)
```

Live-API tests are env-gated vitest tests. Set `PI_ENABLE_LIVE_API_TESTS=1` (or a per-provider flag from `packages/ai/test/live-api-gates.ts`) plus the provider API keys, then run `npm test`.

Run a specific test:

```bash
npm test --workspace amaze -- test/specific.test.ts
```

## Project Structure

```
packages/
  ai/           # @steve-8000/amaze-ai — LLM provider abstraction
  agent/        # @steve-8000/amaze-agent-core — Agent loop and message types
  tui/          # @steve-8000/amaze-tui — Terminal UI components
  coding-agent/ # amaze — CLI and interactive mode (this package)
  web-ui/       # @steve-8000/amaze-web-ui — Lit chat components
```

See the monorepo root [AGENTS.md](../../../AGENTS.md) for the full task → location map.
