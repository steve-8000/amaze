import { execFile } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { join } from "node:path";
import type { ImageContent, TextContent } from "@steve-8000/amaze-ai";
import { getPackageDir } from "../../config.ts";
import type { CodebaseMemoryNativeCallableToolName } from "./contract.ts";

const ENV_CODEBASE_MEMORY_BIN = "AMAZE_CODEBASE_MEMORY_MCP_BIN";
const NATIVE_BINARY_DIR = "codebase-memory-mcp";
const EXEC_MAX_BUFFER_BYTES = 64 * 1024 * 1024;
const DEFAULT_EXEC_TIMEOUT_MS = 10 * 60 * 1000;

export type CodebaseMemoryBinarySource = "env" | "package" | "missing";

export interface ResolveCodebaseMemoryBinaryOptions {
	env?: NodeJS.ProcessEnv;
	packageDir?: string;
	platform?: NodeJS.Platform;
	arch?: string;
}

export interface CodebaseMemoryBinaryResolution {
	path?: string;
	source: CodebaseMemoryBinarySource;
	platform: string;
	checked_paths: string[];
}

export interface CodebaseMemoryNativeAdapterOptions extends ResolveCodebaseMemoryBinaryOptions {
	cwd?: string;
	timeoutMs?: number;
}

interface ExecTextResult {
	stdout: string;
	stderr: string;
}

export type CodebaseMemoryNativeContent = TextContent | ImageContent;

export interface CodebaseMemoryNativeCallOptions {
	signal?: AbortSignal;
	timeoutMs?: number;
}

export interface CodebaseMemoryNativeCallResult {
	result: unknown;
	isError: boolean;
	envelope: unknown;
	content: CodebaseMemoryNativeContent[];
	stdout: string;
	stderr: string;
}

export class CodebaseMemoryNativeError extends Error {
	readonly code?: number | string;
	readonly stderr?: string;
	readonly stdout?: string;

	constructor(message: string, options: { code?: number | string; stderr?: string; stdout?: string } = {}) {
		super(message);
		this.name = "CodebaseMemoryNativeError";
		this.code = options.code;
		this.stderr = options.stderr;
		this.stdout = options.stdout;
	}
}

export class CodebaseMemoryNativeAdapter {
	private readonly cwd?: string;
	private readonly env: NodeJS.ProcessEnv;
	private readonly packageDir?: string;
	private readonly platform?: NodeJS.Platform;
	private readonly arch?: string;
	private readonly timeoutMs: number;

	constructor(options: CodebaseMemoryNativeAdapterOptions = {}) {
		this.cwd = options.cwd;
		this.env = { ...process.env, ...(options.env ?? {}) };
		this.packageDir = options.packageDir;
		this.platform = options.platform;
		this.arch = options.arch;
		this.timeoutMs = options.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
	}

	resolveBinary(): CodebaseMemoryBinaryResolution {
		return resolveCodebaseMemoryBinary({
			env: this.env,
			packageDir: this.packageDir,
			platform: this.platform,
			arch: this.arch,
		});
	}

	async callTool(
		toolName: CodebaseMemoryNativeCallableToolName,
		args: Record<string, unknown> = {},
		options: CodebaseMemoryNativeCallOptions = {},
	): Promise<unknown> {
		const result = await this.callToolResult(toolName, args, options);
		if (result.isError) {
			throw new CodebaseMemoryNativeError(formatNativeError(result.result), {
				stderr: result.stderr,
				stdout: result.stdout,
			});
		}
		return result.result;
	}

	async callToolResult(
		toolName: CodebaseMemoryNativeCallableToolName,
		args: Record<string, unknown> = {},
		options: CodebaseMemoryNativeCallOptions = {},
	): Promise<CodebaseMemoryNativeCallResult> {
		if (options.signal?.aborted) {
			throw new CodebaseMemoryNativeError("codebase-memory-mcp aborted before start.", { code: "ABORT_ERR" });
		}
		const resolution = this.resolveBinary();
		if (!resolution.path) {
			throw new CodebaseMemoryNativeError(
				`codebase-memory-mcp native binary not found. Set ${ENV_CODEBASE_MEMORY_BIN} or ship a packaged binary.`,
				{ stderr: resolution.checked_paths.join("\n") },
			);
		}

		const { stdout, stderr } = await execFileText(
			resolution.path,
			["cli", "--json", toolName, JSON.stringify(args)],
			{
				cwd: this.cwd,
				env: this.env,
				signal: options.signal,
				timeoutMs: options.timeoutMs ?? this.timeoutMs,
			},
		);
		return parseMcpCliJson(stdout, stderr);
	}
}

export function currentCodebaseMemoryPlatform(
	platform: NodeJS.Platform = process.platform,
	arch: string = process.arch,
): string {
	if (platform === "darwin") return arch === "arm64" ? "darwin-arm64" : "darwin-x64";
	if (platform === "linux") return arch === "arm64" ? "linux-arm64" : "linux-x64";
	if (platform === "win32") return arch === "arm64" ? "windows-arm64" : "windows-x64";
	return `${platform}-${arch}`;
}

export function resolveCodebaseMemoryBinary(
	options: ResolveCodebaseMemoryBinaryOptions = {},
): CodebaseMemoryBinaryResolution {
	const env = options.env ?? process.env;
	const packageDir = options.packageDir ?? getPackageDir();
	const platform = options.platform ?? process.platform;
	const arch = options.arch ?? process.arch;
	const platformId = currentCodebaseMemoryPlatform(platform, arch);
	const binaryName = platformId.startsWith("windows-") ? "codebase-memory-mcp.exe" : "codebase-memory-mcp";
	const checkedPaths: string[] = [];

	const envPath = env[ENV_CODEBASE_MEMORY_BIN];
	if (envPath) {
		checkedPaths.push(envPath);
		if (isUsableExecutable(envPath, platform)) {
			return { path: envPath, source: "env", platform: platformId, checked_paths: checkedPaths };
		}
	}

	const packageCandidates = [
		join(packageDir, "native", NATIVE_BINARY_DIR, platformId, binaryName),
		join(packageDir, NATIVE_BINARY_DIR, platformId, binaryName),
		join(packageDir, "bin", NATIVE_BINARY_DIR, platformId, binaryName),
	];
	for (const candidate of packageCandidates) {
		checkedPaths.push(candidate);
		if (isUsableExecutable(candidate, platform)) {
			return { path: candidate, source: "package", platform: platformId, checked_paths: checkedPaths };
		}
	}

	return { source: "missing", platform: platformId, checked_paths: checkedPaths };
}

function isUsableExecutable(path: string, platform: NodeJS.Platform): boolean {
	try {
		if (!statSync(path).isFile()) return false;
		if (platform === "win32") return true;
		accessSync(path, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

function execFileText(
	file: string,
	args: string[],
	options: { cwd?: string; env: NodeJS.ProcessEnv; signal?: AbortSignal; timeoutMs: number },
): Promise<ExecTextResult> {
	return new Promise((resolve, reject) => {
		execFile(
			file,
			args,
			{
				cwd: options.cwd,
				encoding: "utf8",
				env: options.env,
				maxBuffer: EXEC_MAX_BUFFER_BYTES,
				signal: options.signal,
				timeout: options.timeoutMs,
			},
			(error, stdout, stderr) => {
				if (error) {
					const code = typeof error.code === "number" || typeof error.code === "string" ? error.code : undefined;
					const message = options.signal?.aborted
						? "codebase-memory-mcp aborted."
						: `codebase-memory-mcp failed: ${error.message}`;
					reject(
						new CodebaseMemoryNativeError(message, {
							code,
							stderr,
							stdout,
						}),
					);
					return;
				}
				resolve({ stdout, stderr });
			},
		);
	});
}

function parseMcpCliJson(stdout: string, stderr: string): CodebaseMemoryNativeCallResult {
	const trimmed = stdout.trim();
	if (!trimmed) {
		throw new CodebaseMemoryNativeError("codebase-memory-mcp returned empty stdout.", { stderr, stdout });
	}

	let envelope: unknown;
	try {
		envelope = JSON.parse(trimmed) as unknown;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new CodebaseMemoryNativeError(`codebase-memory-mcp returned invalid JSON: ${message}`, { stderr, stdout });
	}

	if (!isRecord(envelope)) return createCallResult(envelope, false, envelope, stdout, stderr);
	const isError = envelope.isError === true;
	const content = envelope.content;
	if (!Array.isArray(content) || content.length === 0) {
		return createCallResult(envelope, isError, envelope, stdout, stderr);
	}
	const first = content[0];
	if (!isRecord(first) || typeof first.text !== "string") {
		return createCallResult(envelope, isError, envelope, stdout, stderr);
	}
	try {
		return createCallResult(JSON.parse(first.text) as unknown, isError, envelope, stdout, stderr);
	} catch {
		return createCallResult(first.text, isError, envelope, stdout, stderr);
	}
}

function createCallResult(
	result: unknown,
	isError: boolean,
	envelope: unknown,
	stdout: string,
	stderr: string,
): CodebaseMemoryNativeCallResult {
	return {
		result,
		isError,
		envelope,
		content: nativeContentFromEnvelope(envelope, result),
		stdout,
		stderr,
	};
}

function nativeContentFromEnvelope(envelope: unknown, result: unknown): CodebaseMemoryNativeContent[] {
	if (isRecord(envelope) && Array.isArray(envelope.content)) {
		const content = envelope.content.filter(isNativeContentBlock);
		if (content.length > 0) return content;
	}
	if (typeof result === "string") return [{ type: "text", text: result }];
	return [{ type: "text", text: JSON.stringify(result, null, 2) }];
}

function isNativeContentBlock(value: unknown): value is CodebaseMemoryNativeContent {
	if (!isRecord(value) || typeof value.type !== "string") return false;
	if (value.type === "text") return typeof value.text === "string";
	if (value.type === "image") return typeof value.data === "string" && typeof value.mimeType === "string";
	return false;
}

function formatNativeError(result: unknown): string {
	if (isRecord(result)) {
		const error = result.error;
		if (typeof error === "string" && error.length > 0) {
			return error;
		}
		const message = result.message;
		if (typeof message === "string" && message.length > 0) {
			return message;
		}
	}
	if (typeof result === "string" && result.length > 0) {
		return result;
	}
	return "codebase-memory-mcp returned an error result.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
