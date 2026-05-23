# T11.10 — Operator CLI review
> **Ticket**: T11.10
> **Phase**: P2
> **Status**: landed (2026-05-23)
> **Closing**: docs/Phase2/closing-report.md

## Current state (grounded)

Phase1 shipped these CLI subcommands:

- `amaze observe ...` — observability JSONL access.
- `amaze rules ...` — list/show/lint/eval rules.
- `amaze proposals ...` — list/show/approve/reject/apply.
- `amaze metrics ...` — show/window.
- `amaze objective ...` — autonomy objective CRUD (feature-flagged).
- `amaze memory ...` — search/migrate-legacy/doctor.
- `amaze doctor` — overall health.

None have been exercised end-to-end as an operator workflow.

## Acceptance

1. Walk-through doc `docs/Phase2/operator-cli-review.md` exists, structured as:
   - Scenario A: "I want to know how often I force-completed last week."
   - Scenario B: "A rule flagged a proposal. I want to read the evidence, run the sandbox replay, and approve."
   - Scenario C: "Memory recall returned stale facts. I want to find them, mark superseded, and re-search."
   - Scenario D: "Autonomy is OFF but I want to preview what a metric→sub-goal proposal would look like."
   - Scenario E: "Something is wrong. Where do I look first?" → `amaze doctor` walkthrough.
   For each scenario: literal command sequence, observed output (recorded from a real run), and a verdict (`works | friction | missing-affordance`).
2. Every `friction` and `missing-affordance` row gets a Phase3 ticket stub under `docs/Phase3/cli-<slug>.md`.
3. No CLI code changes in T11.10 itself — this is a review pass. Any change found necessary is captured as a Phase3 ticket. (Exception: if a scenario uncovers an outright crash, that is a Phase2 bug; escalate via IRC.)

## Implementation outline

1. In a temp working dir, scripted scenario runs producing real JSONL/SQLite state.
2. Run each subcommand sequence, capture stdout/stderr verbatim.
3. Write the doc with command/output blocks.
4. For each gap identified, create a Phase3 stub with a one-paragraph problem statement.

## Boundaries

- Touch: `docs/Phase2/operator-cli-review.md` (new), `docs/Phase3/cli-*.md` (stubs as needed).
- Do not modify CLI sources.
- Do not modify tests.

## Verification

- Doc exists with all 5 scenarios.
- Every `friction`/`missing-affordance` row links to a Phase3 stub file that actually exists.
