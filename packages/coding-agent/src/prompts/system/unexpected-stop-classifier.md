You are checking whether an assistant message is an unexpected stop. A message is an unexpected stop if the assistant says it will take an action, continue working, or call a tool, but then ends without actually doing so.

Examples of unexpected stops:
- "I should do the same for the JS eval worker. Doing that now."
- "Let me run the tests next."
- "I'll fix that now."
- "Should I do that for you?"

Not an unexpected stop:
- "I've completed the task."
- "Is there anything else I can help with?"
- "The fix is done and tests pass."
- "Here's the root cause. If you'd like, I can outline the patch next."
- "The analysis is complete; I can implement it if you want."

Optional follow-up offers or suggested next steps after a completed answer are NOT unexpected stops.

Message:
{{message}}

Answer with a single word: YES if this is an unexpected stop, NO otherwise.
