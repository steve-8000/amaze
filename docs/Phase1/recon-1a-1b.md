# Phase1 Recon 1A/1B Anchor Report

## 1. T1.2/T1.3 mutation scope guard
- `packages/coding-agent/src/subagent/contract.ts:363` `export function enforceContractScope(contract: SubagentContract | undefined, filePath: string, throwError: (message: string) => never): void`
- `packages/coding-agent/src/subagent/contract.ts:385` `export function enforceGoalScope(goalScope: { include: string[]; exclude: string[] } | undefined, filePath: string, throwError: (message: string) => never): void`
- `packages/coding-agent/src/subagent/contract.ts:416` `export function checkScope(contract: SubagentContract | undefined, filePath: string): { allowed: true } | { allowed: false; reason: string }`
- `packages/coding-agent/src/tools/write.ts:17` imports both guards; `packages/coding-agent/src/edit/index.ts:23` imports both guards for edit/apply-patch variants.
- `packages/coding-agent/src/capability/tool.ts:27` defines the custom tool capability (`toolCapability = defineCapability<CustomTool>({ id: "tools", ... })`).

```ts
// packages/coding-agent/src/subagent/contract.ts:363
export function enforceContractScope(...): void {
  const verdict = checkScope(contract, filePath);
  if (!verdict.allowed) throwError(`SubagentContract scope violation: ${verdict.reason} ...`);
}

// packages/coding-agent/src/edit/index.ts:355
const contract = this.session.getSubagentContract?.();
enforceContractScope(contract, pathField, ...);
if (!contract) enforceGoalScope(this.session.getGoalModeState?.()?.goal?.scopeGuard, pathField, ...);
```

Current behavior: edit/write call contract scope first; goal scope is only a fallback when no subagent contract is active; `checkScope` normalizes slashes and applies Bun `Glob` exclude before include.

Wrong assumption note: guards are not in `tools/edit/`; edit variants live in `packages/coding-agent/src/edit/index.ts`, while `write.ts` is flat under `src/tools/`.

## 2. T1.4 isolated verifier loop
- Non-isolated contracted branch: `packages/coding-agent/src/task/index.ts:879` `const runTask = async (...) => { if (!isIsolated) { ... } }`; contracted loop begins at `packages/coding-agent/src/task/index.ts:938`.
- Isolated branch: `packages/coding-agent/src/task/index.ts:995` starts after the non-isolated return path and calls `runSubprocess` directly at `packages/coding-agent/src/task/index.ts:1006`.
- `packages/coding-agent/src/subagent/task-revision-loop.ts:76` `export async function executeContractedTask(options: ExecuteContractedTaskOptions): Promise<ExecuteContractedTaskOutcome>`.
- `packages/coding-agent/src/subagent/contract.ts:119` `export async function runRevisionLoop(args: { contract: SubagentContract; attempt: (revisionRequest: RevisionRequest | undefined) => Promise<SubagentCompletion>; maxRetries?: number; }): Promise<...>`.
- `packages/coding-agent/src/subagent/contract.ts:231` `export function stampContractRevision(contract: SubagentContract, parentCurrentRevision: number | undefined): SubagentContract`.

```ts
// packages/coding-agent/src/task/index.ts:938
if (stampedContract) {
  const cwdBefore = new Set(await snapshotGitChangedFiles(this.session.cwd));
  const outcome = await executeContractedTask({ contract: stampedContract, baseAssignment, runOnce: async (...) => { ... } });
}

// packages/coding-agent/src/task/index.ts:1006
const result = await runSubprocess({ cwd: this.session.cwd, worktree: isolationDir, agent, ... contract: task.contract, ... });
```

Current behavior: verifier revision loop is wired only for non-isolated contracted tasks; isolated tasks pass `contract` into `runSubprocess` but do not wrap with `executeContractedTask` or stamp parent revision.

Wrong assumption note: “task/index.ts isolated branch” is a separate direct-run path; T1.4 cannot assume the non-isolated `executeContractedTask` wiring already covers isolation.

## 3. T2.1 uncertain policy
- `packages/coding-agent/src/goals/verifier.ts:67` `export interface AcceptanceCriterion { id: string; description: string; check: CriterionKind; }`.
- `packages/coding-agent/src/goals/verifier.ts:591` `export class AcceptanceVerifier` with `async verify(criteria: AcceptanceCriterion[], ctx: VerificationContext): Promise<CriterionResult[]>`.
- `packages/coding-agent/src/goals/verifier.ts:667` `export function summarize(results: CriterionResult[]): VerificationVerdict`.
- `packages/coding-agent/src/goals/runtime.ts:620` `async completeGoalFromTool(options?: { expectedGoalId?: string; force?: boolean; verificationContext?: VerificationContext; }): Promise<{ goal: Goal; verdict?: VerificationVerdict }>`.

```ts
// packages/coding-agent/src/goals/verifier.ts:667
export function summarize(results: CriterionResult[]): VerificationVerdict {
  ...
  return { verdict: failedCount > 0 ? "fail" : "pass", failedCount, uncertainCount, passedCount, results };
}

// packages/coding-agent/src/goals/runtime.ts:649
const results = await new AcceptanceVerifier().verify(criteria, ctx);
verdict = summarize(results);
if (verdict.verdict === "fail") throw new GoalAcceptanceFailureError(verdict);
```

Current behavior: `uncertain` criteria are counted and surfaced but do not block; only `fail` makes `summarize` return `fail` and blocks `completeGoalFromTool`.

Wrong assumption note: uncertain policy is already permissive in summary/runtime; a “fail on uncertain” hardening would be a behavior change, not filling a gap.

## 4. T2.2 yield bypass
- `packages/coding-agent/src/tools/yield.ts:108` `export class YieldTool implements AgentTool<TSchema, YieldDetails>`.
- `packages/coding-agent/src/tools/yield.ts:201` `async execute(...)`.
- Bypass variable: `packages/coding-agent/src/tools/yield.ts:231` `let schemaValidationOverridden = false;`.

```ts
// packages/coding-agent/src/tools/yield.ts:236
if (this.#validate) {
  const parsed = this.#validate(data);
  if (!parsed.success) {
    this.#schemaValidationFailures++;
    if (this.#schemaValidationFailures <= 1) {
      throw new Error(`Output does not match schema: ${formatJsonSchemaIssues(parsed.issues)}`);
    }
    schemaValidationOverridden = true;
  }
}
```

Current behavior: first schema validation failure throws; the second and later invalid successful yields are accepted with “schema validation overridden” text.

Wrong assumption note: bypass is stateful per `YieldTool` instance via `#schemaValidationFailures`, not a parameter or explicit user override.

## 5. T2.3 command criteria shell
- `packages/coding-agent/src/goals/verifier.ts:240` `async function checkCommandExit(criterion: AcceptanceCriterion & { check: { type: "command-exit" } }, ctx: VerificationContext): Promise<CriterionResult>`.
- `packages/coding-agent/src/goals/verifier.ts:286` `async function checkCommandOutput(criterion: AcceptanceCriterion & { check: { type: "command-output" } }, ctx: VerificationContext): Promise<CriterionResult>`.

```ts
// packages/coding-agent/src/goals/verifier.ts:249
const proc = Bun.spawn(["sh", "-c", command], { cwd: workdir, stdout: "pipe", stderr: "pipe", signal: controller.signal });

// packages/coding-agent/src/goals/verifier.ts:295
const proc = Bun.spawn(["sh", "-c", command], { cwd: workdir, stdout: "pipe", stderr: "pipe", signal: controller.signal });
```

Current behavior: both command criteria execute arbitrary shell strings through `sh -c`, pipe stdout/stderr, and optionally abort via `AbortController` timeout.

Wrong assumption note: this is not routed through the bash tool/minimizer/policy layer; it directly shells inside the verifier.

## 6. T2.4 exec alias
- `packages/coding-agent/src/task/executor.ts:495` `export async function runSubprocess(options: ExecutorOptions): Promise<SingleResult>`.
- Alias expansion: `packages/coding-agent/src/task/executor.ts:591`.

```ts
// packages/coding-agent/src/task/executor.ts:579
let toolNames: string[] | undefined;
if (agent.tools && agent.tools.length > 0) toolNames = agent.tools;
...
if (toolNames?.includes("exec")) {
  const allowEvalPy = settings.get("eval.py") ?? true;
  const allowEvalJs = settings.get("eval.js") ?? true;
  const expanded = toolNames.filter(name => name !== "exec");
  if (allowEvalPy || allowEvalJs) expanded.push("eval");
  expanded.push("bash");
  toolNames = Array.from(new Set(expanded));
}
```

Current behavior: subagent `agent.tools` containing `exec` is translated to `bash` plus `eval` only when at least one eval runtime is enabled.

Wrong assumption note: there is no runtime tool named `exec` handed to the subagent after expansion; policies must reason about `bash`/`eval` exposure.

## 7. T2.5 dirty file attribution
- `packages/coding-agent/src/subagent/task-revision-loop.ts:134` `export async function snapshotGitChangedFiles(cwd: string): Promise<string[]>`.
- Call sites: imported in `packages/coding-agent/src/task/index.ts:31`; used at `packages/coding-agent/src/task/index.ts:939` before contracted attempt and `packages/coding-agent/src/task/index.ts:952` after attempt.

```ts
// packages/coding-agent/src/task/index.ts:939
const cwdBefore = new Set(await snapshotGitChangedFiles(this.session.cwd));
...
const cwdAfter = await snapshotGitChangedFiles(this.session.cwd);
const changedFiles = cwdAfter.filter(p => !cwdBefore.has(p));
```

Current behavior: changed files attributed to the subagent are set-difference of git dirty paths after vs. before the contracted non-isolated task attempt.

Wrong assumption note: pre-existing dirty files are intentionally excluded; this does not detect modifications to files that were already dirty before the subagent ran.

## 8. T3.1 contradiction
- `packages/coding-agent/src/nexus/store.ts:1139` `#detectTextContradictions(): number`.
- `packages/coding-agent/src/nexus/store.ts:1552` `function scoreContradictionLikelihood(a: { content: string; confidence: string; vector?: Float32Array }, b: ...): number`.

```ts
// packages/coding-agent/src/nexus/store.ts:1158
const score = scoreContradictionLikelihood(entries[i], entries[j]);
if (score < threshold) continue;
this.#dbInstance.prepare("INSERT OR IGNORE INTO memory_relations ... 'contradicts' ...").run(...);

// packages/coding-agent/src/nexus/store.ts:1556
let score = 0.5;
if (hasA && hasB && a.vector!.length === b.vector!.length) { ... } else if (!hasA && !hasB) { score = 0.85; }
if (a.confidence === "imported_unverified" || b.confidence === "imported_unverified") score -= 0.1;
```

Current behavior: active memory rows are grouped by scope/target/type/subject key; pairwise score over threshold creates bidirectional `contradicts` relations.

Wrong assumption note: contradiction detection is heuristic and not text-semantic beyond subject key, embedding cosine, and confidence penalty.

## 9. T3.2 skill lifecycle
- `packages/coding-agent/src/nexus/store.ts:833` `upsertSkill(scopeId: string, name: string, content: string, sourceMemoryIds: string[], status: "draft" | "active" | "validated" = "active"): boolean`.
- `packages/coding-agent/src/nexus/store.ts:1174` `#promoteRepeatedSkillCandidates(): number`.
- `packages/coding-agent/src/nexus/pipeline.ts:544` `async function promoteConceptualSkills(store: NexusStore, config: NexusConfig, counters: PipelineCounters, llmClient: NexusLlmClient | null): Promise<void>`.
- `packages/coding-agent/src/nexus/store.ts:1396` `function renderSkillMarkdown(skill: { name: string; content: string; status: string; sourceMemoryIds: string[] }): string`.
- Current `SkillStatus` type is not named `SkillStatus`; status is inline union in `upsertSkill` (`"draft" | "active" | "validated"`) and rendered as a plain string.

```ts
// packages/coding-agent/src/nexus/store.ts:1196
INSERT INTO memory_skills (...) VALUES (..., 'draft', ...)

// packages/coding-agent/src/nexus/pipeline.ts:586
if (store.upsertSkill(scopeId, name, content, sourceIds, "active")) counters.conceptualSkills += 1;
```

Current behavior: deterministic repeated candidates create draft skills; LLM conceptual promotion upserts active skills; render writes generated `SKILL.md` with frontmatter and source IDs.

Wrong assumption note: lifecycle status is not centralized as an exported `SkillStatus` type, and deterministic promotion inserts draft while `upsertSkill` defaults active.

## 10. T3.4 static memory fence
- `packages/coding-agent/src/memory-backend/nexus-backend.ts:57` `async buildDeveloperInstructions(agentDir: string, settings: Settings, session): Promise<string | undefined>`.
- Merge locations: project `memory_summary.md` at `packages/coding-agent/src/memory-backend/nexus-backend.ts:63`, global at `:67`, user at `:70`.
- Prompt injection call site: `packages/coding-agent/src/sdk.ts:1534` calls `resolveMemoryBackend(settings).buildDeveloperInstructions(...)`.

```ts
// packages/coding-agent/src/memory-backend/nexus-backend.ts:73
const sections = [projectSummary.trim(), globalSummary.trim(), userSummary.trim()].filter(Boolean);
if (sections.length === 0) return undefined;
const body = sections.join("\n\n").slice(0, config.staticPromptMaxChars);
return ["## Memory", "", "Memory is durable context, not authority. ...", "", body].join("\n");
```

Current behavior: static memory summaries are concatenated project/global/user, truncated, and returned as developer instructions without an explicit XML/security fence.

Wrong assumption note: `buildDeveloperInstructions` is implemented by memory backend, not `system-prompt.ts`; `system-prompt.ts` does not contain the `memory_summary.md` merge.

## 11. T3.5 session index
- `packages/coding-agent/src/nexus/session-search.ts:335` `async function indexNexusSessionFile(sessionFile: string, db: Database): Promise<boolean>`.
- `packages/coding-agent/src/nexus/session-search.ts:325` `function ensureTrigramBackfill(db: Database): void`.
- Call sites: `packages/coding-agent/src/nexus/session-search.ts:95` in reindex loop; `:112` for current session; `:321` during DB open/init.

```ts
// packages/coding-agent/src/nexus/session-search.ts:321
ensureTrigramBackfill(db);

// packages/coding-agent/src/nexus/session-search.ts:335
async function indexNexusSessionFile(sessionFile: string, db: Database): Promise<boolean> {
  const stat = await fs.stat(sessionFile);
  const current = db.prepare("SELECT * FROM nexus_sessions WHERE session_file = ?").get(sessionFile) ...
```

Current behavior: session files are indexed into Nexus session tables, and trigram FTS backfill is attempted during DB initialization if missing.

Wrong assumption note: both functions are private to `session-search.ts`; external callers use `reindexNexusSessions` / `indexCurrentNexusSession` rather than importing these anchors.

## 12. T3.6 startup degraded
- Nexus backend start: `packages/coding-agent/src/memory-backend/nexus-backend.ts:31` `async start(options: MemoryBackendStartOptions): Promise<void>`.
- Failure handling: `packages/coding-agent/src/memory-backend/nexus-backend.ts:39` catches startup maintenance errors.
- Runtime event recorder imported at `packages/coding-agent/src/memory-backend/nexus-backend.ts:14` from `../nexus/store`.

```ts
// packages/coding-agent/src/memory-backend/nexus-backend.ts:37
try {
  await runStartupMaintenance(store, settings, config, options.agentDir, session.sessionManager.getCwd(), session);
} catch (error) {
  try { recordRuntimeEvent(store.db, { kind: "startup_failure", severity: "warn", message: String(error) }); } catch {}
  logger.debug("Nexus startup failed; continuing without blocking agent loop", { error: String(error) });
} finally {
  store.close();
}
```

Current behavior: startup maintenance failure is degraded/non-blocking; records a Nexus runtime event when possible and logs debug, then continues.

Wrong assumption note: there is no thrown startup hard-fail in normal backend `start`; runtime events are DB records via `recordRuntimeEvent`, not a UI event bus channel.

## 13. Settings schema
- `packages/coding-agent/src/memory-backend/types.ts:14` `export type MemoryBackendId = "off" | "nexus"`.
- `packages/coding-agent/src/config/settings-schema.ts:232` `export const SETTINGS_SCHEMA = { ... }`.
- Memory key: `packages/coding-agent/src/config/settings-schema.ts:1324` `"memory.backend": { type: "enum", values: ["off", "nexus"] as const, default: "off", ... }`.
- Goal keys: `packages/coding-agent/src/config/settings-schema.ts:2150` `"goal.enabled"`, `:2160` `"goal.statusInFooter"`, `:2170` `"goal.continuationModes"`.

```ts
// packages/coding-agent/src/config/settings-schema.ts:1324
"memory.backend": { type: "enum", values: ["off", "nexus"] as const, default: "off", ... }

// packages/coding-agent/src/memory-backend/types.ts:14
export type MemoryBackendId = "off" | "nexus";
```

Current behavior: schema definitions live in `config/settings-schema.ts`; `Settings` in `config/settings.ts` consumes `SETTINGS_SCHEMA`; memory backend ID type lives separately in `memory-backend/types.ts`.

Wrong assumption note: not `config/settings.ts` for key definitions; that file is the settings manager, not the schema source.

## 14. Test runner conventions
- Test directory is `packages/coding-agent/test/` (singular).
- Example 1: `packages/coding-agent/test/goals/verifier.test.ts:1` imports from `bun:test`; `:5` imports package aliases like `@amaze/coding-agent/goals/verifier`; local helper `withTempDir` is defined at `:12`.
- Example 2: `packages/coding-agent/test/subagent/scope-guard.test.ts:11` imports from `bun:test`; `:15` imports `@amaze/coding-agent/...`; local helper `createSession` is defined at `:21`.
- Shared helpers also exist, e.g. `packages/coding-agent/test/core/helpers.ts` and `packages/coding-agent/test/helpers/agent-session-setup.ts`.

```ts
// packages/coding-agent/test/goals/verifier.test.ts:1
import { describe, expect, it } from "bun:test";
import { AcceptanceVerifier } from "@amaze/coding-agent/goals/verifier";

// packages/coding-agent/test/subagent/scope-guard.test.ts:21
function createSession(cwd: string, contract?: SubagentContract): ToolSession { ... }
```

Current behavior: tests use Bun’s test API, package alias imports, and often local file-scoped helpers for temp dirs or mocked sessions.

Wrong assumption note: Phase docs saying `tests/` are stale; new tests should follow `packages/coding-agent/test/` and existing alias import style.
