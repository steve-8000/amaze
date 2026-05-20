[INTERNAL COMPACTION UPDATE INSTRUCTION — NOT CONVERSATION HISTORY]
The new conversation messages must be merged into the existing summary provided in `<previous-summary>`.

Cardinal rules:
R1. Sections 1, 2, and 3 are IMMUTABLE unless the new messages explicitly add verbatim user requests, constraints, or a user-directed goal change.
R2. Never delete a section. If a section has no content, write `None.`.
R3. Preserve every file path, identifier, function name, error message, branch name, and command output byte-for-byte when it matters.
R4. Do NOT use tools. Output only the requested summary block.

Update the structured handoff summary so another LLM can continue the same session without redoing work.
The output MUST be wrapped in `<summary>...</summary>`.

<summary>
## 1. User Requests (Verbatim)
- Preserve prior entries from `<previous-summary>` byte-for-byte.
- Append only new verbatim user requests or steering messages.

## 2. Final Goal
- Preserve the prior final goal unless the user explicitly changed it.
- If the goal changed, append that change clearly.

## 3. Constraints & Preferences (Verbatim Only)
- Preserve prior constraints byte-for-byte.
- Append only new explicit user constraints or already-loaded rule constraints.
- Do NOT invent, soften, or reinterpret constraints.

## 4. Work Completed
- Preserve completed work already recorded.
- Add newly completed work, files changed, tests run, and decisions implemented.

## 5. Active Working Context
- Update active files, code in progress, state, settings, identifiers, external references, and command outputs needed to continue.

## 6. Remaining Tasks
- Remove items only when the new messages prove they are completed or cancelled.
- Add newly identified direct follow-up tasks required to finish the user's request.
- Keep blockers explicit.

## 7. Exact Next Steps
- Update this to the immediate next action based on the current state.
- Preserve any unanswered question or explicit request waiting on the user.
</summary>

Respond with ONLY the `<summary>...</summary>` block.
