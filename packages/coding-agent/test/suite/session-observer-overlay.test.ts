import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setKeybindings } from "@earendil-works/pi-tui";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadTranscriptSnapshot } from "../../src/core/extensions/builtin/session-observer/loader.ts";
import { SessionHudOverlay } from "../../src/core/extensions/builtin/session-observer/overlay.ts";
import { renderTranscript } from "../../src/core/extensions/builtin/session-observer/transcript.ts";
import { KeybindingsManager } from "../../src/core/keybindings.ts";
import { initTheme } from "../../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../../src/utils/ansi.ts";
import { BASE_TIME, createTempRootRegistry, sessionLine, userLine } from "./history-search-fixtures.ts";

const tempRoots = createTempRootRegistry();

beforeAll(() => initTheme("dark"));

afterEach(async () => {
	await tempRoots.cleanup();
});

function messageLine(id: string, timestamp: number, message: unknown): string {
	return JSON.stringify({
		type: "message",
		id,
		parentId: "parent",
		timestamp: new Date(timestamp).toISOString(),
		message,
	});
}

function modelChangeLine(timestamp: number): string {
	return JSON.stringify({
		type: "model_change",
		id: "model-change",
		parentId: "parent",
		timestamp: new Date(timestamp).toISOString(),
		provider: "openai",
		modelId: "gpt-5",
	});
}

function usage() {
	return {
		input: 1,
		output: 2,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 3,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function assistantLine(timestamp: number): string {
	return messageLine("assistant", timestamp, {
		role: "assistant",
		content: [
			{ type: "thinking", thinking: "Need plan\nThen act" },
			{ type: "text", text: "Run tests after reading." },
			{ type: "toolCall", id: "tool-read", name: "read", arguments: { path: "src/index.ts" } },
		],
		api: "openai-responses",
		provider: "openai",
		model: "gpt-5",
		usage: usage(),
		stopReason: "toolUse",
		timestamp,
	});
}

function toolResultLine(timestamp: number): string {
	return messageLine("tool-result", timestamp, {
		role: "toolResult",
		toolCallId: "tool-read",
		toolName: "read",
		content: [{ type: "text", text: "read ok\nsecond line" }],
		isError: false,
		timestamp,
	});
}

function customLine(timestamp: number): string {
	return messageLine("custom", timestamp, {
		role: "custom",
		customType: "notice",
		content: "custom note",
		display: true,
		timestamp,
	});
}

function bashLine(timestamp: number): string {
	return messageLine("bash", timestamp, {
		role: "bashExecution",
		command: "npm test",
		output: "pass",
		exitCode: 0,
		cancelled: false,
		truncated: false,
		timestamp,
	});
}

async function writeTranscriptFile(): Promise<string> {
	const root = await tempRoots.make();
	const dir = join(root, "sessions", "encoded-cwd");
	await mkdir(dir, { recursive: true });
	const file = join(dir, "20260520_session-observer.jsonl");
	const lines = [
		sessionLine("session-observer", "/workspace/repo", BASE_TIME),
		modelChangeLine(BASE_TIME + 100),
		userLine(["Inspect src", "now"], BASE_TIME + 1_000),
		assistantLine(BASE_TIME + 2_000),
		toolResultLine(BASE_TIME + 3_000),
		customLine(BASE_TIME + 4_000),
		bashLine(BASE_TIME + 5_000),
	];
	await writeFile(file, `${lines.join("\n")}\n`, "utf-8");
	return file;
}

async function flushAsyncWork(): Promise<void> {
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

async function waitForViewerLoad(overlay: SessionHudOverlay): Promise<void> {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		if (overlay.getSelectedEntryIndex() >= 0) return;
		await flushAsyncWork();
	}
}

describe("renderTranscript", () => {
	it("renders user, thinking, assistant text, tool result, custom, and bash entries", async () => {
		const file = await writeTranscriptFile();
		const snapshot = await loadTranscriptSnapshot(file);

		const rendered = renderTranscript(snapshot.entries, {
			width: 100,
			selectedIndex: 3,
			expandedEntries: new Set<number>([1]),
		});
		const text = stripAnsi(rendered.lines.join("\n"));

		expect(snapshot.model).toBe("openai/gpt-5");
		expect(rendered.ranges.map((range) => range.kind)).toEqual([
			"user",
			"thinking",
			"response",
			"tool",
			"system",
			"tool",
		]);
		expect(text).toContain("Need plan");
		expect(text).toContain("Run tests after reading.");
		expect(text).toContain("path: src/index.ts");
		expect(text).toContain("read ok");
		expect(text).toContain("[notice]");
		expect(text).toContain("$ npm test");
		expect(text).toContain("▶ ▸ read");
	});
});

describe("SessionHudOverlay", () => {
	it("opens the HUD viewer, expands entries, and returns to the picker with Escape", async () => {
		setKeybindings(new KeybindingsManager());
		const file = await writeTranscriptFile();
		let renderRequests = 0;
		let doneCalls = 0;
		const overlay = new SessionHudOverlay({
			sessions: [
				{
					id: "session-observer",
					shortId: "session-",
					path: file,
					cwd: "/workspace/repo",
					createdAt: BASE_TIME,
					modifiedAt: BASE_TIME + 5_000,
					messageCount: 6,
					lastUserText: "Inspect src now",
					isCurrent: true,
				},
			],
			done: () => {
				doneCalls += 1;
			},
			requestRender: () => {
				renderRequests += 1;
			},
		});

		expect(overlay.render(90).join("\n")).toContain("Sessions");
		overlay.handleInput("\r");
		await waitForViewerLoad(overlay);

		expect(overlay.getMode()).toBe("viewer");
		expect(renderRequests).toBeGreaterThan(0);
		expect(overlay.getSelectedEntryIndex()).toBeGreaterThanOrEqual(0);
		expect(overlay.render(90).join("\n")).toContain("Sessions > /workspace/repo · session-");

		overlay.handleInput("\r");
		expect(overlay.getExpandedEntryCount()).toBe(1);
		overlay.handleInput("\x1b");
		expect(overlay.getMode()).toBe("picker");
		overlay.handleInput("\x1b");
		expect(doneCalls).toBe(1);
	});

	it("closes the viewer with the configured session observer keybinding", async () => {
		setKeybindings(new KeybindingsManager());
		const file = await writeTranscriptFile();
		let doneCalls = 0;
		const overlay = new SessionHudOverlay({
			sessions: [
				{
					id: "session-observer",
					shortId: "session-",
					path: file,
					cwd: "/workspace/repo",
					createdAt: BASE_TIME,
					modifiedAt: BASE_TIME + 5_000,
					messageCount: 6,
					lastUserText: "Inspect src now",
					isCurrent: false,
				},
			],
			done: () => {
				doneCalls += 1;
			},
			requestRender: () => {},
		});

		overlay.handleInput("\r");
		await waitForViewerLoad(overlay);
		overlay.handleInput("\x13");

		expect(doneCalls).toBe(1);
	});
});
