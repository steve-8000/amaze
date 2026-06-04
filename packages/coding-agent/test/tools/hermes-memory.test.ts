import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Settings } from "@amaze/coding-agent/config/settings";
import { HermesMemorySearchTool, HermesMemoryTool, type ToolSession } from "@amaze/coding-agent/tools";
import { getAgentDir, setAgentDir } from "@amaze/utils";

const tempDirs: string[] = [];
const originalAgentDir = getAgentDir();

async function tempDir(prefix: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

function session(cwd: string, backend: "off" | "mem0" | "hermes" = "hermes"): ToolSession {
	return {
		cwd,
		hasUI: false,
		getSessionFile: () => null,
		getSessionSpawns: () => null,
		settings: Settings.isolated({ "memory.backend": backend, "eval.py": false }),
	} as ToolSession;
}

describe("Hermes memory tools", () => {
	beforeEach(async () => {
		setAgentDir(await tempDir("amaze-hermes-tools-global-agent-"));
	});

	afterEach(async () => {
		setAgentDir(originalAgentDir);
		for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
	});

	it("register only when the Hermes backend is active", async () => {
		const cwd = await tempDir("amaze-hermes-tools-cwd-");

		expect(HermesMemoryTool.createIf(session(cwd, "hermes"))?.name).toBe("memory");
		expect(HermesMemorySearchTool.createIf(session(cwd, "hermes"))?.name).toBe("memory_search");
		expect(HermesMemoryTool.createIf(session(cwd, "mem0"))).toBeNull();
		expect(HermesMemorySearchTool.createIf(session(cwd, "mem0"))).toBeNull();
		expect(HermesMemoryTool.createIf(session(cwd, "off"))).toBeNull();
		expect(HermesMemorySearchTool.createIf(session(cwd, "off"))).toBeNull();
	});

	it("adds and searches local Hermes memory", async () => {
		const cwd = await tempDir("amaze-hermes-tools-cwd-");
		const s = session(cwd);
		const memory = HermesMemoryTool.createIf(s)!;
		const search = HermesMemorySearchTool.createIf(s)!;

		const add = await memory.execute("call-1", {
			action: "add",
			target: "memory",
			content: "Hermes native memory roundtrip marker is stored locally.",
		});
		expect(add.details?.backend).toBe("hermes");
		expect(add.details?.success).toBe(true);
		const addText = add.content[0];
		expect(addText?.type).toBe("text");
		if (addText?.type !== "text") throw new Error("Expected text content");
		expect(addText.text).toContain("Entry added");

		const found = await search.execute("call-2", { query: "roundtrip marker", target: "memory", limit: 5 });
		expect(found.details?.backend).toBe("hermes");
		expect(found.details?.count).toBe(1);
		expect(found.details?.results?.[0]?.content).toContain("Hermes native memory roundtrip marker");
		const foundText = found.content[0];
		expect(foundText?.type).toBe("text");
		if (foundText?.type !== "text") throw new Error("Expected text content");
		expect(foundText.text).toContain("Hermes native memory roundtrip marker");
	});
});
