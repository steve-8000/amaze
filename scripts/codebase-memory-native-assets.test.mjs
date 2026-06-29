import { afterEach, describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	assertCodebaseMemoryNativeAsset,
	assertPackedCodebaseMemoryNativeAsset,
	cleanCodebaseMemoryNativeAssets,
	codebaseMemoryNativeNoticeRelativePaths,
	codebaseMemoryNativePlatformEnv,
	codebaseMemoryNativeRelativePath,
	copyCodebaseMemoryNativeAsset,
	currentCodebaseMemoryNativePlatform,
	resolveCodebaseMemoryNativeSource,
} from "./codebase-memory-native-assets.mjs";

let tempDir;

afterEach(() => {
	if (tempDir) {
		rmSync(tempDir, { recursive: true, force: true });
		tempDir = undefined;
	}
});

function makeTempDir(prefix) {
	tempDir = mkdtempSync(join(tmpdir(), prefix));
	return tempDir;
}

function writeExecutable(filePath) {
	writeFileSync(filePath, "#!/bin/sh\nexit 0\n");
	chmodSync(filePath, 0o755);
}

function writeNotices(root) {
	writeFileSync(join(root, "LICENSE"), "upstream license\n");
	writeFileSync(join(root, "THIRD_PARTY.md"), "upstream third-party notices\n");
}

describe("codebase-memory native asset packaging", () => {
	it("maps Node platforms to native codebase-memory platform ids", () => {
		expect(currentCodebaseMemoryNativePlatform("darwin", "arm64")).toBe("darwin-arm64");
		expect(currentCodebaseMemoryNativePlatform("darwin", "x64")).toBe("darwin-x64");
		expect(currentCodebaseMemoryNativePlatform("linux", "arm64")).toBe("linux-arm64");
		expect(currentCodebaseMemoryNativePlatform("linux", "x64")).toBe("linux-x64");
		expect(currentCodebaseMemoryNativePlatform("win32", "arm64")).toBe("windows-arm64");
		expect(currentCodebaseMemoryNativePlatform("win32", "x64")).toBe("windows-x64");
	});

	it("resolves platform-specific env before current-platform generic env", () => {
		const root = makeTempDir("amaze-cbm-native-assets-");
		const genericPath = join(root, "generic-codebase-memory-mcp");
		const platformPath = join(root, "platform-codebase-memory-mcp");
		writeExecutable(genericPath);
		writeExecutable(platformPath);

		const resolution = resolveCodebaseMemoryNativeSource({
			currentPlatform: "darwin-arm64",
			env: {
				AMAZE_CODEBASE_MEMORY_MCP_BIN: genericPath,
				[codebaseMemoryNativePlatformEnv("darwin-arm64")]: platformPath,
			},
			platform: "darwin-arm64",
		});

		expect(resolution.path).toBe(platformPath);
		expect(resolution.source).toBe("platform-env");
	});

	it("does not resolve directories as native binary sources", () => {
		const root = makeTempDir("amaze-cbm-native-assets-dir-");
		const directoryPath = join(root, "codebase-memory-mcp");
		mkdirSync(directoryPath);

		const resolution = resolveCodebaseMemoryNativeSource({
			currentPlatform: "darwin-arm64",
			env: { AMAZE_CODEBASE_MEMORY_MCP_BIN: directoryPath },
			platform: "darwin-arm64",
		});

		expect(resolution.path).toBeUndefined();
		expect(resolution.checked_paths).toEqual([directoryPath]);
	});

	it("copies, asserts, and marker-cleans the native binary and notices", () => {
		const root = makeTempDir("amaze-cbm-native-assets-copy-");
		const sourcePath = join(root, "codebase-memory-mcp");
		const noticeRoot = join(root, "notices");
		const targetRoot = join(root, "package-root");
		mkdirSync(noticeRoot);
		writeExecutable(sourcePath);
		writeNotices(noticeRoot);

		const result = copyCodebaseMemoryNativeAsset({
			currentPlatform: "darwin-arm64",
			env: {
				AMAZE_CODEBASE_MEMORY_MCP_BIN: sourcePath,
				AMAZE_CODEBASE_MEMORY_MCP_NOTICE_DIR: noticeRoot,
			},
			platform: "darwin-arm64",
			required: true,
			targetRoot,
		});

		const expectedTarget = join(targetRoot, codebaseMemoryNativeRelativePath("darwin-arm64"));
		const noticePaths = codebaseMemoryNativeNoticeRelativePaths();
		expect(result.copied).toBe(true);
		expect(result.targetPath).toBe(expectedTarget);
		expect(result.notices.copied).toBe(true);
		expect(readFileSync(expectedTarget, "utf8")).toBe("#!/bin/sh\nexit 0\n");
		expect(readFileSync(join(targetRoot, noticePaths.license), "utf8")).toBe("upstream license\n");
		expect(readFileSync(join(targetRoot, noticePaths.thirdParty), "utf8")).toBe("upstream third-party notices\n");
		expect(assertCodebaseMemoryNativeAsset({ platform: "darwin-arm64", targetRoot })).toEqual({
			platform: "darwin-arm64",
			targetPath: expectedTarget,
		});
		expect(cleanCodebaseMemoryNativeAssets({ targetRoot })).toEqual({
			cleaned: true,
			targetDir: join(targetRoot, "native", "codebase-memory-mcp"),
		});
		expect(existsSync(join(targetRoot, "native", "codebase-memory-mcp"))).toBe(false);
	});

	it("requires notices when native binary packaging is required", () => {
		const root = makeTempDir("amaze-cbm-native-assets-notices-");
		const sourcePath = join(root, "codebase-memory-mcp");
		writeExecutable(sourcePath);

		expect(() =>
			copyCodebaseMemoryNativeAsset({
				currentPlatform: "darwin-arm64",
				env: { AMAZE_CODEBASE_MEMORY_MCP_BIN: sourcePath },
				platform: "darwin-arm64",
				required: true,
				targetRoot: join(root, "package-root"),
			}),
		).toThrow(/Missing codebase-memory-mcp notices/);
	});

	it("asserts packed npm metadata contains the native binary and notices", () => {
		expect(() =>
			assertPackedCodebaseMemoryNativeAsset(
				{
					files: [
						{ path: "package/native/codebase-memory-mcp/LICENSE" },
						{ path: "package/native/codebase-memory-mcp/THIRD_PARTY.md" },
						{ path: "package/native/codebase-memory-mcp/darwin-arm64/codebase-memory-mcp" },
					],
				},
				"darwin-arm64",
			),
		).not.toThrow();
		expect(() =>
			assertPackedCodebaseMemoryNativeAsset(
				{
					files: [
						{ path: "native/codebase-memory-mcp/LICENSE" },
						{ path: "native/codebase-memory-mcp/THIRD_PARTY.md" },
						{ path: "native/codebase-memory-mcp/windows-x64/codebase-memory-mcp.exe" },
					],
				},
				"windows-x64",
			),
		).not.toThrow();
		expect(() => assertPackedCodebaseMemoryNativeAsset({ files: [{ path: "package/dist/cli.js" }] }, "darwin-arm64")).toThrow(
			/missing native codebase-memory-mcp binary/,
		);
	});
});
