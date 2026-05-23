import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { getConfigRootDir, setAgentDir, setProjectDir } from "@amaze/utils";
import { runMemorySearchCommand } from "../../src/cli/memory";
import { staticNexusScope } from "../../src/nexus/scope";
import { NexusStore } from "../../src/nexus/store";

const originalAgentDir = process.env.AMAZE_CODING_AGENT_DIR;
const fallbackAgentDir = path.join(getConfigRootDir(), "agent");
const originalCwd = process.cwd();
let tempRoot = "";
let agentDir = "";
let projectDir = "";

function captureStdout(fn: () => void): string {
	let stdout = "";
	const originalWrite = process.stdout.write;
	process.stdout.write = ((chunk: string | Uint8Array) => {
		stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
		return true;
	}) as typeof process.stdout.write;
	try {
		fn();
	} finally {
		process.stdout.write = originalWrite;
	}
	return stdout;
}

beforeEach(async () => {
	tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "amaze-memory-search-"));
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

describe("memory search", () => {
	it("prints matching memories as a table", () => {
		const store = new NexusStore({ agentDir, cwd: projectDir });
		try {
			store.add({ target: "memory", content: "alpha project retention policy", provenance: "fixture" });
		} finally {
			store.close();
		}

		const stdout = captureStdout(() => runMemorySearchCommand({ query: "retention", limit: 5 }));

		expect(stdout).toContain("ID\tSTATUS\tSOURCE\tPROVENANCE\tCONTENT");
		expect(stdout).toContain("active");
		expect(stdout).toContain("alpha project retention policy");
	});

	it("honors scoped search", () => {
		const store = new NexusStore({ agentDir, cwd: projectDir });
		try {
			store.add({ target: "memory", content: "scoped global retention", scope: staticNexusScope("global") });
		} finally {
			store.close();
		}

		const failure = captureStdout(() => runMemorySearchCommand({ query: "retention", scope: "failure", json: true }));
		const global = captureStdout(() => runMemorySearchCommand({ query: "retention", scope: "global", json: true }));

		expect(JSON.parse(failure)).toEqual([]);
		expect(JSON.parse(global)).toHaveLength(1);
	});

	it("prints an empty-results message", () => {
		const stdout = captureStdout(() => runMemorySearchCommand({ query: "not-present" }));

		expect(stdout).toContain("No Nexus memory results.");
	});
});
