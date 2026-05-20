import { describe, expect, it } from "bun:test";
import type { ToolSession } from "../../src/sdk";
import {
	type CuaDaemonClient,
	type CuaMode,
	CuaTool,
	type LoadedCuaConfig,
	type ResolvedCuaConfig,
} from "../../src/tools/cua";

interface DaemonCall {
	method: string;
	params: Record<string, unknown>;
}

class FakeCuaDaemon implements CuaDaemonClient {
	readonly ready = {
		type: "ready" as const,
		version: "test",
		cuaAvailable: true,
		cuaVersion: "1.2.3",
		cuaImportError: null,
	};
	readonly calls: DaemonCall[] = [];
	readonly sandboxes = new Map<string, { name: string; mode: CuaMode; os_type: "linux"; status: "running" }>();
	shutdownCount = 0;

	async request(method: string, params: Record<string, unknown>): Promise<unknown> {
		this.calls.push({ method, params });
		if (method === "start_sandbox") {
			const name = typeof params.name === "string" ? params.name : "default";
			const mode = params.mode === "cloud" ? "cloud" : "local";
			this.sandboxes.set(name, { name, mode, os_type: "linux", status: "running" });
			return { name };
		}
		if (method === "list_sandboxes") {
			return { sandboxes: Array.from(this.sandboxes.values()) };
		}
		if (method === "screenshot") {
			return { png_b64: "iVBORw0KGgo=", width: 640, height: 480 };
		}
		if (method === "stop_sandbox") {
			if (typeof params.name === "string") this.sandboxes.delete(params.name);
			return { ok: true };
		}
		return { ok: true };
	}

	async shutdown(): Promise<void> {
		this.shutdownCount += 1;
	}
}

function session(): ToolSession {
	return {
		cwd: "/workspace/project",
		hasUI: false,
		getSessionFile: () => null,
		getSessionSpawns: () => null,
		getSessionId: () => "session-cua",
		settings: { get: () => undefined },
	} as unknown as ToolSession;
}

function resolved(mode: CuaMode): ResolvedCuaConfig {
	return {
		mode,
		local: { runtime: "auto", image: { os: "linux", kind: "container" }, ephemeral: true },
		localhost: { confirmDestructive: true },
		cloud: { apiKeyEnv: "CUA_API_KEY", image: { os: "linux", kind: "container" } },
		python: { executable: "python3", startupTimeoutMs: 100, requestTimeoutMs: 100 },
		telemetry: { enabled: false },
	};
}

function loaded(mode: CuaMode): LoadedCuaConfig {
	return { resolved: resolved(mode), sources: [] };
}

function textBlock(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content
		.filter(block => block.type === "text")
		.map(block => block.text ?? "")
		.join("\n");
}

describe("cua tool", () => {
	it("records a started local sandbox, lists it, and uses it as the default control target", async () => {
		const daemon = new FakeCuaDaemon();
		const tool = new CuaTool(session(), {
			readConfig: async () => loaded("local"),
			startDaemon: async () => daemon,
			env: {},
		});

		const start = await tool.execute("call-1", { action: "start", name: "desk" });
		expect(start.details?.sandbox).toBe("desk");

		await tool.execute("call-2", { action: "click", x: 10, y: 20 });
		const clickCall = daemon.calls.find(call => call.method === "click");
		expect(clickCall?.params).toMatchObject({ target_kind: "sandbox", target_name: "desk", x: 10, y: 20 });

		const list = await tool.execute("call-3", { action: "list" });
		expect(list.details?.sandboxes).toEqual([{ name: "desk", mode: "local", os: "linux", status: "running" }]);
		expect(textBlock(list)).toContain("desk");
	});

	it("falls back from cloud to local without leaking secret values", async () => {
		const daemon = new FakeCuaDaemon();
		const envSeen: Record<string, string> = {};
		const config = loaded("cloud");
		config.resolved.cloud.apiKeyEnv = "SECRET_CUA_KEY";
		const tool = new CuaTool(session(), {
			readConfig: async () => config,
			startDaemon: async (_config, env) => {
				Object.assign(envSeen, env);
				return daemon;
			},
			env: { SECRET_CUA_KEY: "   ", UNRELATED_SECRET: "secret-value" },
		});

		const result = await tool.execute("call-1", { action: "start", name: "fallback" });

		expect(result.details?.configuredMode).toBe("cloud");
		expect(result.details?.mode).toBe("local");
		expect(result.details?.warning).toContain("SECRET_CUA_KEY");
		expect(textBlock(result)).toContain("falling back to local mode");
		expect(JSON.stringify(result)).not.toContain("secret-value");
		expect(JSON.stringify(result)).not.toContain("SECRET_CUA_KEY=");
		expect(envSeen.CUA_TELEMETRY_ENABLED).toBe("false");
		expect(daemon.calls[0]?.params.mode).toBe("local");
	});

	it("returns text and PNG image content with screenshot dimensions", async () => {
		const daemon = new FakeCuaDaemon();
		const tool = new CuaTool(session(), {
			readConfig: async () => loaded("local"),
			startDaemon: async () => daemon,
			env: {},
		});
		await tool.execute("call-1", { action: "start", name: "screen" });

		const result = await tool.execute("call-2", { action: "screenshot" });

		expect(result.content.filter(block => block.type === "text")).toHaveLength(1);
		expect(result.content.filter(block => block.type === "image")).toEqual([
			{ type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" },
		]);
		expect(result.details?.screenshot).toEqual({ width: 640, height: 480, mimeType: "image/png" });
	});

	it("prefers dx and dy aliases over scrollX and scrollY", async () => {
		const daemon = new FakeCuaDaemon();
		const tool = new CuaTool(session(), {
			readConfig: async () => loaded("local"),
			startDaemon: async () => daemon,
			env: {},
		});
		await tool.execute("call-1", { action: "start", name: "scrollbox" });

		await tool.execute("call-2", { action: "scroll", x: 1, y: 2, dx: 3, dy: 4, scrollX: 30, scrollY: 40 });

		const scrollCall = daemon.calls.find(call => call.method === "scroll");
		expect(scrollCall?.params).toMatchObject({ scroll_x: 3, scroll_y: 4 });
	});

	it("rejects start in localhost mode but allows controls without a sandbox name", async () => {
		const daemon = new FakeCuaDaemon();
		const tool = new CuaTool(session(), {
			readConfig: async () => loaded("localhost"),
			startDaemon: async () => daemon,
			env: {},
		});

		const start = await tool.execute("call-1", { action: "start", name: "ignored" });
		expect(start.isError).toBe(true);
		expect(textBlock(start)).toContain("disabled in localhost mode");

		const click = await tool.execute("call-2", { action: "click", x: 5, y: 6 });
		expect(click.isError).toBeUndefined();
		expect(daemon.calls.find(call => call.method === "click")?.params).toMatchObject({
			target_kind: "localhost",
			x: 5,
			y: 6,
		});
	});
});
