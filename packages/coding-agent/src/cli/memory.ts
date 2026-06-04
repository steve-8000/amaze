import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Settings } from "../config/settings";
import { resolveMemoryBackend } from "../memory-backend";
import {
	applyPiHermesMigration,
	buildPiHermesMigrationPlan,
	createHermesMemoryConfig,
	syncHermesMarkdownToSqlite,
} from "../memory-backend/hermes";
export interface MemoryCommandArgs {
	action: "doctor" | "sync" | "migrate";
	from?: "pi-hermes";
	dryRun?: boolean;
	apply?: boolean;
}

export interface MemoryDoctorReport {
	status: "ok" | "degraded";
	backend: "off" | "mem0" | "hermes";
	text: string;
	legacyWarnings?: string[];
}

export async function runMemoryCommand(args: MemoryCommandArgs): Promise<void> {
	const settings = await Settings.init();
	if (args.action === "doctor") {
		await runMemoryDoctorCommand(settings);
		return;
	}
	if (args.action === "sync") {
		await runMemorySyncCommand(settings);
		return;
	}
	if (args.action === "migrate") {
		await runMemoryMigrateCommand(args, settings);
		return;
	}
	throw new Error(`Unknown memory action: ${String(args.action)}`);
}

export async function getMemoryDoctorReport(settings?: Settings): Promise<MemoryDoctorReport> {
	const activeSettings = settings ?? safeSettings();
	const backend = resolveMemoryBackend(activeSettings);
	if (backend.id === "off") {
		return {
			status: "ok",
			backend: "off",
			text: "Memory backend: off\n- No durable memory subsystem is active.",
		};
	}
	if (backend.id === "hermes") {
		const warnings = await detectHermesDuplicateProviderWarnings(activeSettings);
		const lines = [
			"Memory backend: hermes",
			"- Local Hermes memory is configured.",
			"- Network endpoint: not required.",
		];
		for (const warning of warnings) lines.push(`- Warning: ${warning}`);
		return {
			status: warnings.length ? "degraded" : "ok",
			backend: "hermes",
			legacyWarnings: warnings,
			text: lines.join("\n"),
		};
	}

	const baseUrl = activeSettings.get("memory.mem0.baseUrl") || process.env.MEM0_BASE_URL;
	const apiKey = activeSettings.get("memory.mem0.apiKey") || process.env.MEM0_API_KEY || "local";
	const userId = activeSettings.get("memory.mem0.userId") || "amaze-user";
	if (!baseUrl) {
		return {
			status: "degraded",
			backend: "mem0",
			text: "Memory backend: mem0\n- Missing memory.mem0.baseUrl or MEM0_BASE_URL.",
		};
	}
	try {
		const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/memories?user_id=${encodeURIComponent(userId)}`, {
			headers: { "X-API-Key": apiKey },
		});
		return {
			status: response.ok ? "ok" : "degraded",
			backend: "mem0",
			text: `Memory backend: mem0\n- Base URL: ${baseUrl}\n- Reachable: ${response.ok ? "yes" : `no (${response.status})`}`,
		};
	} catch (error) {
		return {
			status: "degraded",
			backend: "mem0",
			text: `Memory backend: mem0\n- Base URL: ${baseUrl}\n- Reachable: no (${String(error)})`,
		};
	}
}

function safeSettings(): Settings {
	try {
		return Settings.instance;
	} catch {
		return Settings.isolated({});
	}
}

async function detectHermesDuplicateProviderWarnings(settings: Settings): Promise<string[]> {
	const warnings: string[] = [];
	const legacyDirs = [
		path.join(os.homedir(), ".pi", "agent", "pi-hermes-memory"),
		path.join(os.homedir(), ".pi", "agent", "memory"),
		path.join(os.homedir(), ".pi", "agent", "projects-memory"),
	];
	const presentLegacyDirs: string[] = [];
	for (const dir of legacyDirs) {
		try {
			const stat = await fs.stat(dir);
			if (stat.isDirectory()) presentLegacyDirs.push(dir);
		} catch {}
	}
	if (presentLegacyDirs.length)
		warnings.push(
			`legacy pi-hermes memory directories exist (${presentLegacyDirs.join(", ")}); migrate/copy before enabling multiple memory providers.`,
		);

	const extensions = settings.get("extensions");
	if (
		Array.isArray(extensions) &&
		extensions.some(entry => typeof entry === "string" && entry.includes("pi-hermes-memory"))
	) {
		warnings.push(
			"settings.extensions references pi-hermes-memory; disable the upstream plugin to avoid duplicate memory providers.",
		);
	}
	return warnings;
}

export async function runMemoryDoctorCommand(settings: Settings = safeSettings()): Promise<void> {
	process.stdout.write(`${(await getMemoryDoctorReport(settings)).text}\n`);
}

export async function runMemorySyncCommand(settings: Settings = safeSettings()): Promise<void> {
	const backend = resolveMemoryBackend(settings);
	if (backend.id !== "hermes") throw new Error("memory sync is only available when memory.backend is hermes.");
	const result = await syncHermesMarkdownToSqlite({
		agentDir: settings.getAgentDir(),
		settings,
		cwd: settings.getCwd(),
	});
	process.stdout.write(
		`Memory backend: hermes\n- SQLite sync complete: ${result.before} -> ${result.after} entries (${result.added} added).\n- Storage: ${result.destinationDir}\n`,
	);
}

export async function runMemoryMigrateCommand(
	args: Pick<MemoryCommandArgs, "from" | "dryRun" | "apply">,
	settings: Settings = safeSettings(),
): Promise<void> {
	const backend = resolveMemoryBackend(settings);
	if (backend.id !== "hermes") throw new Error("memory migrate is only available when memory.backend is hermes.");
	if ((args.from ?? "pi-hermes") !== "pi-hermes")
		throw new Error("Only memory migrate --from pi-hermes is supported.");
	if (args.apply && args.dryRun) throw new Error("Use either --dry-run or --apply, not both.");
	if (!args.apply && !args.dryRun) throw new Error("memory migrate requires --dry-run or --apply.");
	const result = args.apply
		? await applyPiHermesMigration({ agentDir: settings.getAgentDir(), settings, dryRun: false })
		: await buildPiHermesMigrationPlan({ agentDir: settings.getAgentDir(), settings });
	const mode = args.apply ? "apply" : "dry-run";
	const destinationDir = args.apply
		? result.destinationDir
		: createHermesMemoryConfig({ settings, agentDir: settings.getAgentDir(), cwd: settings.getCwd() }).memoryDir;
	const existingDirs = result.legacyDirs.filter(dir => dir.exists).map(dir => dir.path);
	const lines = [
		`Memory migration: pi-hermes -> hermes (${mode})`,
		`- Legacy directories found: ${existingDirs.length ? existingDirs.join(", ") : "none"}`,
		`- Destination: ${destinationDir}`,
		`- Entries inventoried: ${result.entries.length}`,
	];
	if (args.apply) {
		const applied = result as Awaited<ReturnType<typeof applyPiHermesMigration>>;
		lines.push(`- Entries added: ${applied.added}`);
		lines.push(`- Duplicates skipped: ${applied.duplicates}`);
		lines.push(`- Failed: ${applied.failed.length}`);
	}
	lines.push("- Legacy files deleted: 0");
	process.stdout.write(`${lines.join("\n")}\n`);
}
