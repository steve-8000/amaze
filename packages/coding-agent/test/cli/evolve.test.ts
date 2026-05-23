import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..", "..", "..", "..");
const cliEntry = path.join(repoRoot, "packages", "coding-agent", "src", "cli.ts");

let cleanupRoot: string | undefined;

async function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let text = "";
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			text += decoder.decode(value, { stream: true });
		}
		return text + decoder.decode();
	} finally {
		reader.releaseLock();
	}
}

async function runCli(root: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	const proc = Bun.spawn(["bun", cliEntry, ...args], {
		cwd: repoRoot,
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, HOME: root, AMAZE_NO_TITLE: "1", NO_COLOR: "1" },
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		readStream(proc.stdout as ReadableStream<Uint8Array>),
		readStream(proc.stderr as ReadableStream<Uint8Array>),
		proc.exited,
	]);
	return { stdout, stderr, exitCode };
}

afterEach(async () => {
	if (cleanupRoot) {
		await fs.rm(cleanupRoot, { recursive: true, force: true });
		cleanupRoot = undefined;
	}
});

describe("evolve CLI", () => {
	it("evolve status reports zero state on a fresh HOME", async () => {
		cleanupRoot = await fs.mkdtemp(path.join(os.tmpdir(), "amaze-evolve-cli-"));

		const result = await runCli(cleanupRoot, ["evolve", "status"]);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout).toContain("EVOLUTION STATE");
		expect(result.stdout).toContain("Active objectives: 0");
		expect(result.stdout).toContain("Pending proposals: 0");
		expect(result.stdout).toContain("No active evolution flow.");
	});

	it("evolve help lists action options", async () => {
		cleanupRoot = await fs.mkdtemp(path.join(os.tmpdir(), "amaze-evolve-cli-"));

		const result = await runCli(cleanupRoot, ["evolve", "--help"]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("status");
		expect(result.stdout).toContain("doctor");
		expect(result.stdout).toContain("rollback");
		expect(result.stdout).toContain("simulate");
	});

	it("evolve doctor lists default forbidden scopes", async () => {
		cleanupRoot = await fs.mkdtemp(path.join(os.tmpdir(), "amaze-evolve-cli-"));

		const result = await runCli(cleanupRoot, ["evolve", "doctor"]);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout).toContain(".amaze/settings.json");
		expect(result.stdout).toContain(".git/**");
		expect(result.stdout).toContain("AGENTS.md");
		expect(result.stdout).toContain("packages/coding-agent/src/learning/**");
	});

	it("evolve objectives delegates to objective list", async () => {
		cleanupRoot = await fs.mkdtemp(path.join(os.tmpdir(), "amaze-evolve-cli-"));

		const result = await runCli(cleanupRoot, ["evolve", "objectives"]);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout).toContain("No objectives");
	});

	it("evolve preview without --objective fails with usage error", async () => {
		cleanupRoot = await fs.mkdtemp(path.join(os.tmpdir(), "amaze-evolve-cli-"));

		const result = await runCli(cleanupRoot, ["evolve", "preview"]);

		expect(result.exitCode).not.toBe(0);
		expect(`${result.stderr}\n${result.stdout}`).toMatch(/objective|id/);
	});
});
