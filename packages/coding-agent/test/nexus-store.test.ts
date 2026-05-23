import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Settings } from "@amaze/coding-agent/config/settings";
import { evaluateNexusDoctor } from "@amaze/coding-agent/nexus/doctor";
import { indexNexusRepository } from "@amaze/coding-agent/nexus/knowledge/indexer";
import { runNexusPipeline } from "@amaze/coding-agent/nexus/pipeline";
import { staticNexusScope } from "@amaze/coding-agent/nexus/scope";
import { getNexusDbPath, NexusStore, openNexusDb } from "@amaze/coding-agent/nexus/store";
import { Snowflake } from "@amaze/utils";

const createdDirs = new Set<string>();

async function makeTempDir(prefix: string): Promise<string> {
	const dir = path.join(os.tmpdir(), `${prefix}-${Snowflake.next()}`);
	await fs.mkdir(dir, { recursive: true });
	createdDirs.add(dir);
	return dir;
}

describe("NexusStore", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		for (const dir of createdDirs) {
			await fs.rm(dir, { recursive: true, force: true });
		}
		createdDirs.clear();
	});

	it("stores active memory and preserves superseded history on replace", async () => {
		const agentDir = await makeTempDir("nexus-store");
		const cwd = await makeTempDir("nexus-cwd");
		const store = new NexusStore({ agentDir, cwd });
		try {
			const add = store.add({ target: "project", content: "Use bun test for project validation.", memoryType: "workflow" });
			expect(add.success).toBe(true);
			const search = store.search({ query: "bun test", scope: "current_project", limit: 5, includeHistory: true });
			expect(search.some(entry => entry.content.includes("bun test"))).toBe(true);
			const replace = store.replace({ target: "project", oldText: "bun test", content: "Use pnpm test for project validation." });
			expect(replace.success).toBe(true);
			const history = store.search({ query: "project validation", scope: "current_project", limit: 10, includeHistory: true });
			expect(history.some(entry => entry.status === "superseded")).toBe(true);
			expect(history.some(entry => entry.status === "active" && entry.content.includes("pnpm test"))).toBe(true);
		} finally {
			store.close();
		}
	});

	it("separates project, global, knowledge, failure, and session scopes for retrieval", async () => {
		const agentDir = await makeTempDir("nexus-scopes");
		const cwd = await makeTempDir("nexus-scopes-cwd");
		const store = new NexusStore({ agentDir, cwd });
		try {
			store.add({ target: "memory", content: "Project-local memory convention." });
			store.add({ target: "memory", content: "Shared global convention.", scope: staticNexusScope("global") });
			store.add({ target: "project", content: "Project-specific command." });
			store.add({ target: "failure", content: "Global failure shield." });
			store.add({ target: "knowledge", content: "General knowledge entry." });
			const currentProjectMemory = store.search({ query: "local memory convention", scope: "current_project", limit: 10, includeHistory: true });
			expect(currentProjectMemory.some(entry => entry.scopeKind === "project")).toBe(true);
			const currentGlobal = store.search({ query: "global convention", scope: "current_project", limit: 10, includeHistory: true });
			expect(currentGlobal.some(entry => entry.scopeKind === "global")).toBe(true);
			const currentProject = store.search({ query: "project-specific command", scope: "current_project", limit: 10, includeHistory: true });
			expect(currentProject.some(entry => entry.scopeKind === "project")).toBe(true);
			const globalOnly = store.search({ query: "global convention", scope: "global", limit: 10, includeHistory: true });
			expect(globalOnly.every(entry => entry.scopeKind === "global" || entry.scopeKind === "user")).toBe(true);
			const failureOnly = store.search({ query: "failure shield", scope: "failure", limit: 10, includeHistory: true });
			expect(failureOnly.every(entry => entry.scopeKind === "failure")).toBe(true);
		} finally {
			store.close();
		}
	});

	it("self-healing marks duplicates, stale imported entries, contradictions, and scope leaks", async () => {
		const agentDir = await makeTempDir("nexus-healing");
		const cwd = await makeTempDir("nexus-healing-cwd");
		const store = new NexusStore({ agentDir, cwd });
		try {
			store.add({ target: "project", content: "Command: bun test", confidence: "tool_verified" });
			store.add({ target: "project", content: "Command: bun   test", confidence: "tool_verified" });
			store.add({ target: "memory", content: "Runtime: enabled", confidence: "imported_unverified" });
			store.add({ target: "memory", content: "Runtime: disabled", confidence: "imported_unverified" });
			store.add({ target: "user", content: "Mis-scoped user preference", scope: { ...store.scope, id: store.scope.id, kind: "project" } as any });
			const healing = store.runSelfHealing();
			expect(healing.duplicates).toBeGreaterThan(0);
			expect(healing.stale).toBeGreaterThan(0);
			expect(healing.contradictions).toBeGreaterThan(0);
			expect(healing.scopeLeaks).toBeGreaterThan(0);
			const history = store.search({ query: "Runtime", scope: "all", limit: 10, includeHistory: true });
			expect(history.some(entry => entry.status === "quarantined" || entry.status === "superseded" || entry.staleness === "needs_refresh")).toBe(true);
		} finally {
			store.close();
		}
	});

	it("runs deterministic pipeline, creates hypotheses, promotes skills, and renders artifacts", async () => {
		const agentDir = await makeTempDir("nexus-pipeline");
		const cwd = await makeTempDir("nexus-pipeline-cwd");
		const sessionDir = path.join(agentDir, "sessions");
		await fs.mkdir(sessionDir, { recursive: true });
		const sessionRows = [
			{ type: "session", id: "thr-1", cwd },
			{ type: "message", message: { role: "user", content: "Always reply in concise Korean." } },
			{ type: "message", message: { role: "assistant", content: "Use bun test and memory.backend nexus for this repository. Skill generation should be enabled." } },
			{ type: "message", message: { role: "assistant", content: "Run bun test before edits; bun test validates project commands." } },
			{ type: "message", message: { role: "assistant", content: "The last run failed with error: dependency mismatch." } },
		];
		await Bun.write(path.join(sessionDir, "thr-1.jsonl"), `${sessionRows.map(row => JSON.stringify(row)).join("\n")}\n`);
		const settings = Settings.isolated({ "memory.backend": "nexus", "nexus.dream.enabled": true });
		const store = new NexusStore({ agentDir, cwd });
		try {
			const result = await runNexusPipeline(store, settings);
			expect(result.importedSources).toBeGreaterThan(0);
			expect(result.createdEntries).toBeGreaterThan(0);
			expect(result.hypotheses).toBeGreaterThan(0);
			store.runSelfHealing();
			await store.renderArtifacts();
			const summary = await Bun.file(path.join(store.artifactRoot, "memory_summary.md")).text();
			expect(summary.startsWith("v1\n")).toBe(true);
			const skillDirs = await fs.readdir(path.join(store.artifactRoot, "skills")).catch(() => [] as string[]);
			expect(skillDirs.length).toBeGreaterThan(0);
			expect(store.search({ query: "Future work on", scope: "current_project", limit: 5 }).length).toBe(0);
			const doctor = evaluateNexusDoctor(settings, cwd);
			expect(["PASS", "WARN"]).toContain(doctor.status);
			expect(doctor.capabilities.retrievalMode).toBe("fts");
		} finally {
			store.close();
		}
	});
	it("reports knowledge freshness and scope diagnostics for indexed repositories", async () => {
		const agentDir = await makeTempDir("nexus-doctor-knowledge");
		const cwd = await makeTempDir("nexus-doctor-knowledge-cwd");
		await fs.mkdir(path.join(cwd, "src"), { recursive: true });
		await Bun.write(path.join(cwd, "src", "billing.ts"), "export function bill() { return 1; }\n");
		const settings = Settings.isolated({
			"memory.backend": "nexus",
			"nexus.knowledge.enabled": true,
			"nexus.knowledge.maintenanceMinIntervalMs": 60_000,
		});
		Object.defineProperty(settings, "getAgentDir", { value: () => agentDir });
		await indexNexusRepository({ agentDir, cwd, repoRoot: cwd });
		const doctor = evaluateNexusDoctor(settings, cwd);
		expect(doctor.checks.find(check => check.id === "knowledge_scope")?.status).toBe("PASS");
		expect(doctor.checks.find(check => check.id === "knowledge_provenance")?.status).toBe("PASS");
		expect(doctor.checks.find(check => check.id === "knowledge_freshness")?.status).toBe("PASS");
	});

	it("opens the canonical SQLite+FTS store without AI providers", async () => {
		const agentDir = await makeTempDir("nexus-db");
		const db = openNexusDb(getNexusDbPath(agentDir));
		try {
			const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_items'").get() as
				| { name?: string }
				| undefined;
			expect(row?.name).toBe("memory_items");
		} finally {
			db.close(false);
		}
	});
});
