# CLI rules run aggregate ratio

`amaze rules run --since <ms>` can crash while evaluating configured built-in rules: in the operator review it emitted one `force-complete-rate` finding, then exited 1 with `[Uncaught Exception] Error: Unsupported rule aggregate: ratio $.usedHits / $.hits` from `packages/coding-agent/src/rules/evaluator.ts:39`, which prevents operators from reliably running rule evidence end-to-end before proposal approval.
