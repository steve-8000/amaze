## Code Review Request

### Mode

Custom review instructions

### Distribution Guidelines

Use the `task` tool with `agent: "checker"` and a `tasks` array.
Create exactly **1 checker task**. Its assignment MUST include the custom instructions below.

### Checker Instructions

Checker MUST:
1. Follow the custom instructions below
2. Read the referenced files or workspace context needed to evaluate them
3. Call `report_finding` per issue
4. Call `yield` with verdict when done

### Custom Instructions

{{instructions}}
