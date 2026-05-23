# CLI memory stale fact workflow
> **Status**: superseded-by: docs/Phase3/03_memory_workflow_cli.md


The operator CLI does not support the stale-memory recovery workflow described in Phase2: `amaze memory` currently exposes `doctor` and `migrate-legacy`, but not memory search, stale-hit inspection, mark-superseded/quarantine, or re-search commands, so an operator cannot find stale facts, mark them superseded, and verify recall from the CLI.

See: docs/Phase3/03_memory_workflow_cli.md
