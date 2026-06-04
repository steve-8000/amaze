import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { getMemoryDoctorReport, runMemoryMigrateCommand, runMemorySyncCommand } from "../src/cli/memory";
import { Settings } from "../src/config/settings";
import {
	buildPiHermesMigrationPlan,
	createHermesMemoryConfig,
	HermesMemoryRuntime,
} from "../src/memory-backend/hermes";

const tempDirs: string[] = [];

async function tempRoot(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "amaze-hermes-migration-"));
	tempDirs.push(dir);
	return dir;
}
async function withOutput(fn: () => Promise<void>): Promise<string> {
	let output = "";
	const originalWrite = process.stdout.write;
	process.stdout.write = ((chunk: string | Uint8Array) => {
		output += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
		return true;
	}) as typeof process.stdout.write;
	try {
		await fn();
		return output;
	} finally {
		process.stdout.write = originalWrite;
	}
}

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

describe("Hermes memory migration surfaces", () => {
	it("inventories pi-hermes Markdown without deleting legacy files", async () => {
		const root = await tempRoot();
		const homeDir = path.join(root, "home");
		const agentDir = path.join(root, "agent");
		const legacyDir = path.join(homeDir, ".pi", "agent", "pi-hermes-memory");
		await fs.mkdir(legacyDir, { recursive: true });
		const legacyFile = path.join(legacyDir, "MEMORY.md");
		await fs.writeFile(legacyFile, "Legacy Hermes fact.\n§\nSecond fact.", "utf-8");

		const settings = Settings.isolated({ "memory.backend": "hermes" });
		const plan = await buildPiHermesMigrationPlan({ agentDir, settings, homeDir });

		expect(plan.destinationDir).toBe(path.join(agentDir, "hermes-memory"));
		expect(plan.entries.map(entry => entry.content)).toEqual(["Legacy Hermes fact.", "Second fact."]);
		expect(await fs.readFile(legacyFile, "utf-8")).toContain("Legacy Hermes fact.");
	});

	it("applies migration idempotently and leaves legacy files in place", async () => {
		const root = await tempRoot();
		const homeDir = path.join(root, "home");
		const agentDir = path.join(root, "agent");
		const legacyDir = path.join(homeDir, ".pi", "agent", "memory");
		await fs.mkdir(legacyDir, { recursive: true });
		const legacyFile = path.join(legacyDir, "USER.md");
		await fs.writeFile(legacyFile, "- User likes terse answers.\n- User prefers tests.", "utf-8");

		const originalHome = process.env.AMAZE_HERMES_LEGACY_HOME;
		process.env.AMAZE_HERMES_LEGACY_HOME = homeDir;
		try {
			const settings = Settings.isolated({ "memory.backend": "hermes" }) as Settings;
			const first = await withOutput(() =>
				runMemoryMigrateCommand({ from: "pi-hermes", apply: true }, settingsWithDirs(settings, agentDir, root)),
			);
			const second = await withOutput(() =>
				runMemoryMigrateCommand({ from: "pi-hermes", apply: true }, settingsWithDirs(settings, agentDir, root)),
			);

			expect(first).toContain("Entries added: 2");
			expect(first).toContain("Legacy files deleted: 0");
			expect(second).toContain("Entries added: 0");
			expect(second).toContain("Duplicates skipped: 2");
			expect(await fs.readFile(legacyFile, "utf-8")).toContain("User likes terse answers");
		} finally {
			if (originalHome === undefined) delete process.env.AMAZE_HERMES_LEGACY_HOME;
			else process.env.AMAZE_HERMES_LEGACY_HOME = originalHome;
		}
	});

	it("syncs Markdown to SQLite idempotently for Hermes only", async () => {
		const root = await tempRoot();
		const agentDir = path.join(root, "agent");
		const settings = settingsWithDirs(Settings.isolated({ "memory.backend": "hermes" }), agentDir, root);
		const config = createHermesMemoryConfig({ settings, agentDir, cwd: root });
		await fs.mkdir(config.memoryDir, { recursive: true });
		await fs.writeFile(path.join(config.memoryDir, "MEMORY.md"), "Synced local fact.", "utf-8");

		const first = await withOutput(() => runMemorySyncCommand(settings));
		const second = await withOutput(() => runMemorySyncCommand(settings));

		expect(first).toContain("0 -> 1 entries (1 added)");
		expect(second).toContain("1 -> 1 entries (0 added)");
		const rt = new HermesMemoryRuntime(config);
		try {
			await rt.load();
			expect(rt.search("Synced", { target: "memory" })).toHaveLength(1);
		} finally {
			rt.close();
		}
	});

	it("doctor warns when Hermes and pi-hermes plugin references coexist", async () => {
		const settings = Settings.isolated({ "memory.backend": "hermes", extensions: ["/tmp/pi-hermes-memory"] });
		const report = await getMemoryDoctorReport(settings);
		expect(report.status).toBe("degraded");
		expect(report.text).toContain("pi-hermes-memory");
	});
});

function settingsWithDirs(settings: Settings, agentDir: string, cwd: string): Settings {
	return Object.assign(settings, {
		getAgentDir: () => agentDir,
		getCwd: () => cwd,
	});
}
