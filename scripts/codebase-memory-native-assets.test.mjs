import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
	assertCodebaseMemoryNativeAsset,
	assertPackedCodebaseMemoryNativeAsset,
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

function writeExecutable(path) {
	writeFileSync(path, "#!/bin/sh\nexit 0\n");
	chmodSync(path, 0o755);
}

function writeNotices(root) {
	writeFileSync(join(root, "LICENSE"), "upstream license\n");
	writeFileSync(join(root, "THIRD_PARTY.md"), "upstream third-party notices\n");
}

describe("codebase-memory native asset packaging", () => {
	it("maps Node platforms to native codebase-memory platform ids", () => {
		assert.equal(currentCodebaseMemoryNativePlatform("darwin", "arm64"), "darwin-arm64");
		assert.equal(currentCodebaseMemoryNativePlatform("darwin", "x64"), "darwin-x64");
		assert.equal(currentCodebaseMemoryNativePlatform("linux", "arm64"), "linux-arm64");
		assert.equal(currentCodebaseMemoryNativePlatform("linux", "x64"), "linux-x64");
		assert.equal(currentCodebaseMemoryNativePlatform("win32", "arm64"), "windows-arm64");
		assert.equal(currentCodebaseMemoryNativePlatform("win32", "x64"), "windows-x64");
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

		assert.equal(resolution.path, platformPath);
		assert.equal(resolution.source, "platform-env");
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

		assert.equal(resolution.path, undefined);
		assert.deepEqual(resolution.checked_paths, [directoryPath]);
	});

	it("copies and asserts the native binary at the package/runtime relative path", () => {
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
		assert.equal(result.copied, true);
		assert.equal(result.targetPath, expectedTarget);
		assert.equal(result.notices.copied, true);
		assert.equal(readFileSync(expectedTarget, "utf8"), "#!/bin/sh\nexit 0\n");
		assert.equal(readFileSync(join(targetRoot, noticePaths.license), "utf8"), "upstream license\n");
		assert.equal(readFileSync(join(targetRoot, noticePaths.thirdParty), "utf8"), "upstream third-party notices\n");
		assert.deepEqual(assertCodebaseMemoryNativeAsset({ platform: "darwin-arm64", targetRoot }), {
			platform: "darwin-arm64",
			targetPath: expectedTarget,
		});
	});

	it("requires notices when native binary packaging is required", () => {
		const root = makeTempDir("amaze-cbm-native-assets-notices-");
		const sourcePath = join(root, "codebase-memory-mcp");
		writeExecutable(sourcePath);

		assert.throws(
			() =>
				copyCodebaseMemoryNativeAsset({
					currentPlatform: "darwin-arm64",
					env: { AMAZE_CODEBASE_MEMORY_MCP_BIN: sourcePath },
					platform: "darwin-arm64",
					required: true,
					targetRoot: join(root, "package-root"),
				}),
			/Missing codebase-memory-mcp notices/,
		);
	});

	it("asserts packed npm metadata contains the native binary", () => {
		assert.doesNotThrow(() =>
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
		);
		assert.doesNotThrow(() =>
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
		);
		assert.throws(
			() => assertPackedCodebaseMemoryNativeAsset({ files: [{ path: "package/dist/cli.js" }] }, "darwin-arm64"),
			/missing native codebase-memory-mcp binary/,
		);
	});
});
