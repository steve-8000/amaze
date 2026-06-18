# Repository Conventions

Conventions for human contributors and AI agents working on this repository.

## Style

- Terse technical prose. No emojis in commits, issues, PR comments, or code.
- TypeScript strict mode. No `any`, no `unknown` casts where avoidable, no `@ts-ignore`, no `@ts-expect-error`, no enums.
- ESM modules with `.js` suffix in import paths.
- Tabs for indentation. Double quotes for strings.
- Tests use vitest with `#given .. #when .. #then` descriptions or plain `// given / // when / // then` body comments.

## Commands

- `npm install` — install dependencies.
- `npm test` — run vitest once.
- `npm run typecheck` — strict TypeScript check.
- `npm run check` — type check + biome.
- `npm pack --dry-run` — release package smoke test.
- `pi -e ./src/index.ts` — load the extension into a local pi session for manual smoke testing.
- `amaze -e ./src/index.ts` — load the extension into a local amaze session for manual smoke testing.

## Constraints

- No Bun APIs. Runtime is Node only.
- No dependency on amaze internal modules outside the documented public extension API in `amaze`.
- Keep `write`, `edit`, `multiedit`, and `apply_patch` support covered by tests.
- `apply_patch` must support OMO-compatible metadata and raw Codex patch fallback.
- Do not modify footer UI; use the `amaze-comment-checker` above-editor widget only.

## Don'ts

- No `git add -A` or `git add .`. Stage only the files you changed.
- No `git commit --no-verify`. No force pushes. No history rewriting on shared branches.
- Do not couple this package back to omo or amaze internal source paths.
