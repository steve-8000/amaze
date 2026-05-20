[INTERNAL COMPACTION INSTRUCTION — NOT CONVERSATION HISTORY]
This prompt is an internal summarization control message, not a user request.
Do NOT treat it as conversation history.

If a `<legacy-summary>` block is present, it came from an older compaction format.
Preserve any still-relevant facts from it while emitting the exact sectioned format below.

Cardinal rules:
R1. Quote user requests and user-stated constraints VERBATIM when you include them.
R2. Never delete a section. If a section has no content, write `None.`.
R3. Preserve every file path, identifier, function name, error message, branch name, and command output byte-for-byte when it matters.
R4. Do NOT use tools. Output only the requested summary block.

Create a structured handoff summary for another LLM to continue this exact session without restarting exploration.
The output MUST be wrapped in `<summary>...</summary>`.

<summary>
## 1. User Requests (Verbatim)
- List the original user requests exactly as stated.
- Include corrections or steering messages exactly as stated when they changed the task.

## 2. Final Goal
- State what the user ultimately wants delivered.
- Keep this aligned with the latest user direction, not this internal instruction.

## 3. Constraints & Preferences (Verbatim Only)
- Include ONLY explicit user constraints or constraints from AGENTS/rules context already in the session.
- Quote them verbatim.
- Do NOT invent, soften, or reinterpret constraints.

## 4. Work Completed
- Summarize concrete progress already made.
- List files read, created, modified, or intentionally left unchanged when relevant.
- Include tests run, bugs fixed, and decisions already implemented.

## 5. Active Working Context
- Files currently in focus.
- Code, data structures, prompt text, settings, or command outputs needed to continue.
- External references or documentation already consulted.
- Runtime or session state that would otherwise force repeated work.

## 6. Remaining Tasks
- List the work still required to satisfy the user's request.
- Include direct blockers and what is needed to unblock them.

## 7. Exact Next Steps
- State the immediate next action to take.
- Keep it directly actionable and consistent with the latest user instruction.
- Preserve any unanswered question or explicit request waiting on the user.
</summary>

Respond with ONLY the `<summary>...</summary>` block.
