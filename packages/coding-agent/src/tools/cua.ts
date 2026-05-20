import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@amaze/agent-core";
import type { Component } from "@amaze/tui";
import { Text } from "@amaze/tui";
import { prompt } from "@amaze/utils";
import type { Subprocess } from "bun";
import * as z from "zod/v4";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import type { Theme } from "../modes/theme/theme";
import cuaDescription from "../prompts/tools/cua.md" with { type: "text" };
import type { ToolSession } from "../sdk";
import { renderStatusLine } from "../tui";
import daemonSource from "./cua-daemon.py" with { type: "text" };
import type { OutputMeta } from "./output-meta";
import { replaceTabs, shortenPath } from "./render-utils";
import { ToolAbortError, ToolError, throwIfAborted } from "./tool-errors";
import { toolResult } from "./tool-result";

const DEFAULT_SANDBOX = "default";
const PROJECT_CONFIG_RELATIVE_PATH = ".amaze/cua.jsonc";
const GLOBAL_CONFIG_RELATIVE_PATH = ".amaze/cua.json";
const DAEMON_CACHE_DIR = path.join(os.tmpdir(), "amaze-cua-daemon");
const SHUTDOWN_GRACE_MS = 1_000;

export type CuaMode = "local" | "localhost" | "cloud";
export type CuaOS = "linux" | "macos" | "windows" | "android";
export type CuaKind = "vm" | "container";
export type CuaRuntime = "auto" | "docker" | "qemu" | "lume" | "tart";
export type MouseButton = "left" | "right" | "middle";

const cuaSchema = z.object({
	action: z
		.enum(["start", "stop", "list", "screenshot", "click", "type", "key", "scroll", "shutdown"] as const)
		.describe("operation"),
	sandbox: z.string().describe("sandbox name for control actions").optional(),
	name: z.string().describe("sandbox name for start/stop").optional(),
	os: z
		.enum(["linux", "macos", "windows", "android"] as const)
		.describe("sandbox image OS")
		.optional(),
	version: z.string().describe("sandbox image version").optional(),
	kind: z
		.enum(["vm", "container"] as const)
		.describe("sandbox image kind")
		.optional(),
	runtime: z
		.enum(["auto", "docker", "qemu", "lume", "tart"] as const)
		.describe("local runtime")
		.optional(),
	x: z.number().describe("x coordinate").optional(),
	y: z.number().describe("y coordinate").optional(),
	button: z
		.enum(["left", "right", "middle"] as const)
		.describe("mouse button")
		.optional(),
	clicks: z.number().describe("click count").optional(),
	text: z.string().describe("text to type").optional(),
	keys: z
		.union([z.string(), z.array(z.string())])
		.describe("key chord(s)")
		.optional(),
	dx: z.number().describe("horizontal scroll delta").optional(),
	dy: z.number().describe("vertical scroll delta").optional(),
	scrollX: z.number().describe("horizontal scroll delta").optional(),
	scrollY: z.number().describe("vertical scroll delta").optional(),
});

export type CuaParams = z.infer<typeof cuaSchema>;

export interface CuaSandboxDetails {
	name: string;
	mode: CuaMode;
	os?: CuaOS;
	kind?: CuaKind;
	runtime?: CuaRuntime;
	status?: string;
}

export interface CuaScreenshotDetails {
	width: number;
	height: number;
	mimeType: "image/png";
}

export interface CuaToolDetails {
	meta?: OutputMeta;
	action: CuaParams["action"];
	mode?: CuaMode;
	configuredMode?: CuaMode;
	warning?: string;
	sandbox?: string;
	sandboxes?: CuaSandboxDetails[];
	screenshot?: CuaScreenshotDetails;
	cuaAvailable?: boolean;
	cuaVersion?: string;
	cuaImportError?: string;
	apiKeyEnv?: string;
	result?: string;
}

export interface RawCuaConfig {
	mode?: CuaMode;
	local?: {
		runtime?: CuaRuntime;
		image?: { os?: CuaOS; version?: string; kind?: CuaKind };
		ephemeral?: boolean;
	};
	localhost?: { confirmDestructive?: boolean };
	cloud?: { apiKeyEnv?: string; image?: { os?: CuaOS; version?: string; kind?: CuaKind }; region?: string };
	python?: { executable?: string; startupTimeoutMs?: number; requestTimeoutMs?: number };
	telemetry?: { enabled?: boolean };
}

export interface ResolvedCuaConfig {
	mode: CuaMode;
	local: { runtime: CuaRuntime; image: { os: CuaOS; version?: string; kind: CuaKind }; ephemeral: boolean };
	localhost: { confirmDestructive: boolean };
	cloud: { apiKeyEnv: string; image: { os: CuaOS; version?: string; kind: CuaKind }; region?: string };
	python: { executable: string; startupTimeoutMs: number; requestTimeoutMs: number };
	telemetry: { enabled: boolean };
}

export interface LoadedCuaConfig {
	resolved: ResolvedCuaConfig;
	sources: string[];
	raw?: RawCuaConfig;
}

interface EffectiveCuaConfig extends LoadedCuaConfig {
	configuredMode: CuaMode;
	warning?: string;
	apiKey?: string;
}

export interface CuaReadyEvent {
	type: "ready";
	version: string;
	cuaAvailable: boolean;
	cuaVersion?: string | null;
	cuaImportError?: string | null;
}

interface CuaSandboxListEntry {
	name: string;
	mode?: CuaMode;
	os_type?: CuaOS;
	status?: string;
}

interface CuaScreenshotResponse {
	png_b64: string;
	width: number;
	height: number;
}

export interface CuaDaemonClient {
	readonly ready: CuaReadyEvent;
	request(method: string, params: Record<string, unknown>, timeoutMs?: number, signal?: AbortSignal): Promise<unknown>;
	shutdown(): Promise<void>;
}

export interface CuaToolDeps {
	readConfig?: (cwd: string, home: string) => Promise<LoadedCuaConfig>;
	startDaemon?: (
		config: ResolvedCuaConfig,
		env: Record<string, string>,
		signal?: AbortSignal,
	) => Promise<CuaDaemonClient>;
	env?: Record<string, string | undefined>;
	home?: string;
}

interface PendingRequest {
	resolve: (value: unknown) => void;
	reject: (reason?: unknown) => void;
}

let daemonScriptPath: string | undefined;
const liveClients = new Set<CuaDaemonClient>();
let cleanupRegistered = false;

function registerProcessCleanup(): void {
	if (cleanupRegistered) return;
	cleanupRegistered = true;
	const cleanup = () => {
		for (const client of Array.from(liveClients)) {
			void client.shutdown().catch(() => {});
		}
	};
	process.once("beforeExit", cleanup);
	process.once("exit", cleanup);
}

async function ensureDaemonScript(): Promise<string> {
	if (daemonScriptPath) return daemonScriptPath;
	await fs.mkdir(DAEMON_CACHE_DIR, { recursive: true });
	const hash = Bun.hash(daemonSource).toString(36);
	const target = path.join(DAEMON_CACHE_DIR, `cua-daemon-${hash}.py`);
	await Bun.write(target, daemonSource);
	daemonScriptPath = target;
	return target;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseMode(value: unknown): CuaMode | undefined {
	return value === "local" || value === "localhost" || value === "cloud" ? value : undefined;
}

function parseOS(value: unknown): CuaOS | undefined {
	return value === "linux" || value === "macos" || value === "windows" || value === "android" ? value : undefined;
}

function parseKind(value: unknown): CuaKind | undefined {
	return value === "vm" || value === "container" ? value : undefined;
}

function parseRuntime(value: unknown): CuaRuntime | undefined {
	return value === "auto" || value === "docker" || value === "qemu" || value === "lume" || value === "tart"
		? value
		: undefined;
}

function parseBool(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}

function parseRawConfig(value: unknown, source: string): RawCuaConfig {
	if (!isObject(value)) throw new ToolError(`Invalid CUA config at ${source}: expected object.`);
	const known = new Set(["mode", "local", "localhost", "cloud", "python", "telemetry"]);
	for (const key of Object.keys(value)) {
		if (!known.has(key)) {
			throw new ToolError(`Invalid CUA config at ${source}: unrecognised top-level key ${JSON.stringify(key)}.`);
		}
	}
	const local = isObject(value.local) ? value.local : undefined;
	const localImage = isObject(local?.image) ? local.image : undefined;
	const cloud = isObject(value.cloud) ? value.cloud : undefined;
	const cloudImage = isObject(cloud?.image) ? cloud.image : undefined;
	const localhost = isObject(value.localhost) ? value.localhost : undefined;
	const python = isObject(value.python) ? value.python : undefined;
	const telemetry = isObject(value.telemetry) ? value.telemetry : undefined;
	return {
		mode: parseMode(value.mode),
		local: local
			? {
					runtime: parseRuntime(local.runtime),
					image: localImage
						? {
								os: parseOS(localImage.os),
								version: optionalString(localImage.version),
								kind: parseKind(localImage.kind),
							}
						: undefined,
					ephemeral: parseBool(local.ephemeral),
				}
			: undefined,
		localhost: localhost ? { confirmDestructive: parseBool(localhost.confirmDestructive) } : undefined,
		cloud: cloud
			? {
					apiKeyEnv: optionalString(cloud.apiKeyEnv),
					image: cloudImage
						? {
								os: parseOS(cloudImage.os),
								version: optionalString(cloudImage.version),
								kind: parseKind(cloudImage.kind),
							}
						: undefined,
					region: optionalString(cloud.region),
				}
			: undefined,
		python: python
			? {
					executable: optionalString(python.executable),
					startupTimeoutMs: optionalNumber(python.startupTimeoutMs),
					requestTimeoutMs: optionalNumber(python.requestTimeoutMs),
				}
			: undefined,
		telemetry: telemetry ? { enabled: parseBool(telemetry.enabled) } : undefined,
	};
}

function mergeConfigs(
	globalConfig: RawCuaConfig | undefined,
	projectConfig: RawCuaConfig | undefined,
): RawCuaConfig | undefined {
	if (!globalConfig && !projectConfig) return undefined;
	const base = globalConfig ?? {};
	const override = projectConfig ?? {};
	const local =
		override.local === undefined
			? base.local
			: {
					...(base.local ?? {}),
					...override.local,
					image: { ...(base.local?.image ?? {}), ...(override.local.image ?? {}) },
				};
	const cloud =
		override.cloud === undefined
			? base.cloud
			: {
					...(base.cloud ?? {}),
					...override.cloud,
					image: { ...(base.cloud?.image ?? {}), ...(override.cloud.image ?? {}) },
				};
	return {
		...base,
		...(override.mode !== undefined ? { mode: override.mode } : {}),
		...(local !== undefined ? { local } : {}),
		...(override.localhost !== undefined ? { localhost: { ...(base.localhost ?? {}), ...override.localhost } } : {}),
		...(cloud !== undefined ? { cloud } : {}),
		...(override.python !== undefined ? { python: { ...(base.python ?? {}), ...override.python } } : {}),
		...(override.telemetry !== undefined ? { telemetry: { ...(base.telemetry ?? {}), ...override.telemetry } } : {}),
	};
}

function normalizeConfig(raw: RawCuaConfig | undefined): ResolvedCuaConfig {
	return {
		mode: raw?.mode ?? "local",
		local: {
			runtime: raw?.local?.runtime ?? "auto",
			ephemeral: raw?.local?.ephemeral ?? true,
			image: {
				os: raw?.local?.image?.os ?? "linux",
				version: raw?.local?.image?.version,
				kind: raw?.local?.image?.kind ?? "container",
			},
		},
		localhost: { confirmDestructive: raw?.localhost?.confirmDestructive ?? true },
		cloud: {
			apiKeyEnv: raw?.cloud?.apiKeyEnv ?? "CUA_API_KEY",
			region: raw?.cloud?.region,
			image: {
				os: raw?.cloud?.image?.os ?? "linux",
				version: raw?.cloud?.image?.version,
				kind: raw?.cloud?.image?.kind ?? "container",
			},
		},
		python: {
			executable: raw?.python?.executable ?? "python3",
			startupTimeoutMs: raw?.python?.startupTimeoutMs ?? 30_000,
			requestTimeoutMs: raw?.python?.requestTimeoutMs ?? 60_000,
		},
		telemetry: { enabled: raw?.telemetry?.enabled ?? false },
	};
}

async function readJsonConfig(filePath: string): Promise<RawCuaConfig | undefined> {
	try {
		const parsed = Bun.JSON5.parse(await Bun.file(filePath).text()) as unknown;
		return parseRawConfig(parsed, filePath);
	} catch (error) {
		if (error && typeof error === "object" && "code" in error) {
			const code = String((error as { code?: unknown }).code);
			if (code === "ENOENT" || code === "ENOTDIR") return undefined;
		}
		throw error;
	}
}

async function defaultReadConfig(cwd: string, home: string): Promise<LoadedCuaConfig> {
	const projectPath = path.resolve(cwd, PROJECT_CONFIG_RELATIVE_PATH);
	const globalPath = path.resolve(home, GLOBAL_CONFIG_RELATIVE_PATH);
	const [projectConfig, globalConfig] = await Promise.all([readJsonConfig(projectPath), readJsonConfig(globalPath)]);
	const raw = mergeConfigs(globalConfig, projectConfig);
	const sources: string[] = [];
	if (globalConfig) sources.push(globalPath);
	if (projectConfig) sources.push(projectPath);
	return { resolved: normalizeConfig(raw), sources, raw };
}

function resolveEffectiveConfig(loaded: LoadedCuaConfig, env: Record<string, string | undefined>): EffectiveCuaConfig {
	const configuredMode = loaded.resolved.mode;
	if (configuredMode !== "cloud") return { ...loaded, configuredMode };
	const apiKeyEnv = loaded.resolved.cloud.apiKeyEnv;
	const apiKey = env[apiKeyEnv]?.trim();
	if (apiKey) return { ...loaded, configuredMode, apiKey };
	return {
		...loaded,
		configuredMode,
		resolved: { ...loaded.resolved, mode: "local" },
		warning: `CUA mode is configured as cloud but ${apiKeyEnv} is not set; falling back to local mode.`,
	};
}

function daemonEnv(
	config: ResolvedCuaConfig,
	env: Record<string, string | undefined>,
	apiKey?: string,
): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(env)) {
		if (typeof value === "string") result[key] = value;
	}
	result.PYTHONUNBUFFERED = "1";
	result.PYTHONIOENCODING = "utf-8";
	if (config.telemetry.enabled) {
		result.CUA_TELEMETRY_ENABLED = "true";
	} else {
		result.CUA_TELEMETRY_ENABLED = "false";
	}
	if (apiKey) result[config.cloud.apiKeyEnv] = apiKey;
	return result;
}

function timeoutPromise(ms: number, label: string, signal?: AbortSignal): Promise<never> {
	const deferred = Promise.withResolvers<never>();
	let settled = false;
	const abort = () => {
		if (settled) return;
		settled = true;
		deferred.reject(new ToolAbortError());
	};
	if (signal?.aborted) abort();
	signal?.addEventListener("abort", abort, { once: true });
	void Bun.sleep(ms).then(() => {
		if (settled) return;
		settled = true;
		signal?.removeEventListener("abort", abort);
		deferred.reject(new ToolError(`${label} timed out after ${ms}ms.`));
	});
	return deferred.promise;
}

class ProcessCuaDaemonClient implements CuaDaemonClient {
	readonly ready: CuaReadyEvent;
	#proc: Subprocess<"pipe", "pipe", "pipe">;
	#stdin: Bun.FileSink;
	#buffer = "";
	#pending = new Map<number, PendingRequest>();
	#nextId = 1;
	#closed = false;

	constructor(proc: Subprocess<"pipe", "pipe", "pipe">, ready: CuaReadyEvent) {
		this.#proc = proc;
		this.#stdin = proc.stdin;
		this.ready = ready;
		this.#startReader(proc.stdout as ReadableStream<Uint8Array>);
		this.#startStderrDrain(proc.stderr as ReadableStream<Uint8Array>);
		void proc.exited.then(code => {
			this.#closed = true;
			for (const pending of this.#pending.values()) {
				pending.reject(new ToolError(`CUA daemon exited with code ${code}.`));
			}
			this.#pending.clear();
			liveClients.delete(this);
		});
	}

	async request(
		method: string,
		params: Record<string, unknown>,
		timeoutMs = 60_000,
		signal?: AbortSignal,
	): Promise<unknown> {
		if (this.#closed) throw new ToolError("CUA daemon is not running.");
		const id = this.#nextId++;
		const deferred = Promise.withResolvers<unknown>();
		this.#pending.set(id, { resolve: deferred.resolve, reject: deferred.reject });
		try {
			this.#stdin.write(`${JSON.stringify({ id, method, params })}\n`);
			this.#stdin.flush();
		} catch (error) {
			this.#pending.delete(id);
			throw error;
		}
		return await Promise.race([deferred.promise, timeoutPromise(timeoutMs, `CUA ${method}`, signal)]);
	}

	async shutdown(): Promise<void> {
		if (this.#closed) return;
		try {
			await this.request("shutdown", {}, SHUTDOWN_GRACE_MS).catch(() => undefined);
			this.#closed = true;
		} finally {
			try {
				this.#stdin.end();
			} catch {
				/* ignore */
			}
			const exited = await Promise.race([
				this.#proc.exited.then(() => true),
				Bun.sleep(SHUTDOWN_GRACE_MS).then(() => false),
			]);
			if (!exited) this.#proc.kill("SIGTERM");
			liveClients.delete(this);
		}
	}

	#startReader(stream: ReadableStream<Uint8Array>): void {
		const reader = stream.getReader();
		const decoder = new TextDecoder();
		const loop = async () => {
			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					this.#buffer += decoder.decode(value, { stream: true });
					this.#flushFrames();
				}
				this.#buffer += decoder.decode();
				this.#flushFrames();
			} finally {
				try {
					reader.releaseLock();
				} catch {
					/* ignore */
				}
			}
		};
		void loop();
	}

	#startStderrDrain(stream: ReadableStream<Uint8Array>): void {
		const reader = stream.getReader();
		const loop = async () => {
			try {
				while (true) {
					const { done } = await reader.read();
					if (done) break;
				}
			} finally {
				try {
					reader.releaseLock();
				} catch {
					/* ignore */
				}
			}
		};
		void loop();
	}

	#flushFrames(): void {
		while (true) {
			const newline = this.#buffer.indexOf("\n");
			if (newline < 0) return;
			const line = this.#buffer.slice(0, newline).trim();
			this.#buffer = this.#buffer.slice(newline + 1);
			if (!line) continue;
			const frame = JSON.parse(line) as unknown;
			if (!isObject(frame) || typeof frame.id !== "number") continue;
			const pending = this.#pending.get(frame.id);
			if (!pending) continue;
			this.#pending.delete(frame.id);
			if (isObject(frame.error)) {
				const message =
					typeof frame.error.message === "string" ? frame.error.message : "CUA daemon request failed.";
				pending.reject(new ToolError(message));
			} else {
				pending.resolve(frame.result);
			}
		}
	}
}

async function readReadyEvent(
	stream: ReadableStream<Uint8Array>,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<CuaReadyEvent> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	const ready = (async () => {
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) throw new ToolError("CUA daemon exited before ready.");
				buffer += decoder.decode(value, { stream: true });
				const newline = buffer.indexOf("\n");
				if (newline < 0) continue;
				const line = buffer.slice(0, newline).trim();
				if (!line) continue;
				const frame = JSON.parse(line) as unknown;
				if (isObject(frame) && frame.type === "ready") return frame as unknown as CuaReadyEvent;
			}
		} finally {
			reader.releaseLock();
		}
	})();
	return await Promise.race([ready, timeoutPromise(timeoutMs, "CUA daemon startup", signal)]);
}

async function defaultStartDaemon(
	config: ResolvedCuaConfig,
	env: Record<string, string>,
	signal?: AbortSignal,
): Promise<CuaDaemonClient> {
	registerProcessCleanup();
	const scriptPath = await ensureDaemonScript();
	const proc = Bun.spawn([config.python.executable, "-u", scriptPath], {
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
		env,
		windowsHide: true,
	});
	try {
		const ready = await readReadyEvent(
			proc.stdout as ReadableStream<Uint8Array>,
			config.python.startupTimeoutMs,
			signal,
		);
		const client = new ProcessCuaDaemonClient(proc, ready);
		liveClients.add(client);
		return client;
	} catch (error) {
		proc.kill("SIGTERM");
		throw error;
	}
}

function isSandboxListResponse(value: unknown): value is { sandboxes: CuaSandboxListEntry[] } {
	return isObject(value) && Array.isArray(value.sandboxes);
}

function isScreenshotResponse(value: unknown): value is CuaScreenshotResponse {
	return (
		isObject(value) &&
		typeof value.png_b64 === "string" &&
		typeof value.width === "number" &&
		typeof value.height === "number"
	);
}

function errorResult(details: CuaToolDetails, message: string): AgentToolResult<CuaToolDetails> {
	details.result = message;
	return { content: [{ type: "text", text: message }], details, isError: true };
}

function textResult(details: CuaToolDetails, text: string): AgentToolResult<CuaToolDetails> {
	const output = details.warning && !text.includes(details.warning) ? `${details.warning}\n${text}` : text;
	details.result = output;
	return toolResult(details).text(output).done();
}

export class CuaTool implements AgentTool<typeof cuaSchema, CuaToolDetails> {
	readonly name = "cua";
	readonly label = "CUA";
	readonly loadMode = "discoverable";
	readonly summary = "Control CUA computer-use sandboxes and localhost targets";
	readonly parameters = cuaSchema;
	readonly strict = true;
	#session: ToolSession;
	#deps: CuaToolDeps;
	#description?: string;
	#client?: CuaDaemonClient;
	#effective?: EffectiveCuaConfig;
	#tracked = new Map<string, CuaSandboxDetails>();
	#defaultSandbox?: string;

	constructor(session: ToolSession, deps: CuaToolDeps = {}) {
		this.#session = session;
		this.#deps = deps;
	}

	get description(): string {
		this.#description ??= prompt.render(cuaDescription, {});
		return this.#description;
	}

	async execute(
		_toolCallId: string,
		params: CuaParams,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<CuaToolDetails>,
		_ctx?: AgentToolContext,
	): Promise<AgentToolResult<CuaToolDetails>> {
		throwIfAborted(signal);
		const effective = await this.#getEffectiveConfig();
		const details: CuaToolDetails = {
			action: params.action,
			mode: effective.resolved.mode,
			configuredMode: effective.configuredMode,
			warning: effective.warning,
			apiKeyEnv: effective.resolved.cloud.apiKeyEnv,
		};
		try {
			switch (params.action) {
				case "start":
					return await this.#start(params, effective, details, signal);
				case "stop":
					return await this.#stop(params, effective, details, signal);
				case "list":
					return await this.#list(effective, details, signal);
				case "screenshot":
					return await this.#screenshot(params, effective, details, signal);
				case "click":
					return await this.#control("click", this.#clickParams(params, effective), effective, details, signal);
				case "type":
					return await this.#control("type", this.#typeParams(params, effective), effective, details, signal);
				case "key":
					return await this.#control("key", this.#keyParams(params, effective), effective, details, signal);
				case "scroll":
					return await this.#control("scroll", this.#scrollParams(params, effective), effective, details, signal);
				case "shutdown":
					return await this.#shutdown(details);
			}
		} catch (error) {
			if (error instanceof ToolAbortError) throw error;
			if (error instanceof Error && error.name === "AbortError") throw new ToolAbortError();
			throw error;
		}
	}

	async #getEffectiveConfig(): Promise<EffectiveCuaConfig> {
		if (this.#effective) return this.#effective;
		const home = this.#deps.home ?? os.homedir();
		const loaded = await (this.#deps.readConfig ?? defaultReadConfig)(this.#session.cwd, home);
		this.#effective = resolveEffectiveConfig(loaded, this.#deps.env ?? process.env);
		return this.#effective;
	}

	async #getClient(effective: EffectiveCuaConfig, signal?: AbortSignal): Promise<CuaDaemonClient> {
		if (this.#client) return this.#client;
		const env = daemonEnv(effective.resolved, this.#deps.env ?? process.env, effective.apiKey);
		const client = await (this.#deps.startDaemon ?? defaultStartDaemon)(effective.resolved, env, signal);
		this.#client = client;
		return client;
	}

	async #start(
		params: CuaParams,
		effective: EffectiveCuaConfig,
		details: CuaToolDetails,
		signal?: AbortSignal,
	): Promise<AgentToolResult<CuaToolDetails>> {
		if (effective.resolved.mode === "localhost") {
			return errorResult(
				details,
				"CUA start is disabled in localhost mode because localhost mode does not use sandboxes.",
			);
		}
		const client = await this.#getClient(effective, signal);
		this.#attachReady(details, client);
		const image =
			effective.resolved.mode === "cloud" ? effective.resolved.cloud.image : effective.resolved.local.image;
		const name = params.name ?? DEFAULT_SANDBOX;
		const request: Record<string, unknown> = {
			mode: effective.resolved.mode,
			name,
			os: params.os ?? image.os,
			version: params.version ?? image.version,
			kind: params.kind ?? image.kind,
		};
		if (effective.resolved.mode === "local") {
			request.runtime = params.runtime ?? effective.resolved.local.runtime;
		}
		if (effective.resolved.mode === "cloud") {
			request.api_key = effective.apiKey;
			request.region = effective.resolved.cloud.region;
		}
		const response = await client.request(
			"start_sandbox",
			request,
			effective.resolved.python.requestTimeoutMs,
			signal,
		);
		const resolvedName = isObject(response) && typeof response.name === "string" ? response.name : name;
		const sandbox: CuaSandboxDetails = {
			name: resolvedName,
			mode: effective.resolved.mode,
			os: request.os as CuaOS,
			kind: request.kind as CuaKind,
			runtime: request.runtime as CuaRuntime | undefined,
			status: "running",
		};
		this.#tracked.set(resolvedName, sandbox);
		this.#defaultSandbox = resolvedName;
		details.sandbox = resolvedName;
		details.sandboxes = [sandbox];
		const warning = effective.warning ? `${effective.warning}\n` : "";
		return textResult(
			details,
			`${warning}Started CUA sandbox ${JSON.stringify(resolvedName)} in ${effective.resolved.mode} mode.`,
		);
	}

	async #stop(
		params: CuaParams,
		effective: EffectiveCuaConfig,
		details: CuaToolDetails,
		signal?: AbortSignal,
	): Promise<AgentToolResult<CuaToolDetails>> {
		const name = params.name;
		if (!name) throw new ToolError("Missing required parameter 'name' for CUA stop.");
		const client = await this.#getClient(effective, signal);
		this.#attachReady(details, client);
		await client.request("stop_sandbox", { name }, effective.resolved.python.requestTimeoutMs, signal);
		this.#tracked.delete(name);
		if (this.#defaultSandbox === name) this.#defaultSandbox = this.#tracked.keys().next().value;
		details.sandbox = name;
		return textResult(details, `Stopped CUA sandbox ${JSON.stringify(name)}.`);
	}

	async #list(
		effective: EffectiveCuaConfig,
		details: CuaToolDetails,
		signal?: AbortSignal,
	): Promise<AgentToolResult<CuaToolDetails>> {
		if (effective.resolved.mode === "localhost") {
			details.sandboxes = [];
			return textResult(details, "CUA localhost mode is active; no sandboxes are used.");
		}
		const client = await this.#getClient(effective, signal);
		this.#attachReady(details, client);
		const response = await client.request("list_sandboxes", {}, effective.resolved.python.requestTimeoutMs, signal);
		const sandboxes = isSandboxListResponse(response)
			? response.sandboxes.map(entry => ({
					name: entry.name,
					mode: entry.mode ?? this.#tracked.get(entry.name)?.mode ?? effective.resolved.mode,
					os: entry.os_type ?? this.#tracked.get(entry.name)?.os,
					status: entry.status,
				}))
			: Array.from(this.#tracked.values());
		details.sandboxes = sandboxes;
		if (sandboxes.length === 0) return textResult(details, "No active CUA sandboxes.");
		return textResult(details, sandboxes.map(s => `${s.name}\t${s.mode}\t${s.status ?? "running"}`).join("\n"));
	}

	async #screenshot(
		params: CuaParams,
		effective: EffectiveCuaConfig,
		details: CuaToolDetails,
		signal?: AbortSignal,
	): Promise<AgentToolResult<CuaToolDetails>> {
		const client = await this.#getClient(effective, signal);
		this.#attachReady(details, client);
		const target = this.#targetParams(params, effective);
		const response = await client.request("screenshot", target, effective.resolved.python.requestTimeoutMs, signal);
		if (!isScreenshotResponse(response)) {
			throw new ToolError("CUA daemon returned an invalid screenshot response.");
		}
		details.screenshot = { width: response.width, height: response.height, mimeType: "image/png" };
		details.sandbox = typeof target.target_name === "string" ? target.target_name : undefined;
		const text = `Screenshot captured (${response.width}×${response.height}).`;
		const output = details.warning ? `${details.warning}\n${text}` : text;
		details.result = output;
		return toolResult(details)
			.content([
				{ type: "text", text: output },
				{ type: "image", data: response.png_b64, mimeType: "image/png" },
			])
			.done();
	}

	async #control(
		method: "click" | "type" | "key" | "scroll",
		request: Record<string, unknown>,
		effective: EffectiveCuaConfig,
		details: CuaToolDetails,
		signal?: AbortSignal,
	): Promise<AgentToolResult<CuaToolDetails>> {
		const client = await this.#getClient(effective, signal);
		this.#attachReady(details, client);
		await client.request(method, request, effective.resolved.python.requestTimeoutMs, signal);
		details.sandbox = typeof request.target_name === "string" ? request.target_name : undefined;
		return textResult(details, `CUA ${method} completed.`);
	}

	#targetParams(params: CuaParams, effective: EffectiveCuaConfig): Record<string, unknown> {
		if (effective.resolved.mode === "localhost") return { target_kind: "localhost" };
		const name = params.sandbox ?? this.#defaultSandbox;
		if (!name) throw new ToolError("CUA action requires an active sandbox. Start one first or pass 'sandbox'.");
		return { target_kind: "sandbox", target_name: name };
	}

	#clickParams(params: CuaParams, effective: EffectiveCuaConfig): Record<string, unknown> {
		if (typeof params.x !== "number" || typeof params.y !== "number") {
			throw new ToolError("CUA click requires x and y.");
		}
		return {
			...this.#targetParams(params, effective),
			x: params.x,
			y: params.y,
			button: params.button ?? "left",
			clicks: params.clicks ?? 1,
		};
	}

	#typeParams(params: CuaParams, effective: EffectiveCuaConfig): Record<string, unknown> {
		if (typeof params.text !== "string") throw new ToolError("CUA type requires text.");
		return { ...this.#targetParams(params, effective), text: params.text };
	}

	#keyParams(params: CuaParams, effective: EffectiveCuaConfig): Record<string, unknown> {
		if (typeof params.keys !== "string" && !Array.isArray(params.keys)) {
			throw new ToolError("CUA key requires keys.");
		}
		return { ...this.#targetParams(params, effective), keys: params.keys };
	}

	#scrollParams(params: CuaParams, effective: EffectiveCuaConfig): Record<string, unknown> {
		if (typeof params.x !== "number" || typeof params.y !== "number") {
			throw new ToolError("CUA scroll requires x and y.");
		}
		return {
			...this.#targetParams(params, effective),
			x: params.x,
			y: params.y,
			scroll_x: params.dx ?? params.scrollX ?? 0,
			scroll_y: params.dy ?? params.scrollY ?? 0,
		};
	}

	async #shutdown(details: CuaToolDetails): Promise<AgentToolResult<CuaToolDetails>> {
		const client = this.#client;
		this.#client = undefined;
		this.#tracked.clear();
		this.#defaultSandbox = undefined;
		if (client) await client.shutdown();
		return textResult(details, "CUA daemon shut down.");
	}

	#attachReady(details: CuaToolDetails, client: CuaDaemonClient): void {
		details.cuaAvailable = client.ready.cuaAvailable;
		details.cuaVersion = client.ready.cuaVersion ?? undefined;
		details.cuaImportError = client.ready.cuaImportError ?? undefined;
	}
}

interface CuaRenderArgs {
	action?: CuaParams["action"];
	sandbox?: string;
	name?: string;
	x?: number;
	y?: number;
	text?: string;
	keys?: string | string[];
}

function renderTitle(args: CuaRenderArgs, details: CuaToolDetails | undefined): string {
	const action = details?.action ?? args.action ?? "cua";
	const target = details?.sandbox ?? args.sandbox ?? args.name;
	if (target) return `CUA ${action} ${JSON.stringify(target)}`;
	return `CUA ${action}`;
}

function extractText(content: Array<{ type: string; text?: string }> | undefined): string {
	return (
		content
			?.filter(c => c.type === "text")
			.map(c => c.text ?? "")
			.join("\n") ?? ""
	);
}

export const cuaToolRenderer = {
	renderCall(args: CuaRenderArgs, options: RenderResultOptions, theme: Theme): Component {
		const icon = options.isPartial ? "running" : "pending";
		return new Text(renderStatusLine({ icon, title: renderTitle(args, undefined) }, theme), 0, 0);
	},
	renderResult(
		result: {
			content: Array<{ type: string; text?: string }>;
			details?: CuaToolDetails;
			isError?: boolean;
		},
		options: RenderResultOptions,
		theme: Theme,
		args?: CuaRenderArgs,
	): Component {
		const icon = result.isError ? "error" : options.isPartial ? "running" : "success";
		const details = result.details;
		const meta: string[] = [];
		if (details?.mode) meta.push(details.mode);
		if (details?.screenshot) meta.push(`${details.screenshot.width}×${details.screenshot.height}`);
		const header = renderStatusLine({ icon, title: renderTitle(args ?? {}, details), meta }, theme);
		const text = extractText(result.content);
		if (!text) return new Text(header, 0, 0);
		return new Text(
			[header, ...text.split("\n").map(line => theme.fg("toolOutput", replaceTabs(shortenPath(line))))].join("\n"),
			0,
			0,
		);
	},
	mergeCallAndResult: true,
	inline: true,
};
