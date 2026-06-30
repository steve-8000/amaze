import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { isSelfReferentialMCPConfig, loadAllMCPConfigs } from "@steve-z8k/pi-coding-agent/mcp/config";

const packageRoot = path.resolve(import.meta.dir, "..");
const originalLauncherPath = process.env.AMAZE_CLI_LAUNCHER_PATH;
const originalCompiled = process.env.PI_COMPILED;

describe("self-referential MCP config guard", () => {
	afterEach(() => {
		if (originalLauncherPath === undefined) {
			delete process.env.AMAZE_CLI_LAUNCHER_PATH;
		} else {
			process.env.AMAZE_CLI_LAUNCHER_PATH = originalLauncherPath;
		}
		if (originalCompiled === undefined) {
			delete process.env.PI_COMPILED;
		} else {
			process.env.PI_COMPILED = originalCompiled;
		}
	});

	test("detects a symlinked amaze dev launcher", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "amaze-self-mcp-"));
		try {
			const launcher = path.join(packageRoot, "scripts", "amaze");
			const symlink = path.join(tempDir, "amaze");
			await fs.symlink(launcher, symlink);
			process.env.AMAZE_CLI_LAUNCHER_PATH = launcher;

			await expect(isSelfReferentialMCPConfig({ type: "stdio", command: symlink }, tempDir)).resolves.toBe(true);
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	test("detects bun relaunching the CLI entrypoint", async () => {
		const cliEntry = path.join(packageRoot, "src", "cli.ts");

		await expect(
			isSelfReferentialMCPConfig({ type: "stdio", command: process.execPath, args: [cliEntry] }, packageRoot),
		).resolves.toBe(true);
	});

	test("allows unrelated stdio MCP commands", async () => {
		await expect(
			isSelfReferentialMCPConfig({ type: "stdio", command: process.execPath, args: ["--version"] }, packageRoot),
		).resolves.toBe(false);
	});

	test("detects compiled binary relaunching itself", async () => {
		process.env.PI_COMPILED = "true";

		await expect(isSelfReferentialMCPConfig({ type: "stdio", command: process.execPath }, packageRoot)).resolves.toBe(
			true,
		);
	});
});

describe("MCP config guard", () => {
	test("drops only self-referential MCP servers and keeps Clab-named configs", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "amaze-disabled-mcp-"));
		try {
			const claudeDir = path.join(tempDir, ".claude");
			await fs.mkdir(claudeDir, { recursive: true });
			await fs.writeFile(
				path.join(claudeDir, ".mcp.json"),
				JSON.stringify({
					mcpServers: {
						"clab-codebase": { command: "/bin/echo", args: ["ok-codebase"] },
						"clab-skills": { command: "/bin/echo", args: ["ok-skills"] },
						"self-referential-server": {
							command: process.execPath,
							args: [path.join(packageRoot, "src", "cli.ts")],
						},
						"allowed-server": { command: "/bin/echo", args: ["ok"] },
					},
				}),
			);

			const { configs } = await loadAllMCPConfigs(tempDir, {
				filterExa: false,
				filterBrowser: false,
			});

			expect(configs["clab-codebase"]).toBeDefined();
			expect(configs["clab-skills"]).toBeDefined();
			expect(configs["self-referential-server"]).toBeUndefined();
			expect(configs["allowed-server"]).toBeDefined();
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});
});
