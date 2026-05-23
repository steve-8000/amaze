# CLI root doctor

The Phase2 operator review found no registered root `amaze doctor` command: `amaze doctor --help` is treated as default launch help because unknown subcommands route to `launch`, leaving operators to discover separate diagnostics such as `memory doctor`, `metrics show`, `rules run`, and observability exports instead of starting from one health-check entry point.
