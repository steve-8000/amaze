import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";

export interface FeatureFlag {
	enabled: boolean;
}

export interface AmazeConfig {
	tools: {
		code: FeatureFlag;
		lang: FeatureFlag;
		search: FeatureFlag;
		mem: FeatureFlag;
	};
	agents: FeatureFlag;
	desk: FeatureFlag;
	hooks: FeatureFlag;
	channels: FeatureFlag & Record<string, unknown>;
	sandbox: FeatureFlag & Record<string, unknown>;
	session: {
		compression: { enabled: boolean; engine: "amaze" | "flue" } & Record<string, unknown>;
	};
	services: {
		xenonite: { enabled: boolean; port: number; autoStart: boolean; autoIndex: boolean; autoWatch: boolean } & Record<string, unknown>;
	};
	raw: Record<string, unknown>;
}

const DEFAULTS: AmazeConfig = {
	tools: {
		code: { enabled: true },
		lang: { enabled: true },
		search: { enabled: true },
		mem: { enabled: true },
	},
	agents: { enabled: true },
	desk: { enabled: false },
	hooks: { enabled: true },
	channels: { enabled: false },
	sandbox: { enabled: false },
	session: { compression: { enabled: true, engine: "amaze" } },
	services: { xenonite: { enabled: false, port: 8700, autoStart: false, autoIndex: true, autoWatch: true } },
	raw: {},
};

function interpolateEnv(value: unknown): unknown {
	if (typeof value === "string") {
		return value.replace(/\$\{([^}]+)\}/g, (_, key: string) => process.env[key] ?? "");
	}
	if (Array.isArray(value)) return value.map(interpolateEnv);
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value)) out[k] = interpolateEnv(v);
		return out;
	}
	return value;
}

function flag(section: unknown, fallback: boolean): FeatureFlag {
	if (section && typeof section === "object" && "enabled" in section) {
		return { enabled: Boolean((section as { enabled: unknown }).enabled) };
	}
	return { enabled: fallback };
}

function resolveConfigPath(explicitPath?: string): string | undefined {
	const candidates = [
		explicitPath,
		process.env.AMAZE_CONFIG,
		join(process.cwd(), "amaze.toml"),
		join(homedir(), ".config", "amaze", "amaze.toml"),
		join(homedir(), ".amaze", "amaze.toml"),
	].filter((p): p is string => Boolean(p));
	return candidates.find((p) => existsSync(p));
}

export function loadAmazeConfig(explicitPath?: string): AmazeConfig {
	const path = resolveConfigPath(explicitPath);
	if (!path) return DEFAULTS;

	let raw: Record<string, unknown>;
	try {
		raw = interpolateEnv(parseToml(readFileSync(path, "utf-8"))) as Record<string, unknown>;
	} catch {
		return DEFAULTS;
	}

	const tools = (raw.tools ?? {}) as Record<string, unknown>;
	const session = (raw.session ?? {}) as Record<string, unknown>;
	const compression = (session.compression ?? {}) as Record<string, unknown>;
	const services = (raw.services ?? {}) as Record<string, unknown>;
	const xenonite = (services.xenonite ?? {}) as Record<string, unknown>;

	return {
		tools: {
			code: flag(tools.code, DEFAULTS.tools.code.enabled),
			lang: flag(tools.lang, DEFAULTS.tools.lang.enabled),
			search: flag(tools.search, DEFAULTS.tools.search.enabled),
			mem: flag(tools.mem, DEFAULTS.tools.mem.enabled),
		},
		agents: flag(raw.agents, DEFAULTS.agents.enabled),
		desk: flag(raw.desk, DEFAULTS.desk.enabled),
		hooks: flag(raw.hooks, DEFAULTS.hooks.enabled),
		channels: { ...(raw.channels as object), ...flag(raw.channels, false) },
		sandbox: { ...(raw.sandbox as object), ...flag(raw.sandbox, false) },
		session: {
			compression: {
				...compression,
				enabled: compression.enabled === undefined ? true : Boolean(compression.enabled),
				engine: compression.engine === "flue" ? "flue" : "amaze",
			},
		},
		services: {
			xenonite: {
				...xenonite,
				enabled: Boolean(xenonite.enabled),
				port: typeof xenonite.port === "number" ? xenonite.port : DEFAULTS.services.xenonite.port,
				autoStart: Boolean(xenonite.auto_start ?? xenonite.autoStart),
				autoIndex: xenonite.auto_index === undefined && xenonite.autoIndex === undefined
					? DEFAULTS.services.xenonite.autoIndex
					: Boolean(xenonite.auto_index ?? xenonite.autoIndex),
				autoWatch: xenonite.auto_watch === undefined && xenonite.autoWatch === undefined
					? DEFAULTS.services.xenonite.autoWatch
					: Boolean(xenonite.auto_watch ?? xenonite.autoWatch),
			},
		},
		raw,
	};
}
