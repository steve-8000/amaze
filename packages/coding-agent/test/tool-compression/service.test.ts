import { describe, expect, it } from "bun:test";
import type { AfterToolCallContext } from "@amaze/agent-core";
import { Settings } from "../../src/config/settings";
import { SessionManager } from "../../src/session/session-manager";
import { compressToolResult } from "../../src/tool-compression";
import type { OutputMeta } from "../../src/tools/output-meta";

function makeContext(toolName: "search" | "bash", text: string, details?: Record<string, unknown>): AfterToolCallContext {
	return {
		assistantMessage: {
			role: "assistant",
			content: [{ type: "text", text: "tool request" }],
			api: "anthropic-messages",
			provider: "anthropic",
			model: "claude-sonnet-4-5",
			usage: {
				input: 1,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "toolUse",
			timestamp: Date.now(),
		},
		toolCall: {
			type: "toolCall",
			id: `${toolName}-call`,
			name: toolName,
			arguments: {},
		},
		args: {},
		result: {
			content: [{ type: "text", text }],
			details,
		},
		isError: false,
		context: {} as AfterToolCallContext["context"],
	};
}

function makeSettings() {
	return Settings.isolated({
		"toolCompression.enabled": true,
		"toolCompression.minimumBytes": 32,
		"toolCompression.search.enabled": true,
		"toolCompression.search.maxFiles": 2,
		"toolCompression.search.maxMatchesPerFile": 1,
		"toolCompression.bash.enabled": true,
		"toolCompression.log.maxErrorBlocks": 2,
		"toolCompression.log.maxWarningFamilies": 1,
		"toolCompression.log.maxTotalLines": 20,
	});
}

describe("compressToolResult", () => {
	it("reuses existing truncation artifact ids instead of saving a duplicate", async () => {
		const sessionManager = SessionManager.inMemory("/tmp/test-reuse");
		const settings = makeSettings();
		const meta: OutputMeta = {
			truncation: {
				direction: "tail",
				truncatedBy: "bytes",
				totalLines: 10,
				totalBytes: 1000,
				outputLines: 4,
				outputBytes: 300,
				artifactId: "7",
			},
		};
		const body = [
			"error one with detailed explanation",
			"stack frame a with long pathname and line number",
			"stack frame b with long pathname and line number",
			"",
			"warning line repeated repeated repeated",
			"",
			"summary failed 1 total 20",
		].join("\n");
		const notice = "\n\n[Showing lines 7-10 of 10. Read artifact://7 for full output]";
		const ctx = makeContext("bash", `${body}${notice}`, { meta });
		const result = await compressToolResult(ctx, sessionManager, settings);
		expect(result).toBeDefined();
		const details = result?.details as { compression?: { artifactId?: string; sourceArtifact?: string } };
		expect(details.compression?.artifactId).toBe("7");
		expect(details.compression?.sourceArtifact).toBe("reused-existing");
	});

	it("preserves existing raw-output footer when compressing bash output", async () => {
		const sessionManager = SessionManager.inMemory("/tmp/test-raw-footer");
		const settings = makeSettings();
		const body = [
			"ERROR build failed after many retries and a long explanation",
			"Traceback line 1 with long path and module name",
			"Traceback line 2 with long path and module name",
			"Traceback line 3 with long path and module name",
			"",
			"warning repeated repeated repeated repeated repeated",
			"warning repeated repeated repeated repeated repeated",
			"",
			"Summary failed 1 passed 0 total 1",
			"",
			"informational block that should be dropped because it is low signal and verbose",
			"more informational block that should be dropped because it is low signal and verbose",
			"",
			"[raw output: artifact://42]",
		].join("\n");
		const result = await compressToolResult(makeContext("bash", body), sessionManager, settings);
		expect(result).toBeDefined();
		const text = (result?.content?.[0] as { text: string }).text;
		expect(text).toContain("artifact://42");
		expect(text).toContain("[compressed output: artifact://42]");
	});

	it("returns undefined when compression is below threshold", async () => {
		const sessionManager = SessionManager.inMemory("/tmp/test-small");
		const settings = makeSettings();
		const result = await compressToolResult(makeContext("bash", "short output"), sessionManager, settings);
		expect(result).toBeUndefined();
	});
});
