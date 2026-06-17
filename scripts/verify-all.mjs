// Consolidated amaze integration verification (model-independent).
// Exercises every integrated layer that does not require a tool-calling LLM:
// pi-* tools, socraticode tools, flue sandbox + compaction + channels.
// Memory layer is checked only if the hermes-bridge is reachable.
import { createHmac } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cfgDir = mkdtempSync(join(tmpdir(), "amaze-verify-"));
const cfgPath = join(cfgDir, "amaze.toml");
writeFileSync(
	cfgPath,
	`[tools.search]
enabled = true
[tools.search.store.qdrant]
host = "localhost"
port = 16333
[sandbox]
enabled = true
provider = "local"
[tools.mem]
enabled = true
[skills]
enabled = true
[services.xenonite]
port = 8700
`,
);
process.env.AMAZE_CONFIG = cfgPath;

const dist = "../packages/coding-agent/dist";
const { loadExtensionFromFactory, createExtensionRuntime, createExtensionModuleImporter } = await import(
	`${dist}/core/extensions/loader.js`
);
const { createEventBus } = await import(`${dist}/core/event-bus.js`);

const results = [];
const record = (name, ok, detail) => {
	results.push({ name, ok, detail });
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

async function loadFactory(path) {
	const mod = await import(`${dist}/core/extensions/builtin/${path}`);
	const ext = await loadExtensionFromFactory(mod.default, process.cwd(), createEventBus(), createExtensionRuntime(), `<verify>`);
	return ext;
}

try {
	const tools = await loadFactory("amaze-tools/index.js");
	const names = [...tools.tools.keys()];
	const need = ["code_find", "code_rewrite", "lang_check", "agent_run"];
	const ok = need.every((n) => names.includes(n));
	record("pi-* wrappers (code_/lang_/agent_)", ok, `${names.length} tools`);
} catch (e) {
	record("pi-* wrappers", false, String(e).slice(0, 120));
}

try {
	const search = await loadFactory("amaze-search/index.js");
	record("socraticode tools (index_/search_/graph_/ctx_)", search.tools.size === 24, `${search.tools.size} tools`);
} catch (e) {
	record("socraticode tools", false, String(e).slice(0, 120));
}

try {
	const sb = await loadFactory("amaze-sandbox/index.js");
	const tool = sb.tools.get("sandbox_exec");
	const res = await tool.definition.execute("t", { command: "echo amaze_ok" }, undefined, undefined, { cwd: process.cwd() });
	const ok = /amaze_ok/.test(res.content[0].text);
	record("flue sandbox (sandbox_exec executes)", ok, res.content[0].text.split("\n")[0]);
} catch (e) {
	record("flue sandbox", false, String(e).slice(0, 120));
}

try {
	const importer = createExtensionModuleImporter();
	const mod = await importer.import(new URL("../vendor/flue/packages/runtime/src/compaction.ts", import.meta.url).pathname, {
		default: false,
	});
	const ok = mod.shouldCompact(199000, 200000, { enabled: true, reserveTokens: 2000 }) === true && mod.shouldCompact(10, 200000, { enabled: true, reserveTokens: 2000 }) === false;
	record("flue compaction module", ok);
} catch (e) {
	record("flue compaction module", false, String(e).slice(0, 120));
}

try {
	const { buildChannelApp } = await import("../services/channels/server.mjs");
	const SS = "verify_secret";
	const { app } = await buildChannelApp({ channels: { enabled: true, slack: { enabled: true, signing_secret: SS } } });
	const body = JSON.stringify({ type: "url_verification", challenge: "amaze42" });
	const ts = Math.floor(Date.now() / 1000).toString();
	const sig = `v0=${createHmac("sha256", SS).update(`v0:${ts}:${body}`).digest("hex")}`;
	const good = await app.request("/slack/events", { method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body).toString(), "x-slack-request-timestamp": ts, "x-slack-signature": sig }, body });
	const goodJson = await good.json();
	const bad = await app.request("/slack/events", { method: "POST", headers: { "content-type": "application/json", "x-slack-request-timestamp": ts, "x-slack-signature": "v0=bad" }, body });
	record("flue channels (slack signed/rejected)", goodJson.challenge === "amaze42" && bad.status === 401);
} catch (e) {
	record("flue channels", false, String(e).slice(0, 120));
}

try {
	const health = await fetch("http://127.0.0.1:8700/health").then((r) => r.json()).catch(() => null);
	const mem = await loadFactory("amaze-memory/index.js");
	const registered = mem.tools.has("mem_recall") && mem.tools.has("skill_manage");
	if (!health) {
		record("Xenonite memory (tools register; service down)", registered, "start ~/rocky/xenonite to exercise mem_/skill_");
	} else {
		record("Xenonite memory (mem_/skill_ via service)", registered, `xenonite up, ${mem.tools.size} tools`);
	}
} catch (e) {
	record("Xenonite memory", false, String(e).slice(0, 120));
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length === 0 ? 0 : 1);
