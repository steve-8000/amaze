# Rocky Codebase Profile Engine Goal

> Goal document for implementing Rocky as the single codebase intelligence point for Amaze.
> This document is intentionally executable: an agent can start from this goal and work task by task until the architecture is implemented.

## 0. Goal Boundary

- Amaze is the CLI/TUI agent runtime.
- Rocky is the always-on backend.
- Rocky-memory is the memory backend exposed through Rocky HTTP.
- Rocky-codebase is the codebase intelligence backend exposed through Rocky HTTP.
- AI agents should stop manually improvising code search whenever Rocky can provide a bounded, scoped, profile-driven answer.
- Rocky must not increase context usage by flooding the agent with raw search results.
- Rocky must return bounded read plans, snippets, expansion handles, and freshness metadata.
- The system must remain useful on very large repositories and multi-root workspaces.

## 1. Executive Summary

Rocky should absorb codebase discovery tools such as lexical search, graph search, AST parsing, ast-grep, and LSP. The agent should call a small set of structured profile APIs instead of directly orchestrating raw tools. Rocky will internally gather many candidates, normalize them into evidence, cluster them, rank them, cut them to a strict budget, and return only a compact read plan. The plan must include bounded snippets, point identifiers, file revision tokens, deterministic cluster labels, and expansion handles.

The target outcome is not a bigger search result. The target outcome is fewer reads, better reads, and reproducible search behavior.

## 2. Non-Negotiable Principles

- Every codebase query must carry an explicit search scope contract.
- No backend component may expand from cwd to parent roots silently.
- Every response must echo the effective roots used by Rocky.
- Raw LSP references, raw grep hits, raw AST dumps, and raw graph neighborhoods must not be returned by default.
- Every profile response must be bounded by explicit budget fields.
- Every returned snippet must be small enough to fit a predictable context budget.
- Every read point must carry a file revision token or content hash.
- Every deferred cluster label must be deterministic by default, not LLM-written.
- LLM summaries are optional and must operate only over bounded evidence selected by Rocky.
- Amaze should call Rocky profiles first and fall back to raw tools only when Rocky is unavailable or explicitly insufficient.
- Rocky must preserve enough internal plan state to support progressive expansion without resending all candidates.

## 3. Current State Assumptions

- Rocky already exposes memory endpoints under /v1/rocky/memory/*.
- Rocky already exposes codebase endpoints under /v1/rocky/codebase/*.
- Rocky has a scope resolver for cwd, workspace, parent_1, parent_2, and explicit_roots.
- Amaze can pass cwd and scope to Rocky codebase search.
- The next architecture step is to move from search endpoints to profile-driven locate/read/expand endpoints.
- The implementation must be incremental; existing search_graph and search_code should remain compatible during migration.

## 4. Target API Surface

- POST /v1/rocky/codebase/plan: Create a bounded codebase read plan from a profile, query, scope, and budget.
- POST /v1/rocky/codebase/expand: Expand a selected deferred cluster, symbol, call chain, or file family from an existing plan.
- POST /v1/rocky/codebase/read: Read one or more point_id values with freshness validation and bounded line windows.
- POST /v1/rocky/codebase/validate_points: Verify that returned point hashes still match current filesystem contents.
- GET /v1/rocky/codebase/plan/{plan_id}: Fetch compact plan metadata without raw candidate flood.
- DELETE /v1/rocky/codebase/plan/{plan_id}: Release stored plan state explicitly.
- GET /v1/rocky/codebase/profiles: List supported profiles and their budget defaults.
- GET /v1/rocky/codebase/health: Report collector availability, index freshness, LSP readiness, ast-grep readiness, and plan store state.

## 5. Profile Set

- find_definition: Find the definition and immediate symbol context for a name, route, class, function, method, config key, or endpoint.
- trace_impact: Find likely impacted definitions, references, callers, tests, and integration boundaries for a change.
- bug_investigation: Find the smallest useful set of code spans to diagnose a symptom, error, repeated behavior, or failing test.
- implementation_planning: Find modules, contracts, tests, and seams needed to implement a requested behavior.
- test_discovery: Find relevant tests, fixtures, mocks, and test helpers for a target behavior.
- config_lookup: Find settings schema, environment variables, config readers, defaults, and documentation points.
- api_route_lookup: Find HTTP routes, clients, request/response models, and call sites.
- architecture_overview: Return a bounded map of packages, entrypoints, dependency clusters, and representative files.
- memory_contract: Find memory backend interfaces, adapters, store/recall/update/delete/invalidate paths, and tests.
- codebase_contract: Find codebase search/index/read contracts, scope handling, and evidence pipeline code.

## 6. Request Contract

```json
{
  "profile": "bug_investigation",
  "query": "turn repeats after each task completion",
  "scope": {
    "kind": "workspace",
    "cwd": "/Users/steve/amaze_s3/amaze",
    "roots": ["/Users/steve/amaze_s3/amaze"],
    "max_parent_depth": 0
  },
  "budget": {
    "max_primary_points": 8,
    "max_primary_files": 5,
    "max_primary_lines": 240,
    "max_deferred_clusters": 6,
    "max_total_response_chars": 24000
  },
  "constraints": {
    "include_tests": true,
    "prefer_changed_files": true,
    "allow_lexical_fallback": true,
    "allow_llm_summary": false
  }
}
```

## 7. Response Contract

```json
{
  "ok": true,
  "plan_id": "cp_01HROCKY",
  "profile": "bug_investigation",
  "search_scope": {
    "requested_scope": "workspace",
    "effective_roots": ["/Users/steve/amaze_s3/amaze"],
    "searched_roots": ["/Users/steve/amaze_s3/amaze"],
    "excluded_roots": []
  },
  "budget_used": {
    "primary_points": 6,
    "primary_files": 4,
    "primary_lines": 184,
    "response_chars": 18320
  },
  "primary": [
    {
      "point_id": "pt_001",
      "file": "packages/agent/src/agent-loop.ts",
      "start_line": 220,
      "end_line": 252,
      "symbol": "runAgentLoop",
      "snippet": "bounded code snippet",
      "file_revision": "sha256:abc",
      "signals": ["ast_symbol", "graph_entrypoint", "lexical_match"],
      "reason": "main continuation branch",
      "confidence": 0.91
    }
  ],
  "deferred_clusters": [
    {
      "cluster_id": "cluster_subagent_yield",
      "label": "subagent yield lifecycle",
      "manifest": "37 points across 9 files; signals: lsp_reference, ast_grep",
      "top_files": ["packages/coding-agent/src/task/executor.ts"],
      "expandable": true
    }
  ],
  "next": [
    { "action": "expand_cluster", "cluster_id": "cluster_subagent_yield" }
  ],
  "truncated": true
}
```

## 8. Internal Pipeline

1. Request validation
2. Scope resolution
3. Profile selection
4. Budget normalization
5. Collector fanout
6. Candidate normalization
7. Evidence enrichment
8. Deduplication
9. Clustering
10. Diversity ranking
11. Budget cut
12. Snippet extraction
13. Revision hashing
14. Deferred cluster labeling
15. Plan persistence
16. Response shaping
17. Telemetry emission

## 9. Collector Responsibilities

- graph: Use rocky-codebase graph index to find symbols, relationships, routes, and project structure.
- lexical: Use bounded ripgrep-like search as a fallback or exact string signal.
- ast: Use tree-sitter or language parser output to find declarations, imports, exports, method bodies, and symbol spans.
- ast_grep: Use structural patterns for call expressions, route declarations, config access, tool registration, and adapter wiring.
- lsp: Use definitions, references, diagnostics, document symbols, type info, and workspace symbols.
- git: Use changed files, recent commits, branch diff, and ownership hints where available.
- tests: Use test naming, fixtures, mocks, and assertion patterns as a secondary evidence source.
- docs: Use markdown and config docs only as support, not as a substitute for code evidence.

## 10. Evidence Model

```ts
type CodeEvidence = {
  evidenceId: string;
  root: string;
  file: string;
  startLine: number;
  endLine: number;
  symbol?: string;
  relation?: "definition" | "reference" | "caller" | "callee" | "diagnostic" | "pattern_match" | "test" | "config";
  source: "graph" | "lexical" | "ast" | "ast_grep" | "lsp" | "git" | "tests" | "docs";
  score: number;
  confidence: number;
  matchedTerms: string[];
  fileRevision?: string;
  metadata: Record<string, unknown>;
};
```

## 11. Read Point Model

```ts
type ReadPoint = {
  pointId: string;
  file: string;
  startLine: number;
  endLine: number;
  symbol?: string;
  snippet: string;
  fileRevision: string;
  signals: string[];
  reason: string;
  confidence: number;
  clusterId?: string;
};
```

## 12. Plan Store Model

Plan state must stay in Rocky, not in the AI turn context.
- Store plan_id, request hash, profile, scope, budget, created_at, expires_at.
- Store normalized candidates and clusters in SQLite or compact JSONL under Rocky runtime root.
- Store only bounded snippets in API responses.
- Do not return raw candidate arrays by default.
- Expire plans after a configurable TTL, default 2 hours.
- Allow explicit delete for privacy and cleanup.

## 13. Budget Defaults

| Profile | Max Points | Max Files | Max Lines | Max Deferred Clusters | Max Response Chars |
| --- | ---: | ---: | ---: | ---: | ---: |
| find_definition | 4 | 3 | 120 | 4 | 16000 |
| trace_impact | 8 | 6 | 260 | 8 | 24000 |
| bug_investigation | 8 | 5 | 260 | 8 | 24000 |
| implementation_planning | 10 | 7 | 320 | 8 | 28000 |
| test_discovery | 8 | 6 | 240 | 6 | 22000 |
| config_lookup | 6 | 5 | 180 | 5 | 18000 |
| api_route_lookup | 8 | 6 | 240 | 6 | 22000 |
| architecture_overview | 12 | 10 | 360 | 10 | 30000 |

## 14. Deterministic Cluster Labels

- Cluster labels must be generated from common path prefixes, dominant symbols, relation types, and matched query terms.
- Cluster labels must not require an LLM.
- Cluster manifests should mention count, file count, dominant signals, and top files.
- Cluster labels must be short enough for a compact response.
- Optional LLM explanation must be a separate endpoint and must not run by default.

## 15. Profile Algorithms

### 15.1. find_definition
1. Parse query terms.
2. Ask LSP for workspace symbols and definitions.
3. Ask AST index for exact symbol spans.
4. Ask graph index for qualified names.
5. Use lexical fallback for route strings and config keys.
6. Prefer one canonical definition plus immediate adapter or caller if needed.

### 15.2. trace_impact
1. Find seed definitions.
2. Expand LSP references.
3. Expand graph callers and callees.
4. Find tests touching changed symbols.
5. Cluster by call chain and file family.
6. Return diverse representatives across implementation, adapter, and tests.

### 15.3. bug_investigation
1. Search error strings and symptom terms.
2. Find loop, retry, lifecycle, or state machine symbols.
3. Include diagnostics and recent changed files.
4. Cluster by execution path.
5. Return entrypoint, decision branch, state mutation, and test evidence.

### 15.4. implementation_planning
1. Find existing interfaces and adapters.
2. Find request/response models.
3. Find tests and fixtures.
4. Find nearby naming patterns.
5. Return contract files before implementation files when appropriate.

### 15.5. test_discovery
1. Find test files by symbol references.
2. Find fixtures and mocks.
3. Find assertions mentioning behavior.
4. Return tests first, then implementation spans needed to understand setup.

### 15.6. config_lookup
1. Find settings schema keys.
2. Find environment variable references.
3. Find defaults and docs.
4. Return schema, reader, and usage spans.

### 15.7. api_route_lookup
1. Find route declarations.
2. Find request models.
3. Find service methods.
4. Find client call sites.
5. Return route, model, service, and caller spans.

### 15.8. architecture_overview
1. Build package clusters.
2. Find entrypoints.
3. Find dependency boundaries.
4. Return representative files and deterministic manifests, not full summaries.

## 16. Implementation File Map

- /Users/steve/amaze_s3/rocky/rocky/search/profiles.py: Profile enum, defaults, validation, and routing table.
- /Users/steve/amaze_s3/rocky/rocky/search/scope.py: Shared scope resolver if extracted from rocky_codebase.py.
- /Users/steve/amaze_s3/rocky/rocky/search/evidence.py: Evidence, read point, cluster, budget, and plan models.
- /Users/steve/amaze_s3/rocky/rocky/search/collectors/base.py: Collector protocol and common result conversion helpers.
- /Users/steve/amaze_s3/rocky/rocky/search/collectors/graph.py: Adapter around rocky-codebase graph search.
- /Users/steve/amaze_s3/rocky/rocky/search/collectors/lexical.py: Bounded lexical search collector.
- /Users/steve/amaze_s3/rocky/rocky/search/collectors/ast.py: AST symbol collector.
- /Users/steve/amaze_s3/rocky/rocky/search/collectors/ast_grep.py: ast-grep structural pattern collector.
- /Users/steve/amaze_s3/rocky/rocky/search/collectors/lsp.py: LSP collector with timeout and availability fallback.
- /Users/steve/amaze_s3/rocky/rocky/search/ranker.py: Scoring, diversity ranking, and budget cutting.
- /Users/steve/amaze_s3/rocky/rocky/search/cluster.py: Deduplication and clustering logic.
- /Users/steve/amaze_s3/rocky/rocky/search/snippets.py: Bounded snippet extraction and file revision hashing.
- /Users/steve/amaze_s3/rocky/rocky/search/plan_store.py: Plan persistence and TTL cleanup.
- /Users/steve/amaze_s3/rocky/rocky/search/profile_engine.py: End-to-end planner orchestration.
- /Users/steve/amaze_s3/rocky/rocky/core/routes/rocky_native.py: HTTP endpoints for plan, expand, read, validate, profiles, and health.
- /Users/steve/amaze_s3/amaze/packages/coding-agent/src/tools/codebase-profile.ts: Amaze tool wrapper for Rocky profile plan/read/expand.
- /Users/steve/amaze_s3/amaze/packages/coding-agent/src/tools/index.ts: Tool registration changes.
- /Users/steve/amaze_s3/amaze/packages/coding-agent/src/prompts/system/system-prompt.md: Policy update: prefer Rocky profiles over raw search.

## 17. Milestones

- M1: Contract models and tests only.
- M2: Scope-aware profile endpoint returning deterministic stub plans.
- M3: Lexical and graph collectors feeding normalized evidence.
- M4: Snippet extraction, hashing, ranker, and budget enforcement.
- M5: Plan store and expand/read/validate endpoints.
- M6: ast-grep collector.
- M7: AST symbol collector.
- M8: LSP collector with timeout and graceful degradation.
- M9: Amaze tool integration and prompt policy.
- M10: Large repo performance and context budget validation.

## 18. Acceptance Criteria

- A plan response never exceeds max_total_response_chars unless the request explicitly sets a larger budget.
- A plan response never includes raw candidate arrays.
- Every primary point includes snippet and file_revision.
- Every deferred cluster includes label, manifest, count, and expand handle.
- Every profile works when LSP is unavailable.
- Every profile works when ast-grep is unavailable.
- Every endpoint echoes search_scope effective_roots.
- Amaze can complete a code investigation using plan/read/expand without direct rg for the happy path.
- Raw tools remain available as fallback but are not the default exploration path.
- Tests cover budget enforcement, scope enforcement, expansion, and stale file validation.

## 19. TDD Plan

Each task must follow red-green-refactor. Do not implement production code before a failing test exists.

### Task 1: contract
Goal: Define and validate request/response contracts.
Files: see implementation map and create focused modules as needed.
Test first: add a targeted unit or route test that fails without this behavior.
Implementation: make the smallest change that satisfies the test.
Verification: run the targeted test, then the relevant Rocky or Amaze test group.
Commit message suggestion: feat(rocky): define and validate request/response contracts.

### Task 2: scope
Goal: Guarantee effective roots are explicit and echoed.
Files: see implementation map and create focused modules as needed.
Test first: add a targeted unit or route test that fails without this behavior.
Implementation: make the smallest change that satisfies the test.
Verification: run the targeted test, then the relevant Rocky or Amaze test group.
Commit message suggestion: feat(rocky): guarantee effective roots are explicit and echoed.

### Task 3: budget
Goal: Enforce response size and line budgets.
Files: see implementation map and create focused modules as needed.
Test first: add a targeted unit or route test that fails without this behavior.
Implementation: make the smallest change that satisfies the test.
Verification: run the targeted test, then the relevant Rocky or Amaze test group.
Commit message suggestion: feat(rocky): enforce response size and line budgets.

### Task 4: collector_graph
Goal: Collect graph evidence.
Files: see implementation map and create focused modules as needed.
Test first: add a targeted unit or route test that fails without this behavior.
Implementation: make the smallest change that satisfies the test.
Verification: run the targeted test, then the relevant Rocky or Amaze test group.
Commit message suggestion: feat(rocky): collect graph evidence.

### Task 5: collector_lexical
Goal: Collect lexical evidence.
Files: see implementation map and create focused modules as needed.
Test first: add a targeted unit or route test that fails without this behavior.
Implementation: make the smallest change that satisfies the test.
Verification: run the targeted test, then the relevant Rocky or Amaze test group.
Commit message suggestion: feat(rocky): collect lexical evidence.

### Task 6: collector_ast_grep
Goal: Collect structural ast-grep evidence.
Files: see implementation map and create focused modules as needed.
Test first: add a targeted unit or route test that fails without this behavior.
Implementation: make the smallest change that satisfies the test.
Verification: run the targeted test, then the relevant Rocky or Amaze test group.
Commit message suggestion: feat(rocky): collect structural ast-grep evidence.

### Task 7: collector_ast
Goal: Collect AST symbol evidence.
Files: see implementation map and create focused modules as needed.
Test first: add a targeted unit or route test that fails without this behavior.
Implementation: make the smallest change that satisfies the test.
Verification: run the targeted test, then the relevant Rocky or Amaze test group.
Commit message suggestion: feat(rocky): collect ast symbol evidence.

### Task 8: collector_lsp
Goal: Collect LSP definition/reference evidence.
Files: see implementation map and create focused modules as needed.
Test first: add a targeted unit or route test that fails without this behavior.
Implementation: make the smallest change that satisfies the test.
Verification: run the targeted test, then the relevant Rocky or Amaze test group.
Commit message suggestion: feat(rocky): collect lsp definition/reference evidence.

### Task 9: normalize
Goal: Normalize all collector outputs into CodeEvidence.
Files: see implementation map and create focused modules as needed.
Test first: add a targeted unit or route test that fails without this behavior.
Implementation: make the smallest change that satisfies the test.
Verification: run the targeted test, then the relevant Rocky or Amaze test group.
Commit message suggestion: feat(rocky): normalize all collector outputs into codeevidence.

### Task 10: dedup
Goal: Deduplicate overlapping evidence.
Files: see implementation map and create focused modules as needed.
Test first: add a targeted unit or route test that fails without this behavior.
Implementation: make the smallest change that satisfies the test.
Verification: run the targeted test, then the relevant Rocky or Amaze test group.
Commit message suggestion: feat(rocky): deduplicate overlapping evidence.

### Task 11: cluster
Goal: Cluster evidence deterministically.
Files: see implementation map and create focused modules as needed.
Test first: add a targeted unit or route test that fails without this behavior.
Implementation: make the smallest change that satisfies the test.
Verification: run the targeted test, then the relevant Rocky or Amaze test group.
Commit message suggestion: feat(rocky): cluster evidence deterministically.

### Task 12: rank
Goal: Rank with diversity and profile-specific boosts.
Files: see implementation map and create focused modules as needed.
Test first: add a targeted unit or route test that fails without this behavior.
Implementation: make the smallest change that satisfies the test.
Verification: run the targeted test, then the relevant Rocky or Amaze test group.
Commit message suggestion: feat(rocky): rank with diversity and profile-specific boosts.

### Task 13: snippet
Goal: Extract bounded snippets.
Files: see implementation map and create focused modules as needed.
Test first: add a targeted unit or route test that fails without this behavior.
Implementation: make the smallest change that satisfies the test.
Verification: run the targeted test, then the relevant Rocky or Amaze test group.
Commit message suggestion: feat(rocky): extract bounded snippets.

### Task 14: hash
Goal: Compute file revision tokens.
Files: see implementation map and create focused modules as needed.
Test first: add a targeted unit or route test that fails without this behavior.
Implementation: make the smallest change that satisfies the test.
Verification: run the targeted test, then the relevant Rocky or Amaze test group.
Commit message suggestion: feat(rocky): compute file revision tokens.

### Task 15: plan_store
Goal: Persist plan state.
Files: see implementation map and create focused modules as needed.
Test first: add a targeted unit or route test that fails without this behavior.
Implementation: make the smallest change that satisfies the test.
Verification: run the targeted test, then the relevant Rocky or Amaze test group.
Commit message suggestion: feat(rocky): persist plan state.

### Task 16: expand
Goal: Expand deferred clusters.
Files: see implementation map and create focused modules as needed.
Test first: add a targeted unit or route test that fails without this behavior.
Implementation: make the smallest change that satisfies the test.
Verification: run the targeted test, then the relevant Rocky or Amaze test group.
Commit message suggestion: feat(rocky): expand deferred clusters.

### Task 17: read
Goal: Read by point id.
Files: see implementation map and create focused modules as needed.
Test first: add a targeted unit or route test that fails without this behavior.
Implementation: make the smallest change that satisfies the test.
Verification: run the targeted test, then the relevant Rocky or Amaze test group.
Commit message suggestion: feat(rocky): read by point id.

### Task 18: validate
Goal: Validate point freshness.
Files: see implementation map and create focused modules as needed.
Test first: add a targeted unit or route test that fails without this behavior.
Implementation: make the smallest change that satisfies the test.
Verification: run the targeted test, then the relevant Rocky or Amaze test group.
Commit message suggestion: feat(rocky): validate point freshness.

### Task 19: amaze_tool
Goal: Expose profile tool in Amaze.
Files: see implementation map and create focused modules as needed.
Test first: add a targeted unit or route test that fails without this behavior.
Implementation: make the smallest change that satisfies the test.
Verification: run the targeted test, then the relevant Rocky or Amaze test group.
Commit message suggestion: feat(rocky): expose profile tool in amaze.

### Task 20: prompt_policy
Goal: Prefer Rocky profiles in system prompt.
Files: see implementation map and create focused modules as needed.
Test first: add a targeted unit or route test that fails without this behavior.
Implementation: make the smallest change that satisfies the test.
Verification: run the targeted test, then the relevant Rocky or Amaze test group.
Commit message suggestion: feat(rocky): prefer rocky profiles in system prompt.

### Task 21: telemetry
Goal: Track budget and collector stats.
Files: see implementation map and create focused modules as needed.
Test first: add a targeted unit or route test that fails without this behavior.
Implementation: make the smallest change that satisfies the test.
Verification: run the targeted test, then the relevant Rocky or Amaze test group.
Commit message suggestion: feat(rocky): track budget and collector stats.

### Task 22: health
Goal: Expose collector availability.
Files: see implementation map and create focused modules as needed.
Test first: add a targeted unit or route test that fails without this behavior.
Implementation: make the smallest change that satisfies the test.
Verification: run the targeted test, then the relevant Rocky or Amaze test group.
Commit message suggestion: feat(rocky): expose collector availability.

### Task 23: performance
Goal: Verify large repo constraints.
Files: see implementation map and create focused modules as needed.
Test first: add a targeted unit or route test that fails without this behavior.
Implementation: make the smallest change that satisfies the test.
Verification: run the targeted test, then the relevant Rocky or Amaze test group.
Commit message suggestion: feat(rocky): verify large repo constraints.

### Task 24: migration
Goal: Keep search_graph/search_code compatibility.
Files: see implementation map and create focused modules as needed.
Test first: add a targeted unit or route test that fails without this behavior.
Implementation: make the smallest change that satisfies the test.
Verification: run the targeted test, then the relevant Rocky or Amaze test group.
Commit message suggestion: feat(rocky): keep search_graph/search_code compatibility.

## 20. Detailed Execution Checklist

The following checklist is intentionally long. It is designed for goal-mode execution where an agent can progress line by line and avoid skipping contracts.

### Phase 1: Repository audit
- [ ] Repository audit step 01: perform the next smallest verifiable action for Repository audit; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Repository audit step 02: perform the next smallest verifiable action for Repository audit; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Repository audit step 03: perform the next smallest verifiable action for Repository audit; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Repository audit step 04: perform the next smallest verifiable action for Repository audit; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Repository audit step 05: perform the next smallest verifiable action for Repository audit; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Repository audit step 06: perform the next smallest verifiable action for Repository audit; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Repository audit step 07: perform the next smallest verifiable action for Repository audit; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Repository audit step 08: perform the next smallest verifiable action for Repository audit; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Repository audit step 09: perform the next smallest verifiable action for Repository audit; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Repository audit step 10: perform the next smallest verifiable action for Repository audit; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Repository audit step 11: perform the next smallest verifiable action for Repository audit; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Repository audit step 12: perform the next smallest verifiable action for Repository audit; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Repository audit step 13: perform the next smallest verifiable action for Repository audit; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Repository audit step 14: perform the next smallest verifiable action for Repository audit; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Repository audit step 15: perform the next smallest verifiable action for Repository audit; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Repository audit step 16: perform the next smallest verifiable action for Repository audit; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Repository audit step 17: perform the next smallest verifiable action for Repository audit; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Repository audit step 18: perform the next smallest verifiable action for Repository audit; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Repository audit step 19: perform the next smallest verifiable action for Repository audit; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Repository audit step 20: perform the next smallest verifiable action for Repository audit; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Repository audit step 21: perform the next smallest verifiable action for Repository audit; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Repository audit step 22: perform the next smallest verifiable action for Repository audit; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Repository audit step 23: perform the next smallest verifiable action for Repository audit; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Repository audit step 24: perform the next smallest verifiable action for Repository audit; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Repository audit step 25: perform the next smallest verifiable action for Repository audit; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Repository audit step 26: perform the next smallest verifiable action for Repository audit; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Repository audit step 27: perform the next smallest verifiable action for Repository audit; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Repository audit step 28: perform the next smallest verifiable action for Repository audit; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Repository audit step 29: perform the next smallest verifiable action for Repository audit; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Repository audit step 30: perform the next smallest verifiable action for Repository audit; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Repository audit step 31: perform the next smallest verifiable action for Repository audit; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Repository audit step 32: perform the next smallest verifiable action for Repository audit; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Repository audit step 33: perform the next smallest verifiable action for Repository audit; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Repository audit step 34: perform the next smallest verifiable action for Repository audit; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Repository audit step 35: perform the next smallest verifiable action for Repository audit; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.

### Phase 2: Contract model creation
- [ ] Contract model creation step 01: perform the next smallest verifiable action for Contract model creation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Contract model creation step 02: perform the next smallest verifiable action for Contract model creation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Contract model creation step 03: perform the next smallest verifiable action for Contract model creation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Contract model creation step 04: perform the next smallest verifiable action for Contract model creation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Contract model creation step 05: perform the next smallest verifiable action for Contract model creation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Contract model creation step 06: perform the next smallest verifiable action for Contract model creation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Contract model creation step 07: perform the next smallest verifiable action for Contract model creation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Contract model creation step 08: perform the next smallest verifiable action for Contract model creation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Contract model creation step 09: perform the next smallest verifiable action for Contract model creation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Contract model creation step 10: perform the next smallest verifiable action for Contract model creation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Contract model creation step 11: perform the next smallest verifiable action for Contract model creation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Contract model creation step 12: perform the next smallest verifiable action for Contract model creation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Contract model creation step 13: perform the next smallest verifiable action for Contract model creation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Contract model creation step 14: perform the next smallest verifiable action for Contract model creation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Contract model creation step 15: perform the next smallest verifiable action for Contract model creation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Contract model creation step 16: perform the next smallest verifiable action for Contract model creation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Contract model creation step 17: perform the next smallest verifiable action for Contract model creation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Contract model creation step 18: perform the next smallest verifiable action for Contract model creation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Contract model creation step 19: perform the next smallest verifiable action for Contract model creation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Contract model creation step 20: perform the next smallest verifiable action for Contract model creation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Contract model creation step 21: perform the next smallest verifiable action for Contract model creation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Contract model creation step 22: perform the next smallest verifiable action for Contract model creation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Contract model creation step 23: perform the next smallest verifiable action for Contract model creation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Contract model creation step 24: perform the next smallest verifiable action for Contract model creation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Contract model creation step 25: perform the next smallest verifiable action for Contract model creation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Contract model creation step 26: perform the next smallest verifiable action for Contract model creation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Contract model creation step 27: perform the next smallest verifiable action for Contract model creation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Contract model creation step 28: perform the next smallest verifiable action for Contract model creation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Contract model creation step 29: perform the next smallest verifiable action for Contract model creation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Contract model creation step 30: perform the next smallest verifiable action for Contract model creation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Contract model creation step 31: perform the next smallest verifiable action for Contract model creation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Contract model creation step 32: perform the next smallest verifiable action for Contract model creation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Contract model creation step 33: perform the next smallest verifiable action for Contract model creation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Contract model creation step 34: perform the next smallest verifiable action for Contract model creation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Contract model creation step 35: perform the next smallest verifiable action for Contract model creation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.

### Phase 3: Scope enforcement
- [ ] Scope enforcement step 01: perform the next smallest verifiable action for Scope enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Scope enforcement step 02: perform the next smallest verifiable action for Scope enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Scope enforcement step 03: perform the next smallest verifiable action for Scope enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Scope enforcement step 04: perform the next smallest verifiable action for Scope enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Scope enforcement step 05: perform the next smallest verifiable action for Scope enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Scope enforcement step 06: perform the next smallest verifiable action for Scope enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Scope enforcement step 07: perform the next smallest verifiable action for Scope enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Scope enforcement step 08: perform the next smallest verifiable action for Scope enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Scope enforcement step 09: perform the next smallest verifiable action for Scope enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Scope enforcement step 10: perform the next smallest verifiable action for Scope enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Scope enforcement step 11: perform the next smallest verifiable action for Scope enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Scope enforcement step 12: perform the next smallest verifiable action for Scope enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Scope enforcement step 13: perform the next smallest verifiable action for Scope enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Scope enforcement step 14: perform the next smallest verifiable action for Scope enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Scope enforcement step 15: perform the next smallest verifiable action for Scope enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Scope enforcement step 16: perform the next smallest verifiable action for Scope enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Scope enforcement step 17: perform the next smallest verifiable action for Scope enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Scope enforcement step 18: perform the next smallest verifiable action for Scope enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Scope enforcement step 19: perform the next smallest verifiable action for Scope enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Scope enforcement step 20: perform the next smallest verifiable action for Scope enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Scope enforcement step 21: perform the next smallest verifiable action for Scope enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Scope enforcement step 22: perform the next smallest verifiable action for Scope enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Scope enforcement step 23: perform the next smallest verifiable action for Scope enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Scope enforcement step 24: perform the next smallest verifiable action for Scope enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Scope enforcement step 25: perform the next smallest verifiable action for Scope enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Scope enforcement step 26: perform the next smallest verifiable action for Scope enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Scope enforcement step 27: perform the next smallest verifiable action for Scope enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Scope enforcement step 28: perform the next smallest verifiable action for Scope enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Scope enforcement step 29: perform the next smallest verifiable action for Scope enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Scope enforcement step 30: perform the next smallest verifiable action for Scope enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Scope enforcement step 31: perform the next smallest verifiable action for Scope enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Scope enforcement step 32: perform the next smallest verifiable action for Scope enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Scope enforcement step 33: perform the next smallest verifiable action for Scope enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Scope enforcement step 34: perform the next smallest verifiable action for Scope enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Scope enforcement step 35: perform the next smallest verifiable action for Scope enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.

### Phase 4: Budget enforcement
- [ ] Budget enforcement step 01: perform the next smallest verifiable action for Budget enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Budget enforcement step 02: perform the next smallest verifiable action for Budget enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Budget enforcement step 03: perform the next smallest verifiable action for Budget enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Budget enforcement step 04: perform the next smallest verifiable action for Budget enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Budget enforcement step 05: perform the next smallest verifiable action for Budget enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Budget enforcement step 06: perform the next smallest verifiable action for Budget enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Budget enforcement step 07: perform the next smallest verifiable action for Budget enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Budget enforcement step 08: perform the next smallest verifiable action for Budget enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Budget enforcement step 09: perform the next smallest verifiable action for Budget enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Budget enforcement step 10: perform the next smallest verifiable action for Budget enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Budget enforcement step 11: perform the next smallest verifiable action for Budget enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Budget enforcement step 12: perform the next smallest verifiable action for Budget enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Budget enforcement step 13: perform the next smallest verifiable action for Budget enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Budget enforcement step 14: perform the next smallest verifiable action for Budget enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Budget enforcement step 15: perform the next smallest verifiable action for Budget enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Budget enforcement step 16: perform the next smallest verifiable action for Budget enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Budget enforcement step 17: perform the next smallest verifiable action for Budget enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Budget enforcement step 18: perform the next smallest verifiable action for Budget enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Budget enforcement step 19: perform the next smallest verifiable action for Budget enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Budget enforcement step 20: perform the next smallest verifiable action for Budget enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Budget enforcement step 21: perform the next smallest verifiable action for Budget enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Budget enforcement step 22: perform the next smallest verifiable action for Budget enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Budget enforcement step 23: perform the next smallest verifiable action for Budget enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Budget enforcement step 24: perform the next smallest verifiable action for Budget enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Budget enforcement step 25: perform the next smallest verifiable action for Budget enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Budget enforcement step 26: perform the next smallest verifiable action for Budget enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Budget enforcement step 27: perform the next smallest verifiable action for Budget enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Budget enforcement step 28: perform the next smallest verifiable action for Budget enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Budget enforcement step 29: perform the next smallest verifiable action for Budget enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Budget enforcement step 30: perform the next smallest verifiable action for Budget enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Budget enforcement step 31: perform the next smallest verifiable action for Budget enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Budget enforcement step 32: perform the next smallest verifiable action for Budget enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Budget enforcement step 33: perform the next smallest verifiable action for Budget enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Budget enforcement step 34: perform the next smallest verifiable action for Budget enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Budget enforcement step 35: perform the next smallest verifiable action for Budget enforcement; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.

### Phase 5: Collector base implementation
- [ ] Collector base implementation step 01: perform the next smallest verifiable action for Collector base implementation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Collector base implementation step 02: perform the next smallest verifiable action for Collector base implementation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Collector base implementation step 03: perform the next smallest verifiable action for Collector base implementation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Collector base implementation step 04: perform the next smallest verifiable action for Collector base implementation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Collector base implementation step 05: perform the next smallest verifiable action for Collector base implementation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Collector base implementation step 06: perform the next smallest verifiable action for Collector base implementation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Collector base implementation step 07: perform the next smallest verifiable action for Collector base implementation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Collector base implementation step 08: perform the next smallest verifiable action for Collector base implementation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Collector base implementation step 09: perform the next smallest verifiable action for Collector base implementation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Collector base implementation step 10: perform the next smallest verifiable action for Collector base implementation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Collector base implementation step 11: perform the next smallest verifiable action for Collector base implementation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Collector base implementation step 12: perform the next smallest verifiable action for Collector base implementation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Collector base implementation step 13: perform the next smallest verifiable action for Collector base implementation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Collector base implementation step 14: perform the next smallest verifiable action for Collector base implementation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Collector base implementation step 15: perform the next smallest verifiable action for Collector base implementation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Collector base implementation step 16: perform the next smallest verifiable action for Collector base implementation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Collector base implementation step 17: perform the next smallest verifiable action for Collector base implementation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Collector base implementation step 18: perform the next smallest verifiable action for Collector base implementation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Collector base implementation step 19: perform the next smallest verifiable action for Collector base implementation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Collector base implementation step 20: perform the next smallest verifiable action for Collector base implementation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Collector base implementation step 21: perform the next smallest verifiable action for Collector base implementation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Collector base implementation step 22: perform the next smallest verifiable action for Collector base implementation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Collector base implementation step 23: perform the next smallest verifiable action for Collector base implementation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Collector base implementation step 24: perform the next smallest verifiable action for Collector base implementation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Collector base implementation step 25: perform the next smallest verifiable action for Collector base implementation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Collector base implementation step 26: perform the next smallest verifiable action for Collector base implementation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Collector base implementation step 27: perform the next smallest verifiable action for Collector base implementation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Collector base implementation step 28: perform the next smallest verifiable action for Collector base implementation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Collector base implementation step 29: perform the next smallest verifiable action for Collector base implementation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Collector base implementation step 30: perform the next smallest verifiable action for Collector base implementation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Collector base implementation step 31: perform the next smallest verifiable action for Collector base implementation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Collector base implementation step 32: perform the next smallest verifiable action for Collector base implementation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Collector base implementation step 33: perform the next smallest verifiable action for Collector base implementation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Collector base implementation step 34: perform the next smallest verifiable action for Collector base implementation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Collector base implementation step 35: perform the next smallest verifiable action for Collector base implementation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.

### Phase 6: Graph collector
- [ ] Graph collector step 01: perform the next smallest verifiable action for Graph collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Graph collector step 02: perform the next smallest verifiable action for Graph collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Graph collector step 03: perform the next smallest verifiable action for Graph collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Graph collector step 04: perform the next smallest verifiable action for Graph collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Graph collector step 05: perform the next smallest verifiable action for Graph collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Graph collector step 06: perform the next smallest verifiable action for Graph collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Graph collector step 07: perform the next smallest verifiable action for Graph collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Graph collector step 08: perform the next smallest verifiable action for Graph collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Graph collector step 09: perform the next smallest verifiable action for Graph collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Graph collector step 10: perform the next smallest verifiable action for Graph collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Graph collector step 11: perform the next smallest verifiable action for Graph collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Graph collector step 12: perform the next smallest verifiable action for Graph collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Graph collector step 13: perform the next smallest verifiable action for Graph collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Graph collector step 14: perform the next smallest verifiable action for Graph collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Graph collector step 15: perform the next smallest verifiable action for Graph collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Graph collector step 16: perform the next smallest verifiable action for Graph collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Graph collector step 17: perform the next smallest verifiable action for Graph collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Graph collector step 18: perform the next smallest verifiable action for Graph collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Graph collector step 19: perform the next smallest verifiable action for Graph collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Graph collector step 20: perform the next smallest verifiable action for Graph collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Graph collector step 21: perform the next smallest verifiable action for Graph collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Graph collector step 22: perform the next smallest verifiable action for Graph collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Graph collector step 23: perform the next smallest verifiable action for Graph collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Graph collector step 24: perform the next smallest verifiable action for Graph collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Graph collector step 25: perform the next smallest verifiable action for Graph collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Graph collector step 26: perform the next smallest verifiable action for Graph collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Graph collector step 27: perform the next smallest verifiable action for Graph collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Graph collector step 28: perform the next smallest verifiable action for Graph collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Graph collector step 29: perform the next smallest verifiable action for Graph collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Graph collector step 30: perform the next smallest verifiable action for Graph collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Graph collector step 31: perform the next smallest verifiable action for Graph collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Graph collector step 32: perform the next smallest verifiable action for Graph collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Graph collector step 33: perform the next smallest verifiable action for Graph collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Graph collector step 34: perform the next smallest verifiable action for Graph collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Graph collector step 35: perform the next smallest verifiable action for Graph collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.

### Phase 7: Lexical collector
- [ ] Lexical collector step 01: perform the next smallest verifiable action for Lexical collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Lexical collector step 02: perform the next smallest verifiable action for Lexical collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Lexical collector step 03: perform the next smallest verifiable action for Lexical collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Lexical collector step 04: perform the next smallest verifiable action for Lexical collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Lexical collector step 05: perform the next smallest verifiable action for Lexical collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Lexical collector step 06: perform the next smallest verifiable action for Lexical collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Lexical collector step 07: perform the next smallest verifiable action for Lexical collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Lexical collector step 08: perform the next smallest verifiable action for Lexical collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Lexical collector step 09: perform the next smallest verifiable action for Lexical collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Lexical collector step 10: perform the next smallest verifiable action for Lexical collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Lexical collector step 11: perform the next smallest verifiable action for Lexical collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Lexical collector step 12: perform the next smallest verifiable action for Lexical collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Lexical collector step 13: perform the next smallest verifiable action for Lexical collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Lexical collector step 14: perform the next smallest verifiable action for Lexical collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Lexical collector step 15: perform the next smallest verifiable action for Lexical collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Lexical collector step 16: perform the next smallest verifiable action for Lexical collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Lexical collector step 17: perform the next smallest verifiable action for Lexical collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Lexical collector step 18: perform the next smallest verifiable action for Lexical collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Lexical collector step 19: perform the next smallest verifiable action for Lexical collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Lexical collector step 20: perform the next smallest verifiable action for Lexical collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Lexical collector step 21: perform the next smallest verifiable action for Lexical collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Lexical collector step 22: perform the next smallest verifiable action for Lexical collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Lexical collector step 23: perform the next smallest verifiable action for Lexical collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Lexical collector step 24: perform the next smallest verifiable action for Lexical collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Lexical collector step 25: perform the next smallest verifiable action for Lexical collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Lexical collector step 26: perform the next smallest verifiable action for Lexical collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Lexical collector step 27: perform the next smallest verifiable action for Lexical collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Lexical collector step 28: perform the next smallest verifiable action for Lexical collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Lexical collector step 29: perform the next smallest verifiable action for Lexical collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Lexical collector step 30: perform the next smallest verifiable action for Lexical collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Lexical collector step 31: perform the next smallest verifiable action for Lexical collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Lexical collector step 32: perform the next smallest verifiable action for Lexical collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Lexical collector step 33: perform the next smallest verifiable action for Lexical collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Lexical collector step 34: perform the next smallest verifiable action for Lexical collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Lexical collector step 35: perform the next smallest verifiable action for Lexical collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.

### Phase 8: AST grep collector
- [ ] AST grep collector step 01: perform the next smallest verifiable action for AST grep collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST grep collector step 02: perform the next smallest verifiable action for AST grep collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST grep collector step 03: perform the next smallest verifiable action for AST grep collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST grep collector step 04: perform the next smallest verifiable action for AST grep collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST grep collector step 05: perform the next smallest verifiable action for AST grep collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST grep collector step 06: perform the next smallest verifiable action for AST grep collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST grep collector step 07: perform the next smallest verifiable action for AST grep collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST grep collector step 08: perform the next smallest verifiable action for AST grep collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST grep collector step 09: perform the next smallest verifiable action for AST grep collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST grep collector step 10: perform the next smallest verifiable action for AST grep collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST grep collector step 11: perform the next smallest verifiable action for AST grep collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST grep collector step 12: perform the next smallest verifiable action for AST grep collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST grep collector step 13: perform the next smallest verifiable action for AST grep collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST grep collector step 14: perform the next smallest verifiable action for AST grep collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST grep collector step 15: perform the next smallest verifiable action for AST grep collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST grep collector step 16: perform the next smallest verifiable action for AST grep collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST grep collector step 17: perform the next smallest verifiable action for AST grep collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST grep collector step 18: perform the next smallest verifiable action for AST grep collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST grep collector step 19: perform the next smallest verifiable action for AST grep collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST grep collector step 20: perform the next smallest verifiable action for AST grep collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST grep collector step 21: perform the next smallest verifiable action for AST grep collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST grep collector step 22: perform the next smallest verifiable action for AST grep collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST grep collector step 23: perform the next smallest verifiable action for AST grep collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST grep collector step 24: perform the next smallest verifiable action for AST grep collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST grep collector step 25: perform the next smallest verifiable action for AST grep collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST grep collector step 26: perform the next smallest verifiable action for AST grep collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST grep collector step 27: perform the next smallest verifiable action for AST grep collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST grep collector step 28: perform the next smallest verifiable action for AST grep collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST grep collector step 29: perform the next smallest verifiable action for AST grep collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST grep collector step 30: perform the next smallest verifiable action for AST grep collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST grep collector step 31: perform the next smallest verifiable action for AST grep collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST grep collector step 32: perform the next smallest verifiable action for AST grep collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST grep collector step 33: perform the next smallest verifiable action for AST grep collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST grep collector step 34: perform the next smallest verifiable action for AST grep collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST grep collector step 35: perform the next smallest verifiable action for AST grep collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.

### Phase 9: AST collector
- [ ] AST collector step 01: perform the next smallest verifiable action for AST collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST collector step 02: perform the next smallest verifiable action for AST collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST collector step 03: perform the next smallest verifiable action for AST collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST collector step 04: perform the next smallest verifiable action for AST collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST collector step 05: perform the next smallest verifiable action for AST collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST collector step 06: perform the next smallest verifiable action for AST collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST collector step 07: perform the next smallest verifiable action for AST collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST collector step 08: perform the next smallest verifiable action for AST collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST collector step 09: perform the next smallest verifiable action for AST collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST collector step 10: perform the next smallest verifiable action for AST collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST collector step 11: perform the next smallest verifiable action for AST collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST collector step 12: perform the next smallest verifiable action for AST collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST collector step 13: perform the next smallest verifiable action for AST collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST collector step 14: perform the next smallest verifiable action for AST collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST collector step 15: perform the next smallest verifiable action for AST collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST collector step 16: perform the next smallest verifiable action for AST collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST collector step 17: perform the next smallest verifiable action for AST collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST collector step 18: perform the next smallest verifiable action for AST collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST collector step 19: perform the next smallest verifiable action for AST collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST collector step 20: perform the next smallest verifiable action for AST collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST collector step 21: perform the next smallest verifiable action for AST collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST collector step 22: perform the next smallest verifiable action for AST collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST collector step 23: perform the next smallest verifiable action for AST collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST collector step 24: perform the next smallest verifiable action for AST collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST collector step 25: perform the next smallest verifiable action for AST collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST collector step 26: perform the next smallest verifiable action for AST collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST collector step 27: perform the next smallest verifiable action for AST collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST collector step 28: perform the next smallest verifiable action for AST collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST collector step 29: perform the next smallest verifiable action for AST collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST collector step 30: perform the next smallest verifiable action for AST collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST collector step 31: perform the next smallest verifiable action for AST collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST collector step 32: perform the next smallest verifiable action for AST collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST collector step 33: perform the next smallest verifiable action for AST collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST collector step 34: perform the next smallest verifiable action for AST collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] AST collector step 35: perform the next smallest verifiable action for AST collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.

### Phase 10: LSP collector
- [ ] LSP collector step 01: perform the next smallest verifiable action for LSP collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] LSP collector step 02: perform the next smallest verifiable action for LSP collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] LSP collector step 03: perform the next smallest verifiable action for LSP collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] LSP collector step 04: perform the next smallest verifiable action for LSP collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] LSP collector step 05: perform the next smallest verifiable action for LSP collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] LSP collector step 06: perform the next smallest verifiable action for LSP collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] LSP collector step 07: perform the next smallest verifiable action for LSP collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] LSP collector step 08: perform the next smallest verifiable action for LSP collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] LSP collector step 09: perform the next smallest verifiable action for LSP collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] LSP collector step 10: perform the next smallest verifiable action for LSP collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] LSP collector step 11: perform the next smallest verifiable action for LSP collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] LSP collector step 12: perform the next smallest verifiable action for LSP collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] LSP collector step 13: perform the next smallest verifiable action for LSP collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] LSP collector step 14: perform the next smallest verifiable action for LSP collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] LSP collector step 15: perform the next smallest verifiable action for LSP collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] LSP collector step 16: perform the next smallest verifiable action for LSP collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] LSP collector step 17: perform the next smallest verifiable action for LSP collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] LSP collector step 18: perform the next smallest verifiable action for LSP collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] LSP collector step 19: perform the next smallest verifiable action for LSP collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] LSP collector step 20: perform the next smallest verifiable action for LSP collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] LSP collector step 21: perform the next smallest verifiable action for LSP collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] LSP collector step 22: perform the next smallest verifiable action for LSP collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] LSP collector step 23: perform the next smallest verifiable action for LSP collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] LSP collector step 24: perform the next smallest verifiable action for LSP collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] LSP collector step 25: perform the next smallest verifiable action for LSP collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] LSP collector step 26: perform the next smallest verifiable action for LSP collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] LSP collector step 27: perform the next smallest verifiable action for LSP collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] LSP collector step 28: perform the next smallest verifiable action for LSP collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] LSP collector step 29: perform the next smallest verifiable action for LSP collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] LSP collector step 30: perform the next smallest verifiable action for LSP collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] LSP collector step 31: perform the next smallest verifiable action for LSP collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] LSP collector step 32: perform the next smallest verifiable action for LSP collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] LSP collector step 33: perform the next smallest verifiable action for LSP collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] LSP collector step 34: perform the next smallest verifiable action for LSP collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] LSP collector step 35: perform the next smallest verifiable action for LSP collector; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.

### Phase 11: Evidence normalization
- [ ] Evidence normalization step 01: perform the next smallest verifiable action for Evidence normalization; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Evidence normalization step 02: perform the next smallest verifiable action for Evidence normalization; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Evidence normalization step 03: perform the next smallest verifiable action for Evidence normalization; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Evidence normalization step 04: perform the next smallest verifiable action for Evidence normalization; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Evidence normalization step 05: perform the next smallest verifiable action for Evidence normalization; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Evidence normalization step 06: perform the next smallest verifiable action for Evidence normalization; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Evidence normalization step 07: perform the next smallest verifiable action for Evidence normalization; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Evidence normalization step 08: perform the next smallest verifiable action for Evidence normalization; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Evidence normalization step 09: perform the next smallest verifiable action for Evidence normalization; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Evidence normalization step 10: perform the next smallest verifiable action for Evidence normalization; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Evidence normalization step 11: perform the next smallest verifiable action for Evidence normalization; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Evidence normalization step 12: perform the next smallest verifiable action for Evidence normalization; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Evidence normalization step 13: perform the next smallest verifiable action for Evidence normalization; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Evidence normalization step 14: perform the next smallest verifiable action for Evidence normalization; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Evidence normalization step 15: perform the next smallest verifiable action for Evidence normalization; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Evidence normalization step 16: perform the next smallest verifiable action for Evidence normalization; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Evidence normalization step 17: perform the next smallest verifiable action for Evidence normalization; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Evidence normalization step 18: perform the next smallest verifiable action for Evidence normalization; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Evidence normalization step 19: perform the next smallest verifiable action for Evidence normalization; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Evidence normalization step 20: perform the next smallest verifiable action for Evidence normalization; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Evidence normalization step 21: perform the next smallest verifiable action for Evidence normalization; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Evidence normalization step 22: perform the next smallest verifiable action for Evidence normalization; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Evidence normalization step 23: perform the next smallest verifiable action for Evidence normalization; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Evidence normalization step 24: perform the next smallest verifiable action for Evidence normalization; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Evidence normalization step 25: perform the next smallest verifiable action for Evidence normalization; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Evidence normalization step 26: perform the next smallest verifiable action for Evidence normalization; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Evidence normalization step 27: perform the next smallest verifiable action for Evidence normalization; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Evidence normalization step 28: perform the next smallest verifiable action for Evidence normalization; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Evidence normalization step 29: perform the next smallest verifiable action for Evidence normalization; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Evidence normalization step 30: perform the next smallest verifiable action for Evidence normalization; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Evidence normalization step 31: perform the next smallest verifiable action for Evidence normalization; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Evidence normalization step 32: perform the next smallest verifiable action for Evidence normalization; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Evidence normalization step 33: perform the next smallest verifiable action for Evidence normalization; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Evidence normalization step 34: perform the next smallest verifiable action for Evidence normalization; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Evidence normalization step 35: perform the next smallest verifiable action for Evidence normalization; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.

### Phase 12: Deduplication
- [ ] Deduplication step 01: perform the next smallest verifiable action for Deduplication; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Deduplication step 02: perform the next smallest verifiable action for Deduplication; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Deduplication step 03: perform the next smallest verifiable action for Deduplication; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Deduplication step 04: perform the next smallest verifiable action for Deduplication; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Deduplication step 05: perform the next smallest verifiable action for Deduplication; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Deduplication step 06: perform the next smallest verifiable action for Deduplication; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Deduplication step 07: perform the next smallest verifiable action for Deduplication; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Deduplication step 08: perform the next smallest verifiable action for Deduplication; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Deduplication step 09: perform the next smallest verifiable action for Deduplication; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Deduplication step 10: perform the next smallest verifiable action for Deduplication; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Deduplication step 11: perform the next smallest verifiable action for Deduplication; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Deduplication step 12: perform the next smallest verifiable action for Deduplication; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Deduplication step 13: perform the next smallest verifiable action for Deduplication; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Deduplication step 14: perform the next smallest verifiable action for Deduplication; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Deduplication step 15: perform the next smallest verifiable action for Deduplication; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Deduplication step 16: perform the next smallest verifiable action for Deduplication; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Deduplication step 17: perform the next smallest verifiable action for Deduplication; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Deduplication step 18: perform the next smallest verifiable action for Deduplication; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Deduplication step 19: perform the next smallest verifiable action for Deduplication; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Deduplication step 20: perform the next smallest verifiable action for Deduplication; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Deduplication step 21: perform the next smallest verifiable action for Deduplication; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Deduplication step 22: perform the next smallest verifiable action for Deduplication; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Deduplication step 23: perform the next smallest verifiable action for Deduplication; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Deduplication step 24: perform the next smallest verifiable action for Deduplication; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Deduplication step 25: perform the next smallest verifiable action for Deduplication; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Deduplication step 26: perform the next smallest verifiable action for Deduplication; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Deduplication step 27: perform the next smallest verifiable action for Deduplication; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Deduplication step 28: perform the next smallest verifiable action for Deduplication; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Deduplication step 29: perform the next smallest verifiable action for Deduplication; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Deduplication step 30: perform the next smallest verifiable action for Deduplication; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Deduplication step 31: perform the next smallest verifiable action for Deduplication; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Deduplication step 32: perform the next smallest verifiable action for Deduplication; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Deduplication step 33: perform the next smallest verifiable action for Deduplication; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Deduplication step 34: perform the next smallest verifiable action for Deduplication; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Deduplication step 35: perform the next smallest verifiable action for Deduplication; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.

### Phase 13: Clustering
- [ ] Clustering step 01: perform the next smallest verifiable action for Clustering; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Clustering step 02: perform the next smallest verifiable action for Clustering; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Clustering step 03: perform the next smallest verifiable action for Clustering; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Clustering step 04: perform the next smallest verifiable action for Clustering; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Clustering step 05: perform the next smallest verifiable action for Clustering; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Clustering step 06: perform the next smallest verifiable action for Clustering; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Clustering step 07: perform the next smallest verifiable action for Clustering; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Clustering step 08: perform the next smallest verifiable action for Clustering; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Clustering step 09: perform the next smallest verifiable action for Clustering; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Clustering step 10: perform the next smallest verifiable action for Clustering; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Clustering step 11: perform the next smallest verifiable action for Clustering; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Clustering step 12: perform the next smallest verifiable action for Clustering; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Clustering step 13: perform the next smallest verifiable action for Clustering; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Clustering step 14: perform the next smallest verifiable action for Clustering; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Clustering step 15: perform the next smallest verifiable action for Clustering; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Clustering step 16: perform the next smallest verifiable action for Clustering; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Clustering step 17: perform the next smallest verifiable action for Clustering; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Clustering step 18: perform the next smallest verifiable action for Clustering; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Clustering step 19: perform the next smallest verifiable action for Clustering; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Clustering step 20: perform the next smallest verifiable action for Clustering; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Clustering step 21: perform the next smallest verifiable action for Clustering; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Clustering step 22: perform the next smallest verifiable action for Clustering; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Clustering step 23: perform the next smallest verifiable action for Clustering; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Clustering step 24: perform the next smallest verifiable action for Clustering; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Clustering step 25: perform the next smallest verifiable action for Clustering; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Clustering step 26: perform the next smallest verifiable action for Clustering; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Clustering step 27: perform the next smallest verifiable action for Clustering; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Clustering step 28: perform the next smallest verifiable action for Clustering; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Clustering step 29: perform the next smallest verifiable action for Clustering; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Clustering step 30: perform the next smallest verifiable action for Clustering; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Clustering step 31: perform the next smallest verifiable action for Clustering; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Clustering step 32: perform the next smallest verifiable action for Clustering; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Clustering step 33: perform the next smallest verifiable action for Clustering; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Clustering step 34: perform the next smallest verifiable action for Clustering; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Clustering step 35: perform the next smallest verifiable action for Clustering; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.

### Phase 14: Ranking
- [ ] Ranking step 01: perform the next smallest verifiable action for Ranking; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Ranking step 02: perform the next smallest verifiable action for Ranking; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Ranking step 03: perform the next smallest verifiable action for Ranking; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Ranking step 04: perform the next smallest verifiable action for Ranking; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Ranking step 05: perform the next smallest verifiable action for Ranking; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Ranking step 06: perform the next smallest verifiable action for Ranking; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Ranking step 07: perform the next smallest verifiable action for Ranking; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Ranking step 08: perform the next smallest verifiable action for Ranking; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Ranking step 09: perform the next smallest verifiable action for Ranking; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Ranking step 10: perform the next smallest verifiable action for Ranking; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Ranking step 11: perform the next smallest verifiable action for Ranking; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Ranking step 12: perform the next smallest verifiable action for Ranking; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Ranking step 13: perform the next smallest verifiable action for Ranking; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Ranking step 14: perform the next smallest verifiable action for Ranking; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Ranking step 15: perform the next smallest verifiable action for Ranking; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Ranking step 16: perform the next smallest verifiable action for Ranking; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Ranking step 17: perform the next smallest verifiable action for Ranking; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Ranking step 18: perform the next smallest verifiable action for Ranking; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Ranking step 19: perform the next smallest verifiable action for Ranking; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Ranking step 20: perform the next smallest verifiable action for Ranking; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Ranking step 21: perform the next smallest verifiable action for Ranking; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Ranking step 22: perform the next smallest verifiable action for Ranking; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Ranking step 23: perform the next smallest verifiable action for Ranking; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Ranking step 24: perform the next smallest verifiable action for Ranking; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Ranking step 25: perform the next smallest verifiable action for Ranking; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Ranking step 26: perform the next smallest verifiable action for Ranking; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Ranking step 27: perform the next smallest verifiable action for Ranking; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Ranking step 28: perform the next smallest verifiable action for Ranking; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Ranking step 29: perform the next smallest verifiable action for Ranking; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Ranking step 30: perform the next smallest verifiable action for Ranking; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Ranking step 31: perform the next smallest verifiable action for Ranking; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Ranking step 32: perform the next smallest verifiable action for Ranking; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Ranking step 33: perform the next smallest verifiable action for Ranking; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Ranking step 34: perform the next smallest verifiable action for Ranking; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Ranking step 35: perform the next smallest verifiable action for Ranking; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.

### Phase 15: Snippet extraction
- [ ] Snippet extraction step 01: perform the next smallest verifiable action for Snippet extraction; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Snippet extraction step 02: perform the next smallest verifiable action for Snippet extraction; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Snippet extraction step 03: perform the next smallest verifiable action for Snippet extraction; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Snippet extraction step 04: perform the next smallest verifiable action for Snippet extraction; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Snippet extraction step 05: perform the next smallest verifiable action for Snippet extraction; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Snippet extraction step 06: perform the next smallest verifiable action for Snippet extraction; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Snippet extraction step 07: perform the next smallest verifiable action for Snippet extraction; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Snippet extraction step 08: perform the next smallest verifiable action for Snippet extraction; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Snippet extraction step 09: perform the next smallest verifiable action for Snippet extraction; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Snippet extraction step 10: perform the next smallest verifiable action for Snippet extraction; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Snippet extraction step 11: perform the next smallest verifiable action for Snippet extraction; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Snippet extraction step 12: perform the next smallest verifiable action for Snippet extraction; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Snippet extraction step 13: perform the next smallest verifiable action for Snippet extraction; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Snippet extraction step 14: perform the next smallest verifiable action for Snippet extraction; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Snippet extraction step 15: perform the next smallest verifiable action for Snippet extraction; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Snippet extraction step 16: perform the next smallest verifiable action for Snippet extraction; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Snippet extraction step 17: perform the next smallest verifiable action for Snippet extraction; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Snippet extraction step 18: perform the next smallest verifiable action for Snippet extraction; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Snippet extraction step 19: perform the next smallest verifiable action for Snippet extraction; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Snippet extraction step 20: perform the next smallest verifiable action for Snippet extraction; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Snippet extraction step 21: perform the next smallest verifiable action for Snippet extraction; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Snippet extraction step 22: perform the next smallest verifiable action for Snippet extraction; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Snippet extraction step 23: perform the next smallest verifiable action for Snippet extraction; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Snippet extraction step 24: perform the next smallest verifiable action for Snippet extraction; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Snippet extraction step 25: perform the next smallest verifiable action for Snippet extraction; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Snippet extraction step 26: perform the next smallest verifiable action for Snippet extraction; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Snippet extraction step 27: perform the next smallest verifiable action for Snippet extraction; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Snippet extraction step 28: perform the next smallest verifiable action for Snippet extraction; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Snippet extraction step 29: perform the next smallest verifiable action for Snippet extraction; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Snippet extraction step 30: perform the next smallest verifiable action for Snippet extraction; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Snippet extraction step 31: perform the next smallest verifiable action for Snippet extraction; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Snippet extraction step 32: perform the next smallest verifiable action for Snippet extraction; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Snippet extraction step 33: perform the next smallest verifiable action for Snippet extraction; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Snippet extraction step 34: perform the next smallest verifiable action for Snippet extraction; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Snippet extraction step 35: perform the next smallest verifiable action for Snippet extraction; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.

### Phase 16: Revision hashing
- [ ] Revision hashing step 01: perform the next smallest verifiable action for Revision hashing; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Revision hashing step 02: perform the next smallest verifiable action for Revision hashing; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Revision hashing step 03: perform the next smallest verifiable action for Revision hashing; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Revision hashing step 04: perform the next smallest verifiable action for Revision hashing; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Revision hashing step 05: perform the next smallest verifiable action for Revision hashing; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Revision hashing step 06: perform the next smallest verifiable action for Revision hashing; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Revision hashing step 07: perform the next smallest verifiable action for Revision hashing; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Revision hashing step 08: perform the next smallest verifiable action for Revision hashing; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Revision hashing step 09: perform the next smallest verifiable action for Revision hashing; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Revision hashing step 10: perform the next smallest verifiable action for Revision hashing; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Revision hashing step 11: perform the next smallest verifiable action for Revision hashing; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Revision hashing step 12: perform the next smallest verifiable action for Revision hashing; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Revision hashing step 13: perform the next smallest verifiable action for Revision hashing; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Revision hashing step 14: perform the next smallest verifiable action for Revision hashing; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Revision hashing step 15: perform the next smallest verifiable action for Revision hashing; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Revision hashing step 16: perform the next smallest verifiable action for Revision hashing; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Revision hashing step 17: perform the next smallest verifiable action for Revision hashing; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Revision hashing step 18: perform the next smallest verifiable action for Revision hashing; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Revision hashing step 19: perform the next smallest verifiable action for Revision hashing; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Revision hashing step 20: perform the next smallest verifiable action for Revision hashing; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Revision hashing step 21: perform the next smallest verifiable action for Revision hashing; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Revision hashing step 22: perform the next smallest verifiable action for Revision hashing; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Revision hashing step 23: perform the next smallest verifiable action for Revision hashing; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Revision hashing step 24: perform the next smallest verifiable action for Revision hashing; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Revision hashing step 25: perform the next smallest verifiable action for Revision hashing; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Revision hashing step 26: perform the next smallest verifiable action for Revision hashing; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Revision hashing step 27: perform the next smallest verifiable action for Revision hashing; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Revision hashing step 28: perform the next smallest verifiable action for Revision hashing; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Revision hashing step 29: perform the next smallest verifiable action for Revision hashing; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Revision hashing step 30: perform the next smallest verifiable action for Revision hashing; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Revision hashing step 31: perform the next smallest verifiable action for Revision hashing; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Revision hashing step 32: perform the next smallest verifiable action for Revision hashing; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Revision hashing step 33: perform the next smallest verifiable action for Revision hashing; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Revision hashing step 34: perform the next smallest verifiable action for Revision hashing; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Revision hashing step 35: perform the next smallest verifiable action for Revision hashing; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.

### Phase 17: Plan store
- [ ] Plan store step 01: perform the next smallest verifiable action for Plan store; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan store step 02: perform the next smallest verifiable action for Plan store; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan store step 03: perform the next smallest verifiable action for Plan store; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan store step 04: perform the next smallest verifiable action for Plan store; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan store step 05: perform the next smallest verifiable action for Plan store; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan store step 06: perform the next smallest verifiable action for Plan store; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan store step 07: perform the next smallest verifiable action for Plan store; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan store step 08: perform the next smallest verifiable action for Plan store; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan store step 09: perform the next smallest verifiable action for Plan store; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan store step 10: perform the next smallest verifiable action for Plan store; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan store step 11: perform the next smallest verifiable action for Plan store; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan store step 12: perform the next smallest verifiable action for Plan store; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan store step 13: perform the next smallest verifiable action for Plan store; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan store step 14: perform the next smallest verifiable action for Plan store; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan store step 15: perform the next smallest verifiable action for Plan store; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan store step 16: perform the next smallest verifiable action for Plan store; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan store step 17: perform the next smallest verifiable action for Plan store; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan store step 18: perform the next smallest verifiable action for Plan store; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan store step 19: perform the next smallest verifiable action for Plan store; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan store step 20: perform the next smallest verifiable action for Plan store; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan store step 21: perform the next smallest verifiable action for Plan store; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan store step 22: perform the next smallest verifiable action for Plan store; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan store step 23: perform the next smallest verifiable action for Plan store; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan store step 24: perform the next smallest verifiable action for Plan store; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan store step 25: perform the next smallest verifiable action for Plan store; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan store step 26: perform the next smallest verifiable action for Plan store; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan store step 27: perform the next smallest verifiable action for Plan store; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan store step 28: perform the next smallest verifiable action for Plan store; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan store step 29: perform the next smallest verifiable action for Plan store; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan store step 30: perform the next smallest verifiable action for Plan store; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan store step 31: perform the next smallest verifiable action for Plan store; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan store step 32: perform the next smallest verifiable action for Plan store; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan store step 33: perform the next smallest verifiable action for Plan store; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan store step 34: perform the next smallest verifiable action for Plan store; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan store step 35: perform the next smallest verifiable action for Plan store; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.

### Phase 18: Plan endpoint
- [ ] Plan endpoint step 01: perform the next smallest verifiable action for Plan endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan endpoint step 02: perform the next smallest verifiable action for Plan endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan endpoint step 03: perform the next smallest verifiable action for Plan endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan endpoint step 04: perform the next smallest verifiable action for Plan endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan endpoint step 05: perform the next smallest verifiable action for Plan endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan endpoint step 06: perform the next smallest verifiable action for Plan endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan endpoint step 07: perform the next smallest verifiable action for Plan endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan endpoint step 08: perform the next smallest verifiable action for Plan endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan endpoint step 09: perform the next smallest verifiable action for Plan endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan endpoint step 10: perform the next smallest verifiable action for Plan endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan endpoint step 11: perform the next smallest verifiable action for Plan endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan endpoint step 12: perform the next smallest verifiable action for Plan endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan endpoint step 13: perform the next smallest verifiable action for Plan endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan endpoint step 14: perform the next smallest verifiable action for Plan endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan endpoint step 15: perform the next smallest verifiable action for Plan endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan endpoint step 16: perform the next smallest verifiable action for Plan endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan endpoint step 17: perform the next smallest verifiable action for Plan endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan endpoint step 18: perform the next smallest verifiable action for Plan endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan endpoint step 19: perform the next smallest verifiable action for Plan endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan endpoint step 20: perform the next smallest verifiable action for Plan endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan endpoint step 21: perform the next smallest verifiable action for Plan endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan endpoint step 22: perform the next smallest verifiable action for Plan endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan endpoint step 23: perform the next smallest verifiable action for Plan endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan endpoint step 24: perform the next smallest verifiable action for Plan endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan endpoint step 25: perform the next smallest verifiable action for Plan endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan endpoint step 26: perform the next smallest verifiable action for Plan endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan endpoint step 27: perform the next smallest verifiable action for Plan endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan endpoint step 28: perform the next smallest verifiable action for Plan endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan endpoint step 29: perform the next smallest verifiable action for Plan endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan endpoint step 30: perform the next smallest verifiable action for Plan endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan endpoint step 31: perform the next smallest verifiable action for Plan endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan endpoint step 32: perform the next smallest verifiable action for Plan endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan endpoint step 33: perform the next smallest verifiable action for Plan endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan endpoint step 34: perform the next smallest verifiable action for Plan endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Plan endpoint step 35: perform the next smallest verifiable action for Plan endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.

### Phase 19: Expand endpoint
- [ ] Expand endpoint step 01: perform the next smallest verifiable action for Expand endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Expand endpoint step 02: perform the next smallest verifiable action for Expand endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Expand endpoint step 03: perform the next smallest verifiable action for Expand endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Expand endpoint step 04: perform the next smallest verifiable action for Expand endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Expand endpoint step 05: perform the next smallest verifiable action for Expand endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Expand endpoint step 06: perform the next smallest verifiable action for Expand endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Expand endpoint step 07: perform the next smallest verifiable action for Expand endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Expand endpoint step 08: perform the next smallest verifiable action for Expand endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Expand endpoint step 09: perform the next smallest verifiable action for Expand endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Expand endpoint step 10: perform the next smallest verifiable action for Expand endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Expand endpoint step 11: perform the next smallest verifiable action for Expand endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Expand endpoint step 12: perform the next smallest verifiable action for Expand endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Expand endpoint step 13: perform the next smallest verifiable action for Expand endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Expand endpoint step 14: perform the next smallest verifiable action for Expand endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Expand endpoint step 15: perform the next smallest verifiable action for Expand endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Expand endpoint step 16: perform the next smallest verifiable action for Expand endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Expand endpoint step 17: perform the next smallest verifiable action for Expand endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Expand endpoint step 18: perform the next smallest verifiable action for Expand endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Expand endpoint step 19: perform the next smallest verifiable action for Expand endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Expand endpoint step 20: perform the next smallest verifiable action for Expand endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Expand endpoint step 21: perform the next smallest verifiable action for Expand endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Expand endpoint step 22: perform the next smallest verifiable action for Expand endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Expand endpoint step 23: perform the next smallest verifiable action for Expand endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Expand endpoint step 24: perform the next smallest verifiable action for Expand endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Expand endpoint step 25: perform the next smallest verifiable action for Expand endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Expand endpoint step 26: perform the next smallest verifiable action for Expand endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Expand endpoint step 27: perform the next smallest verifiable action for Expand endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Expand endpoint step 28: perform the next smallest verifiable action for Expand endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Expand endpoint step 29: perform the next smallest verifiable action for Expand endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Expand endpoint step 30: perform the next smallest verifiable action for Expand endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Expand endpoint step 31: perform the next smallest verifiable action for Expand endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Expand endpoint step 32: perform the next smallest verifiable action for Expand endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Expand endpoint step 33: perform the next smallest verifiable action for Expand endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Expand endpoint step 34: perform the next smallest verifiable action for Expand endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Expand endpoint step 35: perform the next smallest verifiable action for Expand endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.

### Phase 20: Read endpoint
- [ ] Read endpoint step 01: perform the next smallest verifiable action for Read endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Read endpoint step 02: perform the next smallest verifiable action for Read endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Read endpoint step 03: perform the next smallest verifiable action for Read endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Read endpoint step 04: perform the next smallest verifiable action for Read endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Read endpoint step 05: perform the next smallest verifiable action for Read endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Read endpoint step 06: perform the next smallest verifiable action for Read endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Read endpoint step 07: perform the next smallest verifiable action for Read endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Read endpoint step 08: perform the next smallest verifiable action for Read endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Read endpoint step 09: perform the next smallest verifiable action for Read endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Read endpoint step 10: perform the next smallest verifiable action for Read endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Read endpoint step 11: perform the next smallest verifiable action for Read endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Read endpoint step 12: perform the next smallest verifiable action for Read endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Read endpoint step 13: perform the next smallest verifiable action for Read endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Read endpoint step 14: perform the next smallest verifiable action for Read endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Read endpoint step 15: perform the next smallest verifiable action for Read endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Read endpoint step 16: perform the next smallest verifiable action for Read endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Read endpoint step 17: perform the next smallest verifiable action for Read endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Read endpoint step 18: perform the next smallest verifiable action for Read endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Read endpoint step 19: perform the next smallest verifiable action for Read endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Read endpoint step 20: perform the next smallest verifiable action for Read endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Read endpoint step 21: perform the next smallest verifiable action for Read endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Read endpoint step 22: perform the next smallest verifiable action for Read endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Read endpoint step 23: perform the next smallest verifiable action for Read endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Read endpoint step 24: perform the next smallest verifiable action for Read endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Read endpoint step 25: perform the next smallest verifiable action for Read endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Read endpoint step 26: perform the next smallest verifiable action for Read endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Read endpoint step 27: perform the next smallest verifiable action for Read endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Read endpoint step 28: perform the next smallest verifiable action for Read endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Read endpoint step 29: perform the next smallest verifiable action for Read endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Read endpoint step 30: perform the next smallest verifiable action for Read endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Read endpoint step 31: perform the next smallest verifiable action for Read endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Read endpoint step 32: perform the next smallest verifiable action for Read endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Read endpoint step 33: perform the next smallest verifiable action for Read endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Read endpoint step 34: perform the next smallest verifiable action for Read endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Read endpoint step 35: perform the next smallest verifiable action for Read endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.

### Phase 21: Validate endpoint
- [ ] Validate endpoint step 01: perform the next smallest verifiable action for Validate endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Validate endpoint step 02: perform the next smallest verifiable action for Validate endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Validate endpoint step 03: perform the next smallest verifiable action for Validate endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Validate endpoint step 04: perform the next smallest verifiable action for Validate endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Validate endpoint step 05: perform the next smallest verifiable action for Validate endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Validate endpoint step 06: perform the next smallest verifiable action for Validate endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Validate endpoint step 07: perform the next smallest verifiable action for Validate endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Validate endpoint step 08: perform the next smallest verifiable action for Validate endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Validate endpoint step 09: perform the next smallest verifiable action for Validate endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Validate endpoint step 10: perform the next smallest verifiable action for Validate endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Validate endpoint step 11: perform the next smallest verifiable action for Validate endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Validate endpoint step 12: perform the next smallest verifiable action for Validate endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Validate endpoint step 13: perform the next smallest verifiable action for Validate endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Validate endpoint step 14: perform the next smallest verifiable action for Validate endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Validate endpoint step 15: perform the next smallest verifiable action for Validate endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Validate endpoint step 16: perform the next smallest verifiable action for Validate endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Validate endpoint step 17: perform the next smallest verifiable action for Validate endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Validate endpoint step 18: perform the next smallest verifiable action for Validate endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Validate endpoint step 19: perform the next smallest verifiable action for Validate endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Validate endpoint step 20: perform the next smallest verifiable action for Validate endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Validate endpoint step 21: perform the next smallest verifiable action for Validate endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Validate endpoint step 22: perform the next smallest verifiable action for Validate endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Validate endpoint step 23: perform the next smallest verifiable action for Validate endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Validate endpoint step 24: perform the next smallest verifiable action for Validate endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Validate endpoint step 25: perform the next smallest verifiable action for Validate endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Validate endpoint step 26: perform the next smallest verifiable action for Validate endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Validate endpoint step 27: perform the next smallest verifiable action for Validate endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Validate endpoint step 28: perform the next smallest verifiable action for Validate endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Validate endpoint step 29: perform the next smallest verifiable action for Validate endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Validate endpoint step 30: perform the next smallest verifiable action for Validate endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Validate endpoint step 31: perform the next smallest verifiable action for Validate endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Validate endpoint step 32: perform the next smallest verifiable action for Validate endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Validate endpoint step 33: perform the next smallest verifiable action for Validate endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Validate endpoint step 34: perform the next smallest verifiable action for Validate endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Validate endpoint step 35: perform the next smallest verifiable action for Validate endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.

### Phase 22: Profiles endpoint
- [ ] Profiles endpoint step 01: perform the next smallest verifiable action for Profiles endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Profiles endpoint step 02: perform the next smallest verifiable action for Profiles endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Profiles endpoint step 03: perform the next smallest verifiable action for Profiles endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Profiles endpoint step 04: perform the next smallest verifiable action for Profiles endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Profiles endpoint step 05: perform the next smallest verifiable action for Profiles endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Profiles endpoint step 06: perform the next smallest verifiable action for Profiles endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Profiles endpoint step 07: perform the next smallest verifiable action for Profiles endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Profiles endpoint step 08: perform the next smallest verifiable action for Profiles endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Profiles endpoint step 09: perform the next smallest verifiable action for Profiles endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Profiles endpoint step 10: perform the next smallest verifiable action for Profiles endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Profiles endpoint step 11: perform the next smallest verifiable action for Profiles endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Profiles endpoint step 12: perform the next smallest verifiable action for Profiles endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Profiles endpoint step 13: perform the next smallest verifiable action for Profiles endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Profiles endpoint step 14: perform the next smallest verifiable action for Profiles endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Profiles endpoint step 15: perform the next smallest verifiable action for Profiles endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Profiles endpoint step 16: perform the next smallest verifiable action for Profiles endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Profiles endpoint step 17: perform the next smallest verifiable action for Profiles endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Profiles endpoint step 18: perform the next smallest verifiable action for Profiles endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Profiles endpoint step 19: perform the next smallest verifiable action for Profiles endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Profiles endpoint step 20: perform the next smallest verifiable action for Profiles endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Profiles endpoint step 21: perform the next smallest verifiable action for Profiles endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Profiles endpoint step 22: perform the next smallest verifiable action for Profiles endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Profiles endpoint step 23: perform the next smallest verifiable action for Profiles endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Profiles endpoint step 24: perform the next smallest verifiable action for Profiles endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Profiles endpoint step 25: perform the next smallest verifiable action for Profiles endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Profiles endpoint step 26: perform the next smallest verifiable action for Profiles endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Profiles endpoint step 27: perform the next smallest verifiable action for Profiles endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Profiles endpoint step 28: perform the next smallest verifiable action for Profiles endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Profiles endpoint step 29: perform the next smallest verifiable action for Profiles endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Profiles endpoint step 30: perform the next smallest verifiable action for Profiles endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Profiles endpoint step 31: perform the next smallest verifiable action for Profiles endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Profiles endpoint step 32: perform the next smallest verifiable action for Profiles endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Profiles endpoint step 33: perform the next smallest verifiable action for Profiles endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Profiles endpoint step 34: perform the next smallest verifiable action for Profiles endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Profiles endpoint step 35: perform the next smallest verifiable action for Profiles endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.

### Phase 23: Health endpoint
- [ ] Health endpoint step 01: perform the next smallest verifiable action for Health endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Health endpoint step 02: perform the next smallest verifiable action for Health endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Health endpoint step 03: perform the next smallest verifiable action for Health endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Health endpoint step 04: perform the next smallest verifiable action for Health endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Health endpoint step 05: perform the next smallest verifiable action for Health endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Health endpoint step 06: perform the next smallest verifiable action for Health endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Health endpoint step 07: perform the next smallest verifiable action for Health endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Health endpoint step 08: perform the next smallest verifiable action for Health endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Health endpoint step 09: perform the next smallest verifiable action for Health endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Health endpoint step 10: perform the next smallest verifiable action for Health endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Health endpoint step 11: perform the next smallest verifiable action for Health endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Health endpoint step 12: perform the next smallest verifiable action for Health endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Health endpoint step 13: perform the next smallest verifiable action for Health endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Health endpoint step 14: perform the next smallest verifiable action for Health endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Health endpoint step 15: perform the next smallest verifiable action for Health endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Health endpoint step 16: perform the next smallest verifiable action for Health endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Health endpoint step 17: perform the next smallest verifiable action for Health endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Health endpoint step 18: perform the next smallest verifiable action for Health endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Health endpoint step 19: perform the next smallest verifiable action for Health endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Health endpoint step 20: perform the next smallest verifiable action for Health endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Health endpoint step 21: perform the next smallest verifiable action for Health endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Health endpoint step 22: perform the next smallest verifiable action for Health endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Health endpoint step 23: perform the next smallest verifiable action for Health endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Health endpoint step 24: perform the next smallest verifiable action for Health endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Health endpoint step 25: perform the next smallest verifiable action for Health endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Health endpoint step 26: perform the next smallest verifiable action for Health endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Health endpoint step 27: perform the next smallest verifiable action for Health endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Health endpoint step 28: perform the next smallest verifiable action for Health endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Health endpoint step 29: perform the next smallest verifiable action for Health endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Health endpoint step 30: perform the next smallest verifiable action for Health endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Health endpoint step 31: perform the next smallest verifiable action for Health endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Health endpoint step 32: perform the next smallest verifiable action for Health endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Health endpoint step 33: perform the next smallest verifiable action for Health endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Health endpoint step 34: perform the next smallest verifiable action for Health endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Health endpoint step 35: perform the next smallest verifiable action for Health endpoint; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.

### Phase 24: Amaze integration
- [ ] Amaze integration step 01: perform the next smallest verifiable action for Amaze integration; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Amaze integration step 02: perform the next smallest verifiable action for Amaze integration; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Amaze integration step 03: perform the next smallest verifiable action for Amaze integration; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Amaze integration step 04: perform the next smallest verifiable action for Amaze integration; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Amaze integration step 05: perform the next smallest verifiable action for Amaze integration; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Amaze integration step 06: perform the next smallest verifiable action for Amaze integration; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Amaze integration step 07: perform the next smallest verifiable action for Amaze integration; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Amaze integration step 08: perform the next smallest verifiable action for Amaze integration; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Amaze integration step 09: perform the next smallest verifiable action for Amaze integration; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Amaze integration step 10: perform the next smallest verifiable action for Amaze integration; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Amaze integration step 11: perform the next smallest verifiable action for Amaze integration; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Amaze integration step 12: perform the next smallest verifiable action for Amaze integration; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Amaze integration step 13: perform the next smallest verifiable action for Amaze integration; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Amaze integration step 14: perform the next smallest verifiable action for Amaze integration; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Amaze integration step 15: perform the next smallest verifiable action for Amaze integration; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Amaze integration step 16: perform the next smallest verifiable action for Amaze integration; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Amaze integration step 17: perform the next smallest verifiable action for Amaze integration; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Amaze integration step 18: perform the next smallest verifiable action for Amaze integration; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Amaze integration step 19: perform the next smallest verifiable action for Amaze integration; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Amaze integration step 20: perform the next smallest verifiable action for Amaze integration; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Amaze integration step 21: perform the next smallest verifiable action for Amaze integration; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Amaze integration step 22: perform the next smallest verifiable action for Amaze integration; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Amaze integration step 23: perform the next smallest verifiable action for Amaze integration; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Amaze integration step 24: perform the next smallest verifiable action for Amaze integration; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Amaze integration step 25: perform the next smallest verifiable action for Amaze integration; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Amaze integration step 26: perform the next smallest verifiable action for Amaze integration; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Amaze integration step 27: perform the next smallest verifiable action for Amaze integration; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Amaze integration step 28: perform the next smallest verifiable action for Amaze integration; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Amaze integration step 29: perform the next smallest verifiable action for Amaze integration; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Amaze integration step 30: perform the next smallest verifiable action for Amaze integration; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Amaze integration step 31: perform the next smallest verifiable action for Amaze integration; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Amaze integration step 32: perform the next smallest verifiable action for Amaze integration; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Amaze integration step 33: perform the next smallest verifiable action for Amaze integration; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Amaze integration step 34: perform the next smallest verifiable action for Amaze integration; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Amaze integration step 35: perform the next smallest verifiable action for Amaze integration; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.

### Phase 25: Prompt policy
- [ ] Prompt policy step 01: perform the next smallest verifiable action for Prompt policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Prompt policy step 02: perform the next smallest verifiable action for Prompt policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Prompt policy step 03: perform the next smallest verifiable action for Prompt policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Prompt policy step 04: perform the next smallest verifiable action for Prompt policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Prompt policy step 05: perform the next smallest verifiable action for Prompt policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Prompt policy step 06: perform the next smallest verifiable action for Prompt policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Prompt policy step 07: perform the next smallest verifiable action for Prompt policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Prompt policy step 08: perform the next smallest verifiable action for Prompt policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Prompt policy step 09: perform the next smallest verifiable action for Prompt policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Prompt policy step 10: perform the next smallest verifiable action for Prompt policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Prompt policy step 11: perform the next smallest verifiable action for Prompt policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Prompt policy step 12: perform the next smallest verifiable action for Prompt policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Prompt policy step 13: perform the next smallest verifiable action for Prompt policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Prompt policy step 14: perform the next smallest verifiable action for Prompt policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Prompt policy step 15: perform the next smallest verifiable action for Prompt policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Prompt policy step 16: perform the next smallest verifiable action for Prompt policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Prompt policy step 17: perform the next smallest verifiable action for Prompt policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Prompt policy step 18: perform the next smallest verifiable action for Prompt policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Prompt policy step 19: perform the next smallest verifiable action for Prompt policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Prompt policy step 20: perform the next smallest verifiable action for Prompt policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Prompt policy step 21: perform the next smallest verifiable action for Prompt policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Prompt policy step 22: perform the next smallest verifiable action for Prompt policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Prompt policy step 23: perform the next smallest verifiable action for Prompt policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Prompt policy step 24: perform the next smallest verifiable action for Prompt policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Prompt policy step 25: perform the next smallest verifiable action for Prompt policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Prompt policy step 26: perform the next smallest verifiable action for Prompt policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Prompt policy step 27: perform the next smallest verifiable action for Prompt policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Prompt policy step 28: perform the next smallest verifiable action for Prompt policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Prompt policy step 29: perform the next smallest verifiable action for Prompt policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Prompt policy step 30: perform the next smallest verifiable action for Prompt policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Prompt policy step 31: perform the next smallest verifiable action for Prompt policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Prompt policy step 32: perform the next smallest verifiable action for Prompt policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Prompt policy step 33: perform the next smallest verifiable action for Prompt policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Prompt policy step 34: perform the next smallest verifiable action for Prompt policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Prompt policy step 35: perform the next smallest verifiable action for Prompt policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.

### Phase 26: Fallback policy
- [ ] Fallback policy step 01: perform the next smallest verifiable action for Fallback policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Fallback policy step 02: perform the next smallest verifiable action for Fallback policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Fallback policy step 03: perform the next smallest verifiable action for Fallback policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Fallback policy step 04: perform the next smallest verifiable action for Fallback policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Fallback policy step 05: perform the next smallest verifiable action for Fallback policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Fallback policy step 06: perform the next smallest verifiable action for Fallback policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Fallback policy step 07: perform the next smallest verifiable action for Fallback policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Fallback policy step 08: perform the next smallest verifiable action for Fallback policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Fallback policy step 09: perform the next smallest verifiable action for Fallback policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Fallback policy step 10: perform the next smallest verifiable action for Fallback policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Fallback policy step 11: perform the next smallest verifiable action for Fallback policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Fallback policy step 12: perform the next smallest verifiable action for Fallback policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Fallback policy step 13: perform the next smallest verifiable action for Fallback policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Fallback policy step 14: perform the next smallest verifiable action for Fallback policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Fallback policy step 15: perform the next smallest verifiable action for Fallback policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Fallback policy step 16: perform the next smallest verifiable action for Fallback policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Fallback policy step 17: perform the next smallest verifiable action for Fallback policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Fallback policy step 18: perform the next smallest verifiable action for Fallback policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Fallback policy step 19: perform the next smallest verifiable action for Fallback policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Fallback policy step 20: perform the next smallest verifiable action for Fallback policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Fallback policy step 21: perform the next smallest verifiable action for Fallback policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Fallback policy step 22: perform the next smallest verifiable action for Fallback policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Fallback policy step 23: perform the next smallest verifiable action for Fallback policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Fallback policy step 24: perform the next smallest verifiable action for Fallback policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Fallback policy step 25: perform the next smallest verifiable action for Fallback policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Fallback policy step 26: perform the next smallest verifiable action for Fallback policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Fallback policy step 27: perform the next smallest verifiable action for Fallback policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Fallback policy step 28: perform the next smallest verifiable action for Fallback policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Fallback policy step 29: perform the next smallest verifiable action for Fallback policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Fallback policy step 30: perform the next smallest verifiable action for Fallback policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Fallback policy step 31: perform the next smallest verifiable action for Fallback policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Fallback policy step 32: perform the next smallest verifiable action for Fallback policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Fallback policy step 33: perform the next smallest verifiable action for Fallback policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Fallback policy step 34: perform the next smallest verifiable action for Fallback policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Fallback policy step 35: perform the next smallest verifiable action for Fallback policy; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.

### Phase 27: Telemetry
- [ ] Telemetry step 01: perform the next smallest verifiable action for Telemetry; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Telemetry step 02: perform the next smallest verifiable action for Telemetry; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Telemetry step 03: perform the next smallest verifiable action for Telemetry; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Telemetry step 04: perform the next smallest verifiable action for Telemetry; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Telemetry step 05: perform the next smallest verifiable action for Telemetry; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Telemetry step 06: perform the next smallest verifiable action for Telemetry; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Telemetry step 07: perform the next smallest verifiable action for Telemetry; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Telemetry step 08: perform the next smallest verifiable action for Telemetry; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Telemetry step 09: perform the next smallest verifiable action for Telemetry; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Telemetry step 10: perform the next smallest verifiable action for Telemetry; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Telemetry step 11: perform the next smallest verifiable action for Telemetry; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Telemetry step 12: perform the next smallest verifiable action for Telemetry; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Telemetry step 13: perform the next smallest verifiable action for Telemetry; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Telemetry step 14: perform the next smallest verifiable action for Telemetry; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Telemetry step 15: perform the next smallest verifiable action for Telemetry; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Telemetry step 16: perform the next smallest verifiable action for Telemetry; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Telemetry step 17: perform the next smallest verifiable action for Telemetry; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Telemetry step 18: perform the next smallest verifiable action for Telemetry; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Telemetry step 19: perform the next smallest verifiable action for Telemetry; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Telemetry step 20: perform the next smallest verifiable action for Telemetry; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Telemetry step 21: perform the next smallest verifiable action for Telemetry; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Telemetry step 22: perform the next smallest verifiable action for Telemetry; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Telemetry step 23: perform the next smallest verifiable action for Telemetry; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Telemetry step 24: perform the next smallest verifiable action for Telemetry; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Telemetry step 25: perform the next smallest verifiable action for Telemetry; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Telemetry step 26: perform the next smallest verifiable action for Telemetry; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Telemetry step 27: perform the next smallest verifiable action for Telemetry; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Telemetry step 28: perform the next smallest verifiable action for Telemetry; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Telemetry step 29: perform the next smallest verifiable action for Telemetry; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Telemetry step 30: perform the next smallest verifiable action for Telemetry; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Telemetry step 31: perform the next smallest verifiable action for Telemetry; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Telemetry step 32: perform the next smallest verifiable action for Telemetry; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Telemetry step 33: perform the next smallest verifiable action for Telemetry; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Telemetry step 34: perform the next smallest verifiable action for Telemetry; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Telemetry step 35: perform the next smallest verifiable action for Telemetry; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.

### Phase 28: Performance validation
- [ ] Performance validation step 01: perform the next smallest verifiable action for Performance validation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Performance validation step 02: perform the next smallest verifiable action for Performance validation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Performance validation step 03: perform the next smallest verifiable action for Performance validation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Performance validation step 04: perform the next smallest verifiable action for Performance validation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Performance validation step 05: perform the next smallest verifiable action for Performance validation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Performance validation step 06: perform the next smallest verifiable action for Performance validation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Performance validation step 07: perform the next smallest verifiable action for Performance validation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Performance validation step 08: perform the next smallest verifiable action for Performance validation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Performance validation step 09: perform the next smallest verifiable action for Performance validation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Performance validation step 10: perform the next smallest verifiable action for Performance validation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Performance validation step 11: perform the next smallest verifiable action for Performance validation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Performance validation step 12: perform the next smallest verifiable action for Performance validation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Performance validation step 13: perform the next smallest verifiable action for Performance validation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Performance validation step 14: perform the next smallest verifiable action for Performance validation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Performance validation step 15: perform the next smallest verifiable action for Performance validation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Performance validation step 16: perform the next smallest verifiable action for Performance validation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Performance validation step 17: perform the next smallest verifiable action for Performance validation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Performance validation step 18: perform the next smallest verifiable action for Performance validation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Performance validation step 19: perform the next smallest verifiable action for Performance validation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Performance validation step 20: perform the next smallest verifiable action for Performance validation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Performance validation step 21: perform the next smallest verifiable action for Performance validation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Performance validation step 22: perform the next smallest verifiable action for Performance validation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Performance validation step 23: perform the next smallest verifiable action for Performance validation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Performance validation step 24: perform the next smallest verifiable action for Performance validation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Performance validation step 25: perform the next smallest verifiable action for Performance validation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Performance validation step 26: perform the next smallest verifiable action for Performance validation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Performance validation step 27: perform the next smallest verifiable action for Performance validation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Performance validation step 28: perform the next smallest verifiable action for Performance validation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Performance validation step 29: perform the next smallest verifiable action for Performance validation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Performance validation step 30: perform the next smallest verifiable action for Performance validation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Performance validation step 31: perform the next smallest verifiable action for Performance validation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Performance validation step 32: perform the next smallest verifiable action for Performance validation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Performance validation step 33: perform the next smallest verifiable action for Performance validation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Performance validation step 34: perform the next smallest verifiable action for Performance validation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Performance validation step 35: perform the next smallest verifiable action for Performance validation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.

### Phase 29: Large repository simulation
- [ ] Large repository simulation step 01: perform the next smallest verifiable action for Large repository simulation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Large repository simulation step 02: perform the next smallest verifiable action for Large repository simulation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Large repository simulation step 03: perform the next smallest verifiable action for Large repository simulation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Large repository simulation step 04: perform the next smallest verifiable action for Large repository simulation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Large repository simulation step 05: perform the next smallest verifiable action for Large repository simulation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Large repository simulation step 06: perform the next smallest verifiable action for Large repository simulation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Large repository simulation step 07: perform the next smallest verifiable action for Large repository simulation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Large repository simulation step 08: perform the next smallest verifiable action for Large repository simulation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Large repository simulation step 09: perform the next smallest verifiable action for Large repository simulation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Large repository simulation step 10: perform the next smallest verifiable action for Large repository simulation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Large repository simulation step 11: perform the next smallest verifiable action for Large repository simulation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Large repository simulation step 12: perform the next smallest verifiable action for Large repository simulation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Large repository simulation step 13: perform the next smallest verifiable action for Large repository simulation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Large repository simulation step 14: perform the next smallest verifiable action for Large repository simulation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Large repository simulation step 15: perform the next smallest verifiable action for Large repository simulation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Large repository simulation step 16: perform the next smallest verifiable action for Large repository simulation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Large repository simulation step 17: perform the next smallest verifiable action for Large repository simulation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Large repository simulation step 18: perform the next smallest verifiable action for Large repository simulation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Large repository simulation step 19: perform the next smallest verifiable action for Large repository simulation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Large repository simulation step 20: perform the next smallest verifiable action for Large repository simulation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Large repository simulation step 21: perform the next smallest verifiable action for Large repository simulation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Large repository simulation step 22: perform the next smallest verifiable action for Large repository simulation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Large repository simulation step 23: perform the next smallest verifiable action for Large repository simulation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Large repository simulation step 24: perform the next smallest verifiable action for Large repository simulation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Large repository simulation step 25: perform the next smallest verifiable action for Large repository simulation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Large repository simulation step 26: perform the next smallest verifiable action for Large repository simulation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Large repository simulation step 27: perform the next smallest verifiable action for Large repository simulation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Large repository simulation step 28: perform the next smallest verifiable action for Large repository simulation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Large repository simulation step 29: perform the next smallest verifiable action for Large repository simulation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Large repository simulation step 30: perform the next smallest verifiable action for Large repository simulation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Large repository simulation step 31: perform the next smallest verifiable action for Large repository simulation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Large repository simulation step 32: perform the next smallest verifiable action for Large repository simulation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Large repository simulation step 33: perform the next smallest verifiable action for Large repository simulation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Large repository simulation step 34: perform the next smallest verifiable action for Large repository simulation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Large repository simulation step 35: perform the next smallest verifiable action for Large repository simulation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.

### Phase 30: Documentation
- [ ] Documentation step 01: perform the next smallest verifiable action for Documentation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Documentation step 02: perform the next smallest verifiable action for Documentation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Documentation step 03: perform the next smallest verifiable action for Documentation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Documentation step 04: perform the next smallest verifiable action for Documentation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Documentation step 05: perform the next smallest verifiable action for Documentation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Documentation step 06: perform the next smallest verifiable action for Documentation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Documentation step 07: perform the next smallest verifiable action for Documentation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Documentation step 08: perform the next smallest verifiable action for Documentation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Documentation step 09: perform the next smallest verifiable action for Documentation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Documentation step 10: perform the next smallest verifiable action for Documentation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Documentation step 11: perform the next smallest verifiable action for Documentation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Documentation step 12: perform the next smallest verifiable action for Documentation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Documentation step 13: perform the next smallest verifiable action for Documentation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Documentation step 14: perform the next smallest verifiable action for Documentation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Documentation step 15: perform the next smallest verifiable action for Documentation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Documentation step 16: perform the next smallest verifiable action for Documentation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Documentation step 17: perform the next smallest verifiable action for Documentation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Documentation step 18: perform the next smallest verifiable action for Documentation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Documentation step 19: perform the next smallest verifiable action for Documentation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Documentation step 20: perform the next smallest verifiable action for Documentation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Documentation step 21: perform the next smallest verifiable action for Documentation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Documentation step 22: perform the next smallest verifiable action for Documentation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Documentation step 23: perform the next smallest verifiable action for Documentation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Documentation step 24: perform the next smallest verifiable action for Documentation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Documentation step 25: perform the next smallest verifiable action for Documentation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Documentation step 26: perform the next smallest verifiable action for Documentation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Documentation step 27: perform the next smallest verifiable action for Documentation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Documentation step 28: perform the next smallest verifiable action for Documentation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Documentation step 29: perform the next smallest verifiable action for Documentation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Documentation step 30: perform the next smallest verifiable action for Documentation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Documentation step 31: perform the next smallest verifiable action for Documentation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Documentation step 32: perform the next smallest verifiable action for Documentation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Documentation step 33: perform the next smallest verifiable action for Documentation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Documentation step 34: perform the next smallest verifiable action for Documentation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Documentation step 35: perform the next smallest verifiable action for Documentation; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.

### Phase 31: Final verification
- [ ] Final verification step 01: perform the next smallest verifiable action for Final verification; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Final verification step 02: perform the next smallest verifiable action for Final verification; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Final verification step 03: perform the next smallest verifiable action for Final verification; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Final verification step 04: perform the next smallest verifiable action for Final verification; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Final verification step 05: perform the next smallest verifiable action for Final verification; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Final verification step 06: perform the next smallest verifiable action for Final verification; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Final verification step 07: perform the next smallest verifiable action for Final verification; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Final verification step 08: perform the next smallest verifiable action for Final verification; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Final verification step 09: perform the next smallest verifiable action for Final verification; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Final verification step 10: perform the next smallest verifiable action for Final verification; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Final verification step 11: perform the next smallest verifiable action for Final verification; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Final verification step 12: perform the next smallest verifiable action for Final verification; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Final verification step 13: perform the next smallest verifiable action for Final verification; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Final verification step 14: perform the next smallest verifiable action for Final verification; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Final verification step 15: perform the next smallest verifiable action for Final verification; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Final verification step 16: perform the next smallest verifiable action for Final verification; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Final verification step 17: perform the next smallest verifiable action for Final verification; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Final verification step 18: perform the next smallest verifiable action for Final verification; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Final verification step 19: perform the next smallest verifiable action for Final verification; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Final verification step 20: perform the next smallest verifiable action for Final verification; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Final verification step 21: perform the next smallest verifiable action for Final verification; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Final verification step 22: perform the next smallest verifiable action for Final verification; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Final verification step 23: perform the next smallest verifiable action for Final verification; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Final verification step 24: perform the next smallest verifiable action for Final verification; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Final verification step 25: perform the next smallest verifiable action for Final verification; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Final verification step 26: perform the next smallest verifiable action for Final verification; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Final verification step 27: perform the next smallest verifiable action for Final verification; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Final verification step 28: perform the next smallest verifiable action for Final verification; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Final verification step 29: perform the next smallest verifiable action for Final verification; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Final verification step 30: perform the next smallest verifiable action for Final verification; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Final verification step 31: perform the next smallest verifiable action for Final verification; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Final verification step 32: perform the next smallest verifiable action for Final verification; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Final verification step 33: perform the next smallest verifiable action for Final verification; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Final verification step 34: perform the next smallest verifiable action for Final verification; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.
- [ ] Final verification step 35: perform the next smallest verifiable action for Final verification; update tests, run the narrow command, record evidence, and keep output within the profile budget contract.

## 21. Profile-Specific Test Matrix

- [ ] Case 001: profile=find_definition; scenario=small workspace; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 002: profile=find_definition; scenario=large workspace; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 003: profile=find_definition; scenario=multi-root explicit scope; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 004: profile=find_definition; scenario=parent_1 scope; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 005: profile=find_definition; scenario=stale file validation; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 006: profile=find_definition; scenario=collector unavailable fallback; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 007: profile=find_definition; scenario=budget truncation; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 008: profile=find_definition; scenario=cluster expansion; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 009: profile=find_definition; scenario=test inclusion; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 010: profile=find_definition; scenario=no result response; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 011: profile=trace_impact; scenario=small workspace; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 012: profile=trace_impact; scenario=large workspace; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 013: profile=trace_impact; scenario=multi-root explicit scope; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 014: profile=trace_impact; scenario=parent_1 scope; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 015: profile=trace_impact; scenario=stale file validation; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 016: profile=trace_impact; scenario=collector unavailable fallback; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 017: profile=trace_impact; scenario=budget truncation; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 018: profile=trace_impact; scenario=cluster expansion; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 019: profile=trace_impact; scenario=test inclusion; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 020: profile=trace_impact; scenario=no result response; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 021: profile=bug_investigation; scenario=small workspace; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 022: profile=bug_investigation; scenario=large workspace; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 023: profile=bug_investigation; scenario=multi-root explicit scope; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 024: profile=bug_investigation; scenario=parent_1 scope; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 025: profile=bug_investigation; scenario=stale file validation; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 026: profile=bug_investigation; scenario=collector unavailable fallback; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 027: profile=bug_investigation; scenario=budget truncation; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 028: profile=bug_investigation; scenario=cluster expansion; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 029: profile=bug_investigation; scenario=test inclusion; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 030: profile=bug_investigation; scenario=no result response; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 031: profile=implementation_planning; scenario=small workspace; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 032: profile=implementation_planning; scenario=large workspace; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 033: profile=implementation_planning; scenario=multi-root explicit scope; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 034: profile=implementation_planning; scenario=parent_1 scope; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 035: profile=implementation_planning; scenario=stale file validation; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 036: profile=implementation_planning; scenario=collector unavailable fallback; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 037: profile=implementation_planning; scenario=budget truncation; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 038: profile=implementation_planning; scenario=cluster expansion; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 039: profile=implementation_planning; scenario=test inclusion; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 040: profile=implementation_planning; scenario=no result response; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 041: profile=test_discovery; scenario=small workspace; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 042: profile=test_discovery; scenario=large workspace; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 043: profile=test_discovery; scenario=multi-root explicit scope; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 044: profile=test_discovery; scenario=parent_1 scope; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 045: profile=test_discovery; scenario=stale file validation; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 046: profile=test_discovery; scenario=collector unavailable fallback; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 047: profile=test_discovery; scenario=budget truncation; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 048: profile=test_discovery; scenario=cluster expansion; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 049: profile=test_discovery; scenario=test inclusion; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 050: profile=test_discovery; scenario=no result response; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 051: profile=config_lookup; scenario=small workspace; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 052: profile=config_lookup; scenario=large workspace; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 053: profile=config_lookup; scenario=multi-root explicit scope; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 054: profile=config_lookup; scenario=parent_1 scope; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 055: profile=config_lookup; scenario=stale file validation; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 056: profile=config_lookup; scenario=collector unavailable fallback; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 057: profile=config_lookup; scenario=budget truncation; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 058: profile=config_lookup; scenario=cluster expansion; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 059: profile=config_lookup; scenario=test inclusion; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 060: profile=config_lookup; scenario=no result response; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 061: profile=api_route_lookup; scenario=small workspace; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 062: profile=api_route_lookup; scenario=large workspace; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 063: profile=api_route_lookup; scenario=multi-root explicit scope; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 064: profile=api_route_lookup; scenario=parent_1 scope; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 065: profile=api_route_lookup; scenario=stale file validation; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 066: profile=api_route_lookup; scenario=collector unavailable fallback; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 067: profile=api_route_lookup; scenario=budget truncation; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 068: profile=api_route_lookup; scenario=cluster expansion; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 069: profile=api_route_lookup; scenario=test inclusion; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 070: profile=api_route_lookup; scenario=no result response; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 071: profile=architecture_overview; scenario=small workspace; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 072: profile=architecture_overview; scenario=large workspace; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 073: profile=architecture_overview; scenario=multi-root explicit scope; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 074: profile=architecture_overview; scenario=parent_1 scope; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 075: profile=architecture_overview; scenario=stale file validation; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 076: profile=architecture_overview; scenario=collector unavailable fallback; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 077: profile=architecture_overview; scenario=budget truncation; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 078: profile=architecture_overview; scenario=cluster expansion; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 079: profile=architecture_overview; scenario=test inclusion; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 080: profile=architecture_overview; scenario=no result response; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 081: profile=memory_contract; scenario=small workspace; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 082: profile=memory_contract; scenario=large workspace; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 083: profile=memory_contract; scenario=multi-root explicit scope; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 084: profile=memory_contract; scenario=parent_1 scope; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 085: profile=memory_contract; scenario=stale file validation; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 086: profile=memory_contract; scenario=collector unavailable fallback; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 087: profile=memory_contract; scenario=budget truncation; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 088: profile=memory_contract; scenario=cluster expansion; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 089: profile=memory_contract; scenario=test inclusion; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 090: profile=memory_contract; scenario=no result response; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 091: profile=codebase_contract; scenario=small workspace; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 092: profile=codebase_contract; scenario=large workspace; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 093: profile=codebase_contract; scenario=multi-root explicit scope; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 094: profile=codebase_contract; scenario=parent_1 scope; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 095: profile=codebase_contract; scenario=stale file validation; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 096: profile=codebase_contract; scenario=collector unavailable fallback; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 097: profile=codebase_contract; scenario=budget truncation; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 098: profile=codebase_contract; scenario=cluster expansion; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 099: profile=codebase_contract; scenario=test inclusion; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.
- [ ] Case 100: profile=codebase_contract; scenario=no result response; expected=bounded response with search_scope, budget_used, primary or empty reason, and no raw candidate flood.

## 22. Failure Modes

- LSP server unavailable: return structured error or degraded bounded response; never fall back to unbounded raw output.
- ast-grep binary unavailable: return structured error or degraded bounded response; never fall back to unbounded raw output.
- rocky-codebase index stale: return structured error or degraded bounded response; never fall back to unbounded raw output.
- workspace path missing: return structured error or degraded bounded response; never fall back to unbounded raw output.
- explicit roots empty: return structured error or degraded bounded response; never fall back to unbounded raw output.
- root outside allowed scope: return structured error or degraded bounded response; never fall back to unbounded raw output.
- file deleted after planning: return structured error or degraded bounded response; never fall back to unbounded raw output.
- file modified after planning: return structured error or degraded bounded response; never fall back to unbounded raw output.
- collector timeout: return structured error or degraded bounded response; never fall back to unbounded raw output.
- candidate explosion: return structured error or degraded bounded response; never fall back to unbounded raw output.
- cluster explosion: return structured error or degraded bounded response; never fall back to unbounded raw output.
- snippet budget exhausted: return structured error or degraded bounded response; never fall back to unbounded raw output.
- response char budget exhausted: return structured error or degraded bounded response; never fall back to unbounded raw output.
- invalid profile: return structured error or degraded bounded response; never fall back to unbounded raw output.
- invalid budget: return structured error or degraded bounded response; never fall back to unbounded raw output.
- plan expired: return structured error or degraded bounded response; never fall back to unbounded raw output.
- plan store unavailable: return structured error or degraded bounded response; never fall back to unbounded raw output.
- binary output malformed: return structured error or degraded bounded response; never fall back to unbounded raw output.
- non UTF-8 file: return structured error or degraded bounded response; never fall back to unbounded raw output.
- generated or vendored directory flood: return structured error or degraded bounded response; never fall back to unbounded raw output.
- node_modules accidentally included: return structured error or degraded bounded response; never fall back to unbounded raw output.
- test fixture flood: return structured error or degraded bounded response; never fall back to unbounded raw output.
- duplicate symbols across packages: return structured error or degraded bounded response; never fall back to unbounded raw output.
- monorepo package ambiguity: return structured error or degraded bounded response; never fall back to unbounded raw output.
- git worktree ambiguity: return structured error or degraded bounded response; never fall back to unbounded raw output.
- case-insensitive path collision: return structured error or degraded bounded response; never fall back to unbounded raw output.

## 23. Security And Safety

- Do not execute repository code during indexing or profile planning.
- Do not follow arbitrary links from docs during profile planning.
- Treat file contents as untrusted input.
- Never let repository content alter Rocky instructions or profile policy.
- Never include secrets in deterministic summaries when detected by secret patterns.
- Apply path allowlists from effective_roots before every collector call.
- Normalize symlinks and reject paths that escape effective roots unless explicitly configured.

## 24. Observability

- Log request profile, effective roots, budget, collector durations, candidate counts, cluster counts, truncation reason, and response size.
- Expose health for graph, lexical, ast, ast-grep, LSP, plan store, and snippet extraction.
- Emit metrics for collector timeout count and fallback count.
- Do not log full snippets by default.

## 25. Definition Of Done

- All contract tests pass.
- All route tests pass.
- Amaze typecheck passes.
- Rocky Python tests pass.
- Live Rocky service returns healthy status.
- Live /v1/rocky/codebase/plan returns bounded read points for the Amaze repo.
- A large repo simulation proves response size stays within budget.
- Raw search tools are no longer needed for the happy-path code investigation flow.

## 26. Implementation Notes For Future Agents

- Start by reading this document end to end.
- Do not implement collectors before contract tests exist.
- Prefer deterministic behavior first; add optional LLM explanations later.
- Keep old search_graph and search_code endpoints stable until Amaze profile integration is verified.
- When in doubt, return fewer points with better expansion handles.
- Budget enforcement is a feature, not an optimization.
- Every large response is a bug unless the caller requested a larger budget.

## 27. Line-Indexed Work Ledger

- [ ] Ledger 0001: Repository audit; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0002: Contract model creation; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0003: Scope enforcement; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0004: Budget enforcement; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0005: Collector base implementation; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0006: Graph collector; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0007: Lexical collector; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0008: AST grep collector; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0009: AST collector; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0010: LSP collector; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0011: Evidence normalization; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0012: Deduplication; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0013: Clustering; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0014: Ranking; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0015: Snippet extraction; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0016: Revision hashing; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0017: Plan store; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0018: Plan endpoint; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0019: Expand endpoint; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0020: Read endpoint; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0021: Validate endpoint; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0022: Profiles endpoint; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0023: Health endpoint; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0024: Amaze integration; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0025: Prompt policy; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0026: Fallback policy; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0027: Telemetry; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0028: Performance validation; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0029: Large repository simulation; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0030: Documentation; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0031: Final verification; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0032: Repository audit; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0033: Contract model creation; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0034: Scope enforcement; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0035: Budget enforcement; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0036: Collector base implementation; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0037: Graph collector; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0038: Lexical collector; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0039: AST grep collector; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0040: AST collector; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0041: LSP collector; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0042: Evidence normalization; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0043: Deduplication; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0044: Clustering; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0045: Ranking; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0046: Snippet extraction; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0047: Revision hashing; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0048: Plan store; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0049: Plan endpoint; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0050: Expand endpoint; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0051: Read endpoint; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0052: Validate endpoint; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0053: Profiles endpoint; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0054: Health endpoint; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0055: Amaze integration; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0056: Prompt policy; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0057: Fallback policy; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0058: Telemetry; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0059: Performance validation; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0060: Large repository simulation; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0061: Documentation; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0062: Final verification; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0063: Repository audit; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0064: Contract model creation; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0065: Scope enforcement; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0066: Budget enforcement; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0067: Collector base implementation; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0068: Graph collector; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0069: Lexical collector; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0070: AST grep collector; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0071: AST collector; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0072: LSP collector; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0073: Evidence normalization; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0074: Deduplication; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0075: Clustering; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0076: Ranking; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0077: Snippet extraction; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0078: Revision hashing; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0079: Plan store; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0080: Plan endpoint; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0081: Expand endpoint; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0082: Read endpoint; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0083: Validate endpoint; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0084: Profiles endpoint; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0085: Health endpoint; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0086: Amaze integration; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0087: Prompt policy; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0088: Fallback policy; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0089: Telemetry; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0090: Performance validation; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0091: Large repository simulation; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0092: Documentation; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0093: Final verification; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0094: Repository audit; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0095: Contract model creation; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0096: Scope enforcement; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0097: Budget enforcement; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0098: Collector base implementation; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0099: Graph collector; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0100: Lexical collector; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0101: AST grep collector; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0102: AST collector; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0103: LSP collector; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0104: Evidence normalization; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0105: Deduplication; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0106: Clustering; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0107: Ranking; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0108: Snippet extraction; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0109: Revision hashing; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0110: Plan store; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0111: Plan endpoint; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0112: Expand endpoint; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0113: Read endpoint; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0114: Validate endpoint; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0115: Profiles endpoint; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0116: Health endpoint; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0117: Amaze integration; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0118: Prompt policy; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0119: Fallback policy; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0120: Telemetry; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0121: Performance validation; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0122: Large repository simulation; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0123: Documentation; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0124: Final verification; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0125: Repository audit; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0126: Contract model creation; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0127: Scope enforcement; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0128: Budget enforcement; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0129: Collector base implementation; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0130: Graph collector; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0131: Lexical collector; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0132: AST grep collector; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0133: AST collector; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0134: LSP collector; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0135: Evidence normalization; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0136: Deduplication; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0137: Clustering; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0138: Ranking; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0139: Snippet extraction; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0140: Revision hashing; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0141: Plan store; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0142: Plan endpoint; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0143: Expand endpoint; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0144: Read endpoint; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0145: Validate endpoint; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0146: Profiles endpoint; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0147: Health endpoint; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0148: Amaze integration; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0149: Prompt policy; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0150: Fallback policy; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0151: Telemetry; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0152: Performance validation; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0153: Large repository simulation; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0154: Documentation; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0155: Final verification; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0156: Repository audit; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0157: Contract model creation; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0158: Scope enforcement; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0159: Budget enforcement; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0160: Collector base implementation; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0161: Graph collector; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0162: Lexical collector; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0163: AST grep collector; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0164: AST collector; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0165: LSP collector; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0166: Evidence normalization; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0167: Deduplication; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0168: Clustering; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0169: Ranking; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0170: Snippet extraction; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0171: Revision hashing; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0172: Plan store; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0173: Plan endpoint; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0174: Expand endpoint; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0175: Read endpoint; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0176: Validate endpoint; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0177: Profiles endpoint; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0178: Health endpoint; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0179: Amaze integration; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0180: Prompt policy; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0181: Fallback policy; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0182: Telemetry; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0183: Performance validation; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0184: Large repository simulation; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0185: Documentation; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0186: Final verification; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0187: Repository audit; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0188: Contract model creation; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0189: Scope enforcement; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0190: Budget enforcement; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0191: Collector base implementation; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0192: Graph collector; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0193: Lexical collector; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0194: AST grep collector; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0195: AST collector; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0196: LSP collector; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0197: Evidence normalization; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0198: Deduplication; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0199: Clustering; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0200: Ranking; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0201: Snippet extraction; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0202: Revision hashing; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0203: Plan store; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0204: Plan endpoint; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0205: Expand endpoint; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0206: Read endpoint; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0207: Validate endpoint; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0208: Profiles endpoint; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0209: Health endpoint; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0210: Amaze integration; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0211: Prompt policy; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0212: Fallback policy; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0213: Telemetry; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0214: Performance validation; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0215: Large repository simulation; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0216: Documentation; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0217: Final verification; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0218: Repository audit; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0219: Contract model creation; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0220: Scope enforcement; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0221: Budget enforcement; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0222: Collector base implementation; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0223: Graph collector; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0224: Lexical collector; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0225: AST grep collector; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0226: AST collector; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0227: LSP collector; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0228: Evidence normalization; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0229: Deduplication; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0230: Clustering; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0231: Ranking; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0232: Snippet extraction; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0233: Revision hashing; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0234: Plan store; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0235: Plan endpoint; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0236: Expand endpoint; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0237: Read endpoint; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0238: Validate endpoint; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0239: Profiles endpoint; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0240: Health endpoint; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0241: Amaze integration; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0242: Prompt policy; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0243: Fallback policy; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0244: Telemetry; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0245: Performance validation; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0246: Large repository simulation; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0247: Documentation; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0248: Final verification; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0249: Repository audit; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0250: Contract model creation; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0251: Scope enforcement; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0252: Budget enforcement; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0253: Collector base implementation; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0254: Graph collector; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0255: Lexical collector; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0256: AST grep collector; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0257: AST collector; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0258: LSP collector; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0259: Evidence normalization; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0260: Deduplication; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0261: Clustering; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0262: Ranking; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0263: Snippet extraction; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0264: Revision hashing; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0265: Plan store; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0266: Plan endpoint; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0267: Expand endpoint; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0268: Read endpoint; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0269: Validate endpoint; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0270: Profiles endpoint; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0271: Health endpoint; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0272: Amaze integration; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0273: Prompt policy; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0274: Fallback policy; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0275: Telemetry; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0276: Performance validation; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0277: Large repository simulation; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0278: Documentation; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0279: Final verification; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0280: Repository audit; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0281: Contract model creation; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0282: Scope enforcement; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0283: Budget enforcement; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0284: Collector base implementation; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0285: Graph collector; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0286: Lexical collector; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0287: AST grep collector; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0288: AST collector; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0289: LSP collector; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0290: Evidence normalization; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0291: Deduplication; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0292: Clustering; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0293: Ranking; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0294: Snippet extraction; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0295: Revision hashing; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0296: Plan store; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0297: Plan endpoint; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0298: Expand endpoint; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0299: Read endpoint; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0300: Validate endpoint; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0301: Profiles endpoint; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0302: Health endpoint; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0303: Amaze integration; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0304: Prompt policy; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0305: Fallback policy; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0306: Telemetry; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0307: Performance validation; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0308: Large repository simulation; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0309: Documentation; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0310: Final verification; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0311: Repository audit; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0312: Contract model creation; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0313: Scope enforcement; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0314: Budget enforcement; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0315: Collector base implementation; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0316: Graph collector; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0317: Lexical collector; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0318: AST grep collector; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0319: AST collector; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0320: LSP collector; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0321: Evidence normalization; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0322: Deduplication; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0323: Clustering; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0324: Ranking; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0325: Snippet extraction; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0326: Revision hashing; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0327: Plan store; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0328: Plan endpoint; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0329: Expand endpoint; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0330: Read endpoint; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0331: Validate endpoint; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0332: Profiles endpoint; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0333: Health endpoint; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0334: Amaze integration; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0335: Prompt policy; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0336: Fallback policy; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0337: Telemetry; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0338: Performance validation; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0339: Large repository simulation; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0340: Documentation; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0341: Final verification; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0342: Repository audit; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0343: Contract model creation; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0344: Scope enforcement; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0345: Budget enforcement; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0346: Collector base implementation; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0347: Graph collector; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0348: Lexical collector; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0349: AST grep collector; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0350: AST collector; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0351: LSP collector; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0352: Evidence normalization; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0353: Deduplication; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0354: Clustering; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0355: Ranking; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0356: Snippet extraction; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0357: Revision hashing; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0358: Plan store; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0359: Plan endpoint; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0360: Expand endpoint; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0361: Read endpoint; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0362: Validate endpoint; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0363: Profiles endpoint; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0364: Health endpoint; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0365: Amaze integration; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0366: Prompt policy; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0367: Fallback policy; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0368: Telemetry; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0369: Performance validation; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0370: Large repository simulation; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0371: Documentation; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0372: Final verification; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0373: Repository audit; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0374: Contract model creation; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0375: Scope enforcement; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0376: Budget enforcement; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0377: Collector base implementation; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0378: Graph collector; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0379: Lexical collector; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0380: AST grep collector; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0381: AST collector; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0382: LSP collector; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0383: Evidence normalization; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0384: Deduplication; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0385: Clustering; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0386: Ranking; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0387: Snippet extraction; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0388: Revision hashing; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0389: Plan store; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0390: Plan endpoint; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0391: Expand endpoint; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0392: Read endpoint; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0393: Validate endpoint; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0394: Profiles endpoint; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0395: Health endpoint; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0396: Amaze integration; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0397: Prompt policy; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0398: Fallback policy; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0399: Telemetry; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0400: Performance validation; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0401: Large repository simulation; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0402: Documentation; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0403: Final verification; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0404: Repository audit; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0405: Contract model creation; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0406: Scope enforcement; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0407: Budget enforcement; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0408: Collector base implementation; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0409: Graph collector; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0410: Lexical collector; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0411: AST grep collector; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0412: AST collector; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0413: LSP collector; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0414: Evidence normalization; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0415: Deduplication; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0416: Clustering; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0417: Ranking; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0418: Snippet extraction; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0419: Revision hashing; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0420: Plan store; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0421: Plan endpoint; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0422: Expand endpoint; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0423: Read endpoint; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0424: Validate endpoint; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0425: Profiles endpoint; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0426: Health endpoint; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0427: Amaze integration; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0428: Prompt policy; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0429: Fallback policy; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0430: Telemetry; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0431: Performance validation; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0432: Large repository simulation; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0433: Documentation; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0434: Final verification; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0435: Repository audit; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0436: Contract model creation; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0437: Scope enforcement; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0438: Budget enforcement; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0439: Collector base implementation; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0440: Graph collector; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0441: Lexical collector; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0442: AST grep collector; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0443: AST collector; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0444: LSP collector; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0445: Evidence normalization; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0446: Deduplication; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0447: Clustering; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0448: Ranking; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0449: Snippet extraction; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0450: Revision hashing; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0451: Plan store; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0452: Plan endpoint; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0453: Expand endpoint; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0454: Read endpoint; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0455: Validate endpoint; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0456: Profiles endpoint; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0457: Health endpoint; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0458: Amaze integration; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0459: Prompt policy; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0460: Fallback policy; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0461: Telemetry; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0462: Performance validation; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0463: Large repository simulation; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0464: Documentation; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0465: Final verification; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0466: Repository audit; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0467: Contract model creation; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0468: Scope enforcement; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0469: Budget enforcement; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0470: Collector base implementation; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0471: Graph collector; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0472: Lexical collector; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0473: AST grep collector; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0474: AST collector; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0475: LSP collector; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0476: Evidence normalization; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0477: Deduplication; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0478: Clustering; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0479: Ranking; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0480: Snippet extraction; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0481: Revision hashing; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0482: Plan store; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0483: Plan endpoint; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0484: Expand endpoint; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0485: Read endpoint; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0486: Validate endpoint; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0487: Profiles endpoint; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0488: Health endpoint; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0489: Amaze integration; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0490: Prompt policy; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0491: Fallback policy; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0492: Telemetry; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0493: Performance validation; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0494: Large repository simulation; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0495: Documentation; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0496: Final verification; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0497: Repository audit; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0498: Contract model creation; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0499: Scope enforcement; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0500: Budget enforcement; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0501: Collector base implementation; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0502: Graph collector; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0503: Lexical collector; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0504: AST grep collector; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0505: AST collector; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0506: LSP collector; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0507: Evidence normalization; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0508: Deduplication; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0509: Clustering; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0510: Ranking; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0511: Snippet extraction; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0512: Revision hashing; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0513: Plan store; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0514: Plan endpoint; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0515: Expand endpoint; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0516: Read endpoint; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0517: Validate endpoint; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0518: Profiles endpoint; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0519: Health endpoint; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0520: Amaze integration; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0521: Prompt policy; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0522: Fallback policy; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0523: Telemetry; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0524: Performance validation; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0525: Large repository simulation; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0526: Documentation; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0527: Final verification; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0528: Repository audit; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0529: Contract model creation; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0530: Scope enforcement; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0531: Budget enforcement; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0532: Collector base implementation; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0533: Graph collector; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0534: Lexical collector; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0535: AST grep collector; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0536: AST collector; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0537: LSP collector; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0538: Evidence normalization; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0539: Deduplication; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0540: Clustering; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0541: Ranking; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0542: Snippet extraction; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0543: Revision hashing; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0544: Plan store; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0545: Plan endpoint; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0546: Expand endpoint; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0547: Read endpoint; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0548: Validate endpoint; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0549: Profiles endpoint; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0550: Health endpoint; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0551: Amaze integration; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0552: Prompt policy; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0553: Fallback policy; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0554: Telemetry; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0555: Performance validation; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0556: Large repository simulation; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0557: Documentation; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0558: Final verification; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0559: Repository audit; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0560: Contract model creation; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0561: Scope enforcement; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0562: Budget enforcement; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0563: Collector base implementation; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0564: Graph collector; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0565: Lexical collector; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0566: AST grep collector; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0567: AST collector; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0568: LSP collector; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0569: Evidence normalization; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0570: Deduplication; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0571: Clustering; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0572: Ranking; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0573: Snippet extraction; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0574: Revision hashing; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0575: Plan store; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0576: Plan endpoint; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0577: Expand endpoint; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0578: Read endpoint; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0579: Validate endpoint; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0580: Profiles endpoint; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0581: Health endpoint; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0582: Amaze integration; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0583: Prompt policy; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0584: Fallback policy; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0585: Telemetry; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0586: Performance validation; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0587: Large repository simulation; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0588: Documentation; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0589: Final verification; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0590: Repository audit; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0591: Contract model creation; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0592: Scope enforcement; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0593: Budget enforcement; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0594: Collector base implementation; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0595: Graph collector; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0596: Lexical collector; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0597: AST grep collector; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0598: AST collector; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0599: LSP collector; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0600: Evidence normalization; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0601: Deduplication; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0602: Clustering; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0603: Ranking; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0604: Snippet extraction; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0605: Revision hashing; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0606: Plan store; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0607: Plan endpoint; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0608: Expand endpoint; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0609: Read endpoint; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0610: Validate endpoint; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0611: Profiles endpoint; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0612: Health endpoint; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0613: Amaze integration; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0614: Prompt policy; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0615: Fallback policy; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0616: Telemetry; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0617: Performance validation; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0618: Large repository simulation; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0619: Documentation; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0620: Final verification; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0621: Repository audit; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0622: Contract model creation; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0623: Scope enforcement; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0624: Budget enforcement; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0625: Collector base implementation; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0626: Graph collector; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0627: Lexical collector; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0628: AST grep collector; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0629: AST collector; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0630: LSP collector; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0631: Evidence normalization; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0632: Deduplication; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0633: Clustering; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0634: Ranking; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0635: Snippet extraction; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0636: Revision hashing; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0637: Plan store; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0638: Plan endpoint; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0639: Expand endpoint; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0640: Read endpoint; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0641: Validate endpoint; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0642: Profiles endpoint; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0643: Health endpoint; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0644: Amaze integration; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0645: Prompt policy; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0646: Fallback policy; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0647: Telemetry; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0648: Performance validation; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0649: Large repository simulation; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0650: Documentation; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0651: Final verification; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0652: Repository audit; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0653: Contract model creation; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0654: Scope enforcement; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0655: Budget enforcement; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0656: Collector base implementation; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0657: Graph collector; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0658: Lexical collector; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0659: AST grep collector; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0660: AST collector; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0661: LSP collector; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0662: Evidence normalization; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0663: Deduplication; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0664: Clustering; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0665: Ranking; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0666: Snippet extraction; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0667: Revision hashing; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0668: Plan store; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0669: Plan endpoint; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0670: Expand endpoint; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0671: Read endpoint; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0672: Validate endpoint; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0673: Profiles endpoint; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0674: Health endpoint; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0675: Amaze integration; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0676: Prompt policy; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0677: Fallback policy; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0678: Telemetry; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0679: Performance validation; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0680: Large repository simulation; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0681: Documentation; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0682: Final verification; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0683: Repository audit; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0684: Contract model creation; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0685: Scope enforcement; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0686: Budget enforcement; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0687: Collector base implementation; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0688: Graph collector; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0689: Lexical collector; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0690: AST grep collector; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0691: AST collector; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0692: LSP collector; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0693: Evidence normalization; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0694: Deduplication; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0695: Clustering; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0696: Ranking; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0697: Snippet extraction; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0698: Revision hashing; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0699: Plan store; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0700: Plan endpoint; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0701: Expand endpoint; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0702: Read endpoint; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0703: Validate endpoint; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0704: Profiles endpoint; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0705: Health endpoint; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0706: Amaze integration; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0707: Prompt policy; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0708: Fallback policy; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0709: Telemetry; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0710: Performance validation; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0711: Large repository simulation; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0712: Documentation; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0713: Final verification; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0714: Repository audit; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0715: Contract model creation; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0716: Scope enforcement; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0717: Budget enforcement; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0718: Collector base implementation; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0719: Graph collector; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0720: Lexical collector; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0721: AST grep collector; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0722: AST collector; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0723: LSP collector; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0724: Evidence normalization; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0725: Deduplication; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0726: Clustering; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0727: Ranking; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0728: Snippet extraction; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0729: Revision hashing; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0730: Plan store; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0731: Plan endpoint; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0732: Expand endpoint; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0733: Read endpoint; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0734: Validate endpoint; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0735: Profiles endpoint; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0736: Health endpoint; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0737: Amaze integration; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0738: Prompt policy; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0739: Fallback policy; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0740: Telemetry; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0741: Performance validation; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0742: Large repository simulation; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0743: Documentation; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0744: Final verification; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0745: Repository audit; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0746: Contract model creation; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0747: Scope enforcement; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0748: Budget enforcement; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0749: Collector base implementation; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0750: Graph collector; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0751: Lexical collector; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0752: AST grep collector; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0753: AST collector; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0754: LSP collector; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0755: Evidence normalization; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0756: Deduplication; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0757: Clustering; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0758: Ranking; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0759: Snippet extraction; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0760: Revision hashing; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0761: Plan store; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0762: Plan endpoint; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0763: Expand endpoint; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0764: Read endpoint; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0765: Validate endpoint; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0766: Profiles endpoint; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0767: Health endpoint; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0768: Amaze integration; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0769: Prompt policy; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0770: Fallback policy; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0771: Telemetry; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0772: Performance validation; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0773: Large repository simulation; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0774: Documentation; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0775: Final verification; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0776: Repository audit; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0777: Contract model creation; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0778: Scope enforcement; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0779: Budget enforcement; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0780: Collector base implementation; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0781: Graph collector; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0782: Lexical collector; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0783: AST grep collector; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0784: AST collector; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0785: LSP collector; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0786: Evidence normalization; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0787: Deduplication; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0788: Clustering; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0789: Ranking; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0790: Snippet extraction; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0791: Revision hashing; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0792: Plan store; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0793: Plan endpoint; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0794: Expand endpoint; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0795: Read endpoint; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0796: Validate endpoint; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0797: Profiles endpoint; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0798: Health endpoint; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0799: Amaze integration; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0800: Prompt policy; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0801: Fallback policy; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0802: Telemetry; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0803: Performance validation; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0804: Large repository simulation; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0805: Documentation; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0806: Final verification; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0807: Repository audit; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0808: Contract model creation; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0809: Scope enforcement; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0810: Budget enforcement; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0811: Collector base implementation; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0812: Graph collector; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0813: Lexical collector; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0814: AST grep collector; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0815: AST collector; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0816: LSP collector; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0817: Evidence normalization; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0818: Deduplication; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0819: Clustering; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0820: Ranking; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0821: Snippet extraction; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0822: Revision hashing; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0823: Plan store; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0824: Plan endpoint; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0825: Expand endpoint; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0826: Read endpoint; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0827: Validate endpoint; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0828: Profiles endpoint; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0829: Health endpoint; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0830: Amaze integration; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0831: Prompt policy; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0832: Fallback policy; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0833: Telemetry; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0834: Performance validation; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0835: Large repository simulation; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0836: Documentation; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0837: Final verification; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0838: Repository audit; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0839: Contract model creation; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0840: Scope enforcement; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0841: Budget enforcement; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0842: Collector base implementation; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0843: Graph collector; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0844: Lexical collector; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0845: AST grep collector; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0846: AST collector; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0847: LSP collector; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0848: Evidence normalization; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0849: Deduplication; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0850: Clustering; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0851: Ranking; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0852: Snippet extraction; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0853: Revision hashing; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0854: Plan store; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0855: Plan endpoint; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0856: Expand endpoint; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0857: Read endpoint; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0858: Validate endpoint; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0859: Profiles endpoint; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0860: Health endpoint; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0861: Amaze integration; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0862: Prompt policy; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0863: Fallback policy; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0864: Telemetry; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0865: Performance validation; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0866: Large repository simulation; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0867: Documentation; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0868: Final verification; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0869: Repository audit; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0870: Contract model creation; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0871: Scope enforcement; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0872: Budget enforcement; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0873: Collector base implementation; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0874: Graph collector; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0875: Lexical collector; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0876: AST grep collector; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0877: AST collector; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0878: LSP collector; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0879: Evidence normalization; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0880: Deduplication; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0881: Clustering; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0882: Ranking; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0883: Snippet extraction; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0884: Revision hashing; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0885: Plan store; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0886: Plan endpoint; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0887: Expand endpoint; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0888: Read endpoint; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0889: Validate endpoint; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0890: Profiles endpoint; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0891: Health endpoint; profile=find_definition; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0892: Amaze integration; profile=trace_impact; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0893: Prompt policy; profile=bug_investigation; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0894: Fallback policy; profile=implementation_planning; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0895: Telemetry; profile=test_discovery; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0896: Performance validation; profile=config_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0897: Large repository simulation; profile=api_route_lookup; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0898: Documentation; profile=architecture_overview; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0899: Final verification; profile=memory_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.
- [ ] Ledger 0900: Repository audit; profile=codebase_contract; verify one concrete behavior with a failing test, bounded implementation, targeted command, and recorded result.

## 28. Appendices

### Appendix A: Default Excluded Directories
- .git
- .rocky
- .venv
- __pycache__
- node_modules
- vendor
- build
- dist
- coverage
- .harness

### Appendix B: Response Anti-Patterns
- Returning every grep hit
- Returning every LSP reference
- Returning full AST dumps
- Returning file contents without line budget
- Summarizing with an LLM by default
- Hiding effective roots
- Expanding parent folders implicitly
- Dropping file revision tokens

### Appendix C: Good Response Traits
- Small primary read point list
- Deterministic deferred cluster labels
- Explicit next actions
- Budget usage visible
- Staleness visible
- Collector degradation visible
- No raw candidate flood
- Progressive expansion possible

## 29. Final Handoff Prompt

Use this prompt when starting a new goal from this document:

```text
Implement the Rocky Codebase Profile Engine from docs/rocky-codebase-profile-engine-goal.md. Work incrementally with tests first. Preserve existing Rocky and Amaze behavior. Do not return raw candidate floods. Make Rocky the single profile-driven codebase intelligence point for locate/read/expand/validate.
```

