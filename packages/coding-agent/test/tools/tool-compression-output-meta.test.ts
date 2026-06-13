import { describe, expect, it } from "bun:test";
import { Settings } from "../../src/config/settings";
import { SessionManager } from "../../src/session/session-manager";
import { compressToolResult } from "../../src/tool-compression";
import type { OutputMeta } from "../../src/tools/output-meta";

const settings = Settings.isolated({
	"toolCompression.enabled": true,
	"toolCompression.minimumBytes": 32,
	"toolCompression.search.enabled": true,
	"toolCompression.search.maxFiles": 1,
	"toolCompression.search.maxMatchesPerFile": 1,
	"toolCompression.bash.enabled": true,
	"toolCompression.log.maxErrorBlocks": 2,
	"toolCompression.log.maxWarningFamilies": 1,
	"toolCompression.log.maxTotalLines": 20,
});

describe("tool compression output-meta interaction", () => {
	it("keeps truncation notice text while adding compressed footer", async () => {
		const sessionManager = SessionManager.inMemory("/tmp/output-meta-test");
		const meta: OutputMeta = {
			truncation: {
				direction: "tail",
				truncatedBy: "bytes",
				totalLines: 20,
				totalBytes: 2000,
				outputLines: 5,
				outputBytes: 500,
				artifactId: "88",
			},
		};
		const ctx: any = {
			assistantMessage: { role: "assistant", content: [], timestamp: Date.now() },
			toolCall: { type: "toolCall", id: "bash-1", name: "bash", arguments: {} },
			args: {},
			result: {
				content: [
					{
						type: "text",
						text: [
							"ERROR build failed with a long explanation that should be retained",
							"Traceback line 1 with long path and module name",
							"Traceback line 2 with long path and module name",
							"",
							"warning line repeated repeated repeated repeated repeated",
							"",
							"summary failed total 1",
							"",
							"[Showing lines 16-20 of 20 (500 B limit). Read artifact://88 for full output]",
						].join("\n"),
					},
				],
				details: { meta },
			},
			isError: false,
			context: {},
		};
		const result = await compressToolResult(ctx, sessionManager, settings);
		expect(result).toBeDefined();
		const text = result?.content?.[0] && "text" in result.content[0] ? result.content[0].text : "";
		expect(text).toContain("artifact://88");
		expect(text).toContain("[compressed output: artifact://88]");
	});
});
