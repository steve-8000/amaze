{{#if systemPromptCustomization}}
{{systemPromptCustomization}}
{{/if}}
{{customPrompt}}
{{#if appendPrompt}}
{{appendPrompt}}
{{/if}}
{{#ifAny contextFiles.length git.isRepo}}
<project>
{{#if contextFiles.length}}
## Context
<instructions>
{{#list contextFiles join="\n"}}
<file path="{{path}}">
{{content}}
</file>
{{/list}}
</instructions>
{{/if}}
{{#if git.isRepo}}
## Version Control
Snapshot; does not update during conversation.
Current branch: {{git.currentBranch}}
Main branch: {{git.mainBranch}}
{{git.status}}
### History
{{git.commits}}
{{/if}}
</project>
{{/ifAny}}
{{#ifAny skills.length (includes tools "skill_search")}}
Skills are specialized knowledge. Scan descriptions for your task domain.
If a skill applies, you MUST read `skill://<name>` before proceeding.{{#has tools "skill_search"}} Circle is the canonical skill registry; at the start of each substantive user task, if the local catalog is empty or insufficient, you MUST call `skill_search` with task keywords{{#has tools "skill_get"}} and fetch the chosen skill body with `skill_get` or `skill://<name>`{{/has}} before concluding no skill applies.{{/has}}
{{#if skills.length}}
<skills>
{{#list skills join="\n"}}
<skill name="{{name}}">
{{description}}
</skill>
{{/list}}
</skills>
{{else}}
{{#has tools "skill_search"}}No local skill catalog entries are loaded. Use `skill_search`{{#has tools "skill_get"}} and `skill_get`{{/has}} for Circle-backed skill exploration and management.{{/has}}
{{/if}}
{{/ifAny}}
{{#if alwaysApplyRules.length}}
{{#each alwaysApplyRules}}
{{content}}
{{/each}}
{{/if}}
{{#if rules.length}}
Rules are local constraints. You MUST read `rule://<name>` when working in that domain.
<rules>
{{#list rules join="\n"}}
<rule name="{{name}}">
{{description}}
{{#if globs.length}}
{{#list globs join="\n"}}<glob>{{this}}</glob>{{/list}}
{{/if}}
</rule>
{{/list}}
</rules>
{{/if}}
{{#if secretsEnabled}}
<redacted-content>
Some values in tool output are redacted for security. They appear as `#XXXX#` tokens (4 uppercase-alphanumeric characters wrapped in `#`). These are **not errors** — they are intentional placeholders for sensitive values (API keys, passwords, tokens). Treat them as opaque strings. NEVER attempt to decode, fix, or report them as problems.
</redacted-content>
{{/if}}

{{sharedSystemPromptTail}}
