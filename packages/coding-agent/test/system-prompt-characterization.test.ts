import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Personality } from "@steve-z8k/pi-coding-agent/config/settings-schema";
import {
	type BuildSystemPromptOptions,
	buildSystemPrompt,
	type SystemPromptToolMetadata,
} from "@steve-z8k/pi-coding-agent/system-prompt";
import { cleanupTempHome } from "./helpers/temp-home-cleanup";

/**
 * Phase 0 characterization coverage for `buildSystemPrompt`.
 *
 * These tests pin the CURRENT assembled behavior across the prompt matrix the
 * dynamic-prompt refactor will rework (default vs custom template, eager-task
 * delegation wording, tool-inventory rendering mode, secret-redaction guidance,
 * personality presets, and MCP discovery). Assertions target structure and the
 * presence/absence of section markers rather than whole-string snapshots, so the
 * refactor can move text around as long as each behavior is preserved.
 */

const EMPTY_TREE = {
	rootPath: "",
	rendered: "",
	truncated: false,
	totalLines: 0,
	agentsMdFiles: [],
};

// A small but representative tool metadata map so inventory rendering has labels,
// descriptions, and schemas to work with.
const TOOLS = new Map<string, SystemPromptToolMetadata>([
	[
		"read",
		{
			label: "Read",
			description: "Reads files from disk.",
			parameters: { type: "object", properties: { path: { type: "string" } } },
		},
	],
	[
		"bash",
		{
			label: "Bash",
			description: "Executes a shell command.",
			parameters: { type: "object", properties: { command: { type: "string" } } },
		},
	],
]);

describe("buildSystemPrompt characterization", () => {
	let tempDir = "";
	let tempHomeDir = "";
	let originalHome: string | undefined;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-prompt-char-"));
		tempHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-prompt-char-home-"));
		originalHome = process.env.HOME;
		process.env.HOME = tempHomeDir;
	});

	afterEach(cleanupTempHome(() => ({ tempDir, tempHomeDir, originalHome })));

	/**
	 * Render the prompt with deterministic, discovery-free defaults. Every
	 * filesystem-backed input (context files, skills, rules, workspace tree) is
	 * supplied explicitly so the output depends only on the option matrix.
	 */
	async function render(overrides: Partial<BuildSystemPromptOptions> = {}): Promise<string> {
		const { systemPrompt } = await buildSystemPrompt({
			cwd: tempDir,
			contextFiles: [],
			skills: [],
			rules: [],
			toolNames: [],
			workspaceTree: { ...EMPTY_TREE, rootPath: tempDir },
			...overrides,
		});
		return systemPrompt.join("\n\n");
	}

	// A phrase unique to the built-in default ROLE preamble. Its presence
	// distinguishes the default template from the custom-prompt template.
	const DEFAULT_ROLE_MARKER = "You are a helpful assistant the team trusts with load-bearing changes";

	describe("default vs custom prompt", () => {
		it("renders the built-in role preamble and a structured result by default", async () => {
			const { systemPrompt } = await buildSystemPrompt({
				cwd: tempDir,
				contextFiles: [],
				skills: [],
				rules: [],
				toolNames: [],
				workspaceTree: { ...EMPTY_TREE, rootPath: tempDir },
			});

			// The builder returns an ordered, non-empty block array (prompt body +
			// project footer), not a single concatenated string.
			expect(Array.isArray(systemPrompt)).toBe(true);
			expect(systemPrompt.length).toBeGreaterThanOrEqual(1);

			const text = systemPrompt.join("\n\n");
			expect(text).toContain(DEFAULT_ROLE_MARKER);
			// Shared scaffolding present in the default template.
			expect(text).toContain("TOOL POLICY");
			expect(text).toContain("DELIVERY CONTRACT");
		});

		it("renders a reviewable default prompt with assembled shared-tail and project footer markers", async () => {
			const text = await render();

			// Body template marker and unique default role wording.
			expect(text).toContain("ROLE\n==============");
			expect(text).toContain(DEFAULT_ROLE_MARKER);

			// Shared tail policy sections are rendered into the final prompt body.
			expect(text).toContain("TOOL POLICY");
			expect(text).toContain("DELIVERY CONTRACT");
			expect(text).toContain("# Circle MCP");

			// Project footer remains visible in the final assembled prompt.
			expect(text).toContain("PROJECT\n===================================");
			expect(text).toContain("<workstation>");

			// The shared-tail placeholder itself must be consumed during assembly.
			expect(text).not.toContain("{{sharedSystemPromptTail}}");
		});

		it("swaps in the custom-prompt template, dropping the built-in role preamble", async () => {
			const customPrompt = "CUSTOM-ROLE: act only as a haiku generator.";
			const text = await render({ customPrompt });

			// Caller-provided prompt body is rendered verbatim...
			expect(text).toContain(customPrompt);
			// ...and the default ROLE/engineering-principles preamble is replaced.
			expect(text).not.toContain(DEFAULT_ROLE_MARKER);
			// Shared tool-policy / delivery scaffolding still applies under the custom template.
			expect(text).toContain("TOOL POLICY");
			expect(text).toContain("DELIVERY CONTRACT");
		});
		it("renders the same shared policy tail for default and custom templates", async () => {
			const basePrompt = await buildSystemPrompt({
				cwd: tempDir,
				contextFiles: [],
				skills: [],
				rules: [],
				toolNames: [],
				workspaceTree: { ...EMPTY_TREE, rootPath: tempDir },
			});
			const customPrompt = await buildSystemPrompt({
				cwd: tempDir,
				contextFiles: [],
				skills: [],
				rules: [],
				toolNames: [],
				workspaceTree: { ...EMPTY_TREE, rootPath: tempDir },
				customPrompt: "CUSTOM-ROLE: act only as a haiku generator.",
			});

			const baseTailStart = basePrompt.systemPrompt[0].indexOf("# Internal URLs");
			const customTailStart = customPrompt.systemPrompt[0].indexOf("# Internal URLs");
			expect(baseTailStart).toBeGreaterThan(-1);
			expect(customTailStart).toBeGreaterThan(-1);
			expect(basePrompt.systemPrompt[0].slice(baseTailStart)).toEqual(
				customPrompt.systemPrompt[0].slice(customTailStart),
			);
		});
	});

	describe("eager tasks delegation", () => {
		// The delegation block only renders when the `task` tool is active.
		const eagerToolNames = ["read", "task"];

		it("omits delegation guidance when eagerTasks is off", async () => {
			const text = await render({ toolNames: eagerToolNames, eagerTasks: false });
			expect(text).not.toContain("Delegation is preferred");
			expect(text).not.toContain("Delegation is mandatory.");
			expect(text).not.toContain("## Delegation Rule");
		});

		it("uses the soft 'preferred' nudge for eagerTasks without always", async () => {
			const text = await render({
				toolNames: eagerToolNames,
				eagerTasks: true,
				eagerTasksAlways: false,
			});
			expect(text).toContain("Delegation is preferred");
			expect(text).not.toContain("Delegation is mandatory.");
			expect(text).not.toContain("## Delegation Rule");
		});

		it("uses the hard mandatory rule for eagerTasksAlways", async () => {
			const text = await render({
				toolNames: eagerToolNames,
				eagerTasks: true,
				eagerTasksAlways: true,
			});
			expect(text).toContain("## Delegation Rule");
			expect(text).toContain("Delegation is mandatory.");
			expect(text).not.toContain("Delegation is preferred");
		});

		it("gates batch-call guidance on taskBatch within the mandatory rule", async () => {
			const withBatch = await render({
				toolNames: eagerToolNames,
				eagerTasks: true,
				eagerTasksAlways: true,
				taskBatch: true,
			});
			expect(withBatch).toContain("one parallel `task` call");

			const withoutBatch = await render({
				toolNames: eagerToolNames,
				eagerTasks: true,
				eagerTasksAlways: true,
				taskBatch: false,
			});
			expect(withoutBatch).not.toContain("one parallel `task` call");
			// The mandatory rule itself still renders; only the batch nudge drops out.
			expect(withoutBatch).toContain("Delegation is mandatory.");
		});

		it("renders no delegation block when eagerTasks is set but the task tool is absent", async () => {
			const text = await render({ toolNames: ["read"], eagerTasks: true, eagerTasksAlways: true });
			expect(text).not.toContain("## Delegation Rule");
			expect(text).not.toContain("Delegation is mandatory.");
		});
	});

	describe("tool inventory rendering mode", () => {
		const inventoryOpts: Partial<BuildSystemPromptOptions> = {
			toolNames: ["read", "bash"],
			tools: TOOLS,
		};

		it("renders a compact name list when native tools are active and descriptors stay in schemas", async () => {
			const text = await render({ ...inventoryOpts, nativeTools: true, inlineToolDescriptors: false });
			expect(text).toContain("- Read: `read`");
			expect(text).toContain("- Bash: `bash`");
			// No full per-tool sections nor inlined descriptions in list mode.
			expect(text).not.toContain("# Tool: read");
			expect(text).not.toContain("Reads files from disk.");
		});

		it("renders full per-tool sections when native tool calling is off", async () => {
			const text = await render({ ...inventoryOpts, nativeTools: false, inlineToolDescriptors: false });
			expect(text).toContain("# Tool: read");
			expect(text).toContain("# Tool: bash");
			expect(text).toContain("Reads files from disk.");
			expect(text).not.toContain("- Read: `read`");
		});

		it("renders full per-tool sections when descriptors are inlined even with native tools", async () => {
			const text = await render({ ...inventoryOpts, nativeTools: true, inlineToolDescriptors: true });
			expect(text).toContain("# Tool: read");
			expect(text).toContain("Executes a shell command.");
			expect(text).not.toContain("- Read: `read`");
		});
	});

	describe("secret redaction guidance", () => {
		it("omits redaction guidance by default", async () => {
			const text = await render();
			expect(text).not.toContain("#XXXX#");
		});

		it("explains the redaction token in the default template when secretsEnabled", async () => {
			const text = await render({ secretsEnabled: true });
			expect(text).toContain("Redacted `#XXXX#` tokens in output are opaque strings.");
		});

		it("explains redaction with the detailed block in the custom-prompt template", async () => {
			const text = await render({
				customPrompt: "CUSTOM-ROLE: act only as a haiku generator.",
				secretsEnabled: true,
			});
			expect(text).toContain("<redacted-content>");
			expect(text).toContain("#XXXX#");
			expect(text).toContain("</redacted-content>");
		});
	});

	describe("personality presets", () => {
		async function renderPersonality(personality?: Personality): Promise<string> {
			return render({ personality });
		}

		it("injects the default personality preset when unset", async () => {
			const text = await renderPersonality();
			expect(text).toContain("<personality>");
			expect(text).toContain("</personality>");
			expect(text).toContain("terse, evidence-first engineer");
		});

		it("renders the friendly preset and drops the default spec", async () => {
			const text = await renderPersonality("friendly");
			expect(text).toContain("<personality>");
			expect(text).toContain("warm, supportive collaborator");
			expect(text).not.toContain("terse, evidence-first engineer");
		});

		it("renders the pragmatic preset and drops the default spec", async () => {
			const text = await renderPersonality("pragmatic");
			expect(text).toContain("<personality>");
			expect(text).toContain("deeply pragmatic, effective senior engineer");
			expect(text).not.toContain("terse, evidence-first engineer");
		});

		it('omits the personality block for "none"', async () => {
			const text = await renderPersonality("none");
			expect(text).not.toContain("<personality>");
			expect(text).not.toContain("</personality>");
		});
	});

	describe("MCP discovery", () => {
		// The discovery notice renders inside the tool-inventory block, so a tool
		// set is required; `search_tool_bm25` is referenced by the notice body.
		const discoveryToolNames = ["read", "search_tool_bm25"];

		it("omits the discovery notice when discovery mode is off", async () => {
			const text = await render({ toolNames: discoveryToolNames, mcpDiscoveryMode: false });
			expect(text).not.toContain("<discovery-notice>");
		});

		it("advertises discoverable servers and the search tool when discovery mode is on", async () => {
			const text = await render({
				toolNames: discoveryToolNames,
				mcpDiscoveryMode: true,
				mcpDiscoveryServerSummaries: ["slack (chat)", "linear (tickets)"],
			});
			expect(text).toContain("<discovery-notice>");
			expect(text).toContain("Discoverable MCP servers this session:");
			expect(text).toContain("slack (chat)");
			expect(text).toContain("linear (tickets)");
			// The notice steers the model to the discovery search tool.
			expect(text).toContain("search_tool_bm25");
		});

		it("renders the notice without a server list when discovery mode is on but no servers are summarized", async () => {
			const text = await render({
				toolNames: discoveryToolNames,
				mcpDiscoveryMode: true,
				mcpDiscoveryServerSummaries: [],
			});
			expect(text).toContain("<discovery-notice>");
			expect(text).not.toContain("Discoverable MCP servers this session:");
			expect(text).toContain("search_tool_bm25");
		});
	});
});
