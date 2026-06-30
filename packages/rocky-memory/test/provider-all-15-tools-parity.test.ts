import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleToolCall, TOOLS } from "@steve-z8k/pi-rocky-memory/mcp-tools";

let dataDir: string;

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "rockyMemory-ts-provider-parity-"));
	process.env.ROCKY_MEMORY_DATA_DIR = dataDir;
	process.env.ROCKY_MEMORY_NO_EMBEDDINGS = "1";
	delete process.env.ROCKY_MEMORY_MCP_BANK;
	delete process.env.ROCKY_MEMORY_SHARED_SURFACE_DB;
});

afterEach(() => {
	rmSync(dataDir, { recursive: true, force: true });
	delete process.env.ROCKY_MEMORY_DATA_DIR;
	delete process.env.ROCKY_MEMORY_NO_EMBEDDINGS;
	delete process.env.ROCKY_MEMORY_MCP_BANK;
	delete process.env.ROCKY_MEMORY_SHARED_SURFACE_DB;
});

function schemaFor(name: string) {
	const tool = TOOLS.find(candidate => candidate.name === name);
	expect(tool).toBeDefined();
	return tool?.inputSchema as { required?: readonly string[]; properties: Record<string, unknown> };
}

describe("provider all-tools parity", () => {
	it("registers the Python provider-compatible tool surface with valid JSON schemas", () => {
		const names = TOOLS.map(tool => tool.name);
		expect(names).toHaveLength(23);
		for (const name of [
			"rockyMemory_remember",
			"rockyMemory_recall",
			"rockyMemory_sleep",
			"rockyMemory_stats",
			"rockyMemory_invalidate",
			"rockyMemory_validate",
			"rockyMemory_get",
			"rockyMemory_triple_add",
			"rockyMemory_triple_query",
			"rockyMemory_scratchpad_write",
			"rockyMemory_scratchpad_read",
			"rockyMemory_scratchpad_clear",
			"rockyMemory_export",
			"rockyMemory_update",
			"rockyMemory_forget",
			"rockyMemory_import",
			"rockyMemory_diagnose",
			"rockyMemory_shared_remember",
			"rockyMemory_shared_recall",
			"rockyMemory_shared_forget",
			"rockyMemory_shared_stats",
			"rockyMemory_graph_query",
			"rockyMemory_graph_link",
		]) {
			expect(names).toContain(name);
		}
		for (const tool of TOOLS) {
			const roundTripped = JSON.parse(JSON.stringify(tool.inputSchema)) as { type: string };
			expect(roundTripped.type).toBe("object");
		}
	});

	it("advertises required arguments for provider write/update/import tools", () => {
		expect(schemaFor("rockyMemory_remember").required).toContain("content");
		expect(schemaFor("rockyMemory_recall").required).toContain("query");
		expect(schemaFor("rockyMemory_scratchpad_write").required).toContain("content");
		expect(schemaFor("rockyMemory_update").required).toEqual(["memory_id", "content"]);
		expect(schemaFor("rockyMemory_forget").required).toContain("memory_id");
		expect(schemaFor("rockyMemory_export").required).toContain("output_path");
		expect(schemaFor("rockyMemory_import").required).toContain("input_path");
	});

	it("returns user-facing argument errors instead of mutating on missing arguments", async () => {
		for (const [name, args, expected] of [
			["rockyMemory_remember", {}, "content is required"],
			["rockyMemory_recall", {}, "query is required"],
			["rockyMemory_scratchpad_write", { content: "" }, "content is required"],
			["rockyMemory_update", { memory_id: "missing-id" }, "content or importance is required"],
			["rockyMemory_forget", {}, "memory_id is required"],
			["rockyMemory_export", {}, "output_path is required"],
			["rockyMemory_import", {}, "Either input_path (for file import) is required"],
		] as const) {
			const result = await handleToolCall(name, args);
			expect(result.error).toBe(expected);
		}
	});

	it("exports provider data to a file and imports it into a fresh isolated bank", async () => {
		const remembered = await handleToolCall("rockyMemory_remember", {
			content: "source provider memory for import parity",
			importance: 0.7,
			bank: "source",
		});
		expect(remembered.status).toBe("stored");
		await handleToolCall("rockyMemory_scratchpad_write", {
			content: "portable provider scratch",
			bank: "source",
		});

		const exportPath = join(dataDir, "provider-export.json");
		const exported = await handleToolCall("rockyMemory_export", {
			output_path: exportPath,
			bank: "source",
		});
		expect(exported.status).toBe("exported");
		expect(existsSync(exportPath)).toBe(true);
		const payload = JSON.parse(readFileSync(exportPath, "utf8")) as { working_memory?: unknown[] };
		expect(payload.working_memory?.length).toBe(1);

		const imported = await handleToolCall("rockyMemory_import", { input_path: exportPath, bank: "dest" });
		expect(imported.status).toBe("imported");
		expect(JSON.stringify(imported.stats)).toContain("inserted");
		const recalled = await handleToolCall("rockyMemory_recall", {
			query: "import parity",
			bank: "dest",
			limit: 5,
		});
		expect(recalled.count as number).toBeGreaterThanOrEqual(1);
	});

	it("diagnose, validate, graph, and shared handlers return structured provider results", async () => {
		const remembered = await handleToolCall("rockyMemory_remember", {
			content: "validate me through provider parity",
			bank: "ops",
		});
		const memoryId = remembered.memory_id as string;
		const validate = await handleToolCall("rockyMemory_validate", {
			memory_id: memoryId,
			action: "attest",
			validator: "test",
			bank: "ops",
		});
		expect(validate.status).toBe("validation_attest");
		const diagnose = await handleToolCall("rockyMemory_diagnose", { bank: "ops" });
		expect(diagnose.status).toBe("ok");
		expect(diagnose.db_path).toContain("banks/ops/rockyMemory.db");
		const graphQuery = await handleToolCall("rockyMemory_graph_query", { seed_memory_id: memoryId, bank: "ops" });
		expect(graphQuery).toMatchObject({
			status: "ok",
			seed_memory_id: memoryId,
			count: 0,
			results_count: 0,
			results: [],
			related_memories: [],
			bank: "ops",
		});
		expect(
			await handleToolCall("rockyMemory_graph_link", {
				source_id: memoryId,
				target_id: "other",
				relationship: "related",
				bank: "ops",
			}),
		).toMatchObject({
			status: "linked",
			source_id: memoryId,
			target_id: "other",
			relationship: "related",
			edge_type: "related",
			weight: 0.5,
			bank: "ops",
		});

		const shared = await handleToolCall("rockyMemory_shared_remember", {
			content: "Prefer concise parity notes",
			kind: "preference",
		});
		expect(shared.status).toBe("stored_shared");
		expect((await handleToolCall("rockyMemory_shared_forget", { memory_id: shared.memory_id })).status).toBe(
			"deleted",
		);
	});
});
