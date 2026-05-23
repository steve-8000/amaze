import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { getConfigRootDir, setAgentDir, setProjectDir } from "@amaze/utils";
import { runMemoryTransitionCommand } from "../../src/cli/memory";
import { NexusStore } from "../../src/nexus/store";

const originalAgentDir = process.env.AMAZE_CODING_AGENT_DIR;
const fallbackAgentDir = path.join(getConfigRootDir(), "agent");
const originalCwd = process.cwd();
let tempRoot = "";
let agentDir = "";
let projectDir = "";

function captureOutput(fn: () => void): { stdout: string; stderr: string; exitCode: string | number | undefined } {
	let stdout = "";
	let stderr = "";
	const originalStdout = process.stdout.write;
	const originalStderr = process.stderr.write;
	const originalExit = process.exit;
	process.exitCode = undefined;
	process.stdout.write = ((chunk: string | Uint8Array) => {
		stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
		return true;
	}) as typeof process.stdout.write;
	process.stderr.write = ((chunk: string | Uint8Array) => {
		stderr += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
		return true;
	}) as typeof process.stderr.write;
	process.exit = ((code?: string | number | null) => {
		process.exitCode = code ?? 0;
		throw new Error(`process.exit(${String(code ?? 0)})`);
	}) as typeof process.exit;
	try {
		try {
			fn();
		} catch (error) {
			if (!(error instanceof Error) || !error.message.startsWith("process.exit(")) throw error;
		}
		return { stdout, stderr, exitCode: process.exitCode };
	} finally {
		process.stdout.write = originalStdout;
		process.stderr.write = originalStderr;
		process.exit = originalExit;
		process.exitCode = 0;
	}
}

beforeEach(async () => {
	tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "amaze-memory-superseded-"));
	agentDir = path.join(tempRoot, "agent");
	projectDir = path.join(tempRoot, "project");
	await fs.mkdir(projectDir, { recursive: true });
	setAgentDir(agentDir);
	setProjectDir(projectDir);
});

afterEach(async () => {
	setProjectDir(originalCwd);
	if (originalAgentDir) {
		setAgentDir(originalAgentDir);
	} else {
		setAgentDir(fallbackAgentDir);
		delete process.env.AMAZE_CODING_AGENT_DIR;
	}
	await fs.rm(tempRoot, { recursive: true, force: true });
	process.exitCode = 0;
});

describe("memory mark-superseded", () => {
	it("transitions a memory and emits JSON", () => {
		const store = new NexusStore({ agentDir, cwd: projectDir });
		const added = store.add({ target: "memory", content: "legacy stale memory" });
		store.close();
		expect(added.entry).toBeDefined();

		const output = captureOutput(() =>
			runMemoryTransitionCommand({ action: "mark-superseded", id: added.entry!.id, reason: "replaced", json: true }),
		);

		expect(output.stderr).toBe("");
		expect(JSON.parse(output.stdout)).toMatchObject({
			id: added.entry!.id,
			status: "superseded",
			prevStatus: "active",
			reason: "replaced",
		});
	});

	it("rejects an unknown id", () => {
		const output = captureOutput(() =>
			runMemoryTransitionCommand({ action: "mark-superseded", id: "missing-memory" }),
		);

		expect(output.exitCode).toBe(1);
		expect(output.stderr).toContain("No memory found");
	});

	it("persists superseded status", () => {
		let store = new NexusStore({ agentDir, cwd: projectDir });
		const added = store.add({ target: "memory", content: "persist superseded memory" });
		store.close();
		expect(added.entry).toBeDefined();

		captureOutput(() => runMemoryTransitionCommand({ action: "mark-superseded", id: added.entry!.id }));

		store = new NexusStore({ agentDir, cwd: projectDir });
		try {
			const row = store.db.query("SELECT status FROM memory_items WHERE id = ?").get(added.entry!.id) as
				| { status: string }
				| undefined;
			expect(row?.status).toBe("superseded");
		} finally {
			store.close();
		}
	});
});
