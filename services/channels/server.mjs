// amaze channel ingress server.
// Mounts flue channel webhook routes (Slack/GitHub/Discord) on a Hono app,
// driven entirely by amaze.toml [channels]. Vendored flue packages are loaded
// as-is via jiti so their TypeScript runs without a separate build.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createJiti } from "jiti/static";
import { parse as parseToml } from "smol-toml";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const jiti = createJiti(import.meta.url, { moduleCache: false });

function interpolateEnv(value) {
	if (typeof value === "string") return value.replace(/\$\{([^}]+)\}/g, (_, k) => process.env[k] ?? "");
	if (Array.isArray(value)) return value.map(interpolateEnv);
	if (value && typeof value === "object") {
		const out = {};
		for (const [k, v] of Object.entries(value)) out[k] = interpolateEnv(v);
		return out;
	}
	return value;
}

function loadConfig() {
	const candidates = [
		process.env.AMAZE_CONFIG,
		join(process.cwd(), "amaze.toml"),
		join(repoRoot, "amaze.toml"),
		join(homedir(), ".config", "amaze", "amaze.toml"),
		join(homedir(), ".amaze", "amaze.toml"),
	].filter(Boolean);
	const path = candidates.find((p) => existsSync(p));
	if (!path) return {};
	return interpolateEnv(parseToml(readFileSync(path, "utf-8")));
}

export async function buildChannelApp(config = loadConfig()) {
	const channels = config.channels ?? {};
	const app = new Hono();
	const mounted = [];

	app.get("/health", (c) => c.json({ ok: true, service: "amaze-channels", mounted }));

	if (channels.slack?.enabled) {
		const { createSlackChannel } = await jiti.import(
			join(repoRoot, "vendor/flue/packages/slack/src/index.ts"),
		);
		const channel = createSlackChannel({
			signingSecret: channels.slack.signing_secret ?? "",
			events: ({ payload }) => ({ status: 200, body: { ok: true, received: payload?.type } }),
		});
		for (const route of channel.routes) {
			app.on(route.method, `/slack${route.path}`, route.handler);
			mounted.push(`slack ${route.method} /slack${route.path}`);
		}
	}

	if (channels.github?.enabled) {
		const { createGitHubChannel } = await jiti.import(
			join(repoRoot, "vendor/flue/packages/github/src/index.ts"),
		);
		const channel = createGitHubChannel({
			webhookSecret: channels.github.webhook_secret ?? "",
			webhook: ({ payload }) => ({ status: 200, body: { ok: true, event: payload?.action } }),
		});
		for (const route of channel.routes) {
			app.on(route.method, `/github${route.path}`, route.handler);
			mounted.push(`github ${route.method} /github${route.path}`);
		}
	}

	return { app, mounted };
}

async function main() {
	const config = loadConfig();
	if (!config.channels?.enabled) {
		console.error("[amaze-channels] disabled ([channels].enabled = false). Nothing to serve.");
		process.exit(2);
	}
	const { app, mounted } = await buildChannelApp(config);
	const port = Number(config.channels.port ?? 8650);
	serve({ fetch: app.fetch, port });
	console.log(`[amaze-channels] listening on :${port}`);
	console.log(`[amaze-channels] mounted: ${mounted.join(", ") || "(none)"}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error("[amaze-channels]", error);
		process.exit(1);
	});
}
