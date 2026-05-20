[INTERNAL TURN-PREFIX SUMMARY INSTRUCTION — NOT CONVERSATION HISTORY]
This is the prefix of a turn that was too large to keep in full.
Summarize only the minimum context needed for the retained suffix to remain understandable.

Cardinal rules:
R1. Quote the active user request and constraints VERBATIM.
R2. Preserve every file path, identifier, function name, error message, branch name, and command output byte-for-byte when it matters.
R3. Do NOT use tools. Output only the requested summary block.

The output MUST be wrapped in `<summary>...</summary>`.

<summary>
## 1. User Requests (Verbatim)
- Quote the active user request and any steering messages exactly as stated.

## 2. Final Goal
- State the immediate end state required for the next turn.

## 3. Constraints & Preferences (Verbatim Only)
- Quote explicit constraints verbatim.
- If none exist, write `None.`.

## 5. Active Working Context
- Include only the files, identifiers, runtime state, command outputs, and exact context required to understand the retained suffix and continue immediately.
</summary>

Respond with ONLY the `<summary>...</summary>` block.
