#!/usr/bin/env node
import { accessSync, chmodSync, constants, copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const codebaseMemoryNativePlatforms = [
	"darwin-arm64",
	"darwin-x64",
	"linux-arm64",
	"linux-x64",
	"windows-arm64",
	"windows-x64",
];

const genericBinaryEnv = "AMAZE_CODEBASE_MEMORY_MCP_BIN";
const requireBinaryEnv = "AMAZE_REQUIRE_CODEBASE_MEMORY_MCP_BIN";
const noticeDirEnv = "AMAZE_CODEBASE_MEMORY_MCP_NOTICE_DIR";
const licenseEnv = "AMAZE_CODEBASE_MEMORY_MCP_LICENSE";
const thirdPartyEnv = "AMAZE_CODEBASE_MEMORY_MCP_THIRD_PARTY";
const noticeRelativeDir = join("native", "codebase-memory-mcp");

export function currentCodebaseMemoryNativePlatform(platform = process.platform, arch = process.arch) {
	if (platform === "darwin") return arch === "arm64" ? "darwin-arm64" : "darwin-x64";
	if (platform === "linux") return arch === "arm64" ? "linux-arm64" : "linux-x64";
	if (platform === "win32") return arch === "arm64" ? "windows-arm64" : "windows-x64";
	throw new Error(`Unsupported codebase-memory-mcp platform: ${platform} ${arch}`);
}

export function codebaseMemoryNativeBinaryName(platform) {
	assertKnownPlatform(platform);
	return platform.startsWith("windows-") ? "codebase-memory-mcp.exe" : "codebase-memory-mcp";
}

export function codebaseMemoryNativeRelativePath(platform) {
	return join(noticeRelativeDir, platform, codebaseMemoryNativeBinaryName(platform));
}

export function codebaseMemoryNativeNoticeRelativePaths() {
	return {
		license: join(noticeRelativeDir, "LICENSE"),
		thirdParty: join(noticeRelativeDir, "THIRD_PARTY.md"),
	};
}

export function codebaseMemoryNativePlatformEnv(platform) {
	assertKnownPlatform(platform);
	return `${genericBinaryEnv}_${platform.toUpperCase().replaceAll("-", "_")}`;
}

export function resolveCodebaseMemoryNativeSource(options = {}) {
	const platform = options.platform ?? currentCodebaseMemoryNativePlatform();
	const env = options.env ?? process.env;
	const currentPlatform = options.currentPlatform ?? currentCodebaseMemoryNativePlatform();
	const candidates = [];

	const platformSpecific = env[codebaseMemoryNativePlatformEnv(platform)];
	if (platformSpecific) candidates.push({ path: platformSpecific, source: "platform-env" });

	const generic = env[genericBinaryEnv];
	if (generic && platform === currentPlatform) candidates.push({ path: generic, source: "env" });

	for (const candidate of candidates) {
		if (isExecutableFile(candidate.path, platform)) {
			return { ...candidate, platform };
		}
	}

	return { platform, checked_paths: candidates.map((candidate) => candidate.path) };
}

export function copyCodebaseMemoryNativeAsset(options = {}) {
	const platform = options.platform ?? currentCodebaseMemoryNativePlatform();
	const targetRoot = resolveRequiredPath(options.targetRoot, "--target");
	const env = options.env ?? process.env;
	const resolution = resolveCodebaseMemoryNativeSource(options);
	const targetPath = join(targetRoot, codebaseMemoryNativeRelativePath(platform));
	const required = options.required === true || env[requireBinaryEnv] === "1";

	if (!resolution.path) {
		if (required) {
			throw new Error(
				`Missing codebase-memory-mcp native binary for ${platform}. Set ${codebaseMemoryNativePlatformEnv(platform)}${
					platform === (options.currentPlatform ?? currentCodebaseMemoryNativePlatform()) ? ` or ${genericBinaryEnv}` : ""
				}.`,
			);
		}
		return { copied: false, platform, targetPath, checked_paths: resolution.checked_paths };
	}

	mkdirSync(dirname(targetPath), { recursive: true });
	copyFileSync(resolution.path, targetPath);
	if (!platform.startsWith("windows-")) {
		chmodSync(targetPath, statSync(resolution.path).mode | 0o111);
	}
	const notices = copyCodebaseMemoryNativeNotices({ env, required, targetRoot });
	return { copied: true, notices, platform, sourcePath: resolution.path, source: resolution.source, targetPath };
}

export function assertCodebaseMemoryNativeAsset(options = {}) {
	const platform = options.platform ?? currentCodebaseMemoryNativePlatform();
	const targetRoot = resolveRequiredPath(options.targetRoot, "--target");
	const targetPath = join(targetRoot, codebaseMemoryNativeRelativePath(platform));
	if (!isExecutableFile(targetPath, platform)) {
		throw new Error(`Missing executable codebase-memory-mcp native asset: ${targetPath}`);
	}
	return { platform, targetPath };
}

export function assertCodebaseMemoryNativeNotices(options = {}) {
	const targetRoot = resolveRequiredPath(options.targetRoot, "--target");
	const paths = codebaseMemoryNativeNoticeRelativePaths();
	const licensePath = join(targetRoot, paths.license);
	const thirdPartyPath = join(targetRoot, paths.thirdParty);
	if (!isReadableFile(licensePath)) {
		throw new Error(`Missing codebase-memory-mcp LICENSE notice: ${licensePath}`);
	}
	if (!isReadableFile(thirdPartyPath)) {
		throw new Error(`Missing codebase-memory-mcp THIRD_PARTY notice: ${thirdPartyPath}`);
	}
	return { licensePath, thirdPartyPath };
}

export function assertPackedCodebaseMemoryNativeAsset(packed, platform) {
	const relativePath = codebaseMemoryNativeRelativePath(platform).replaceAll("\\", "/");
	const prefixedPath = `package/${relativePath}`;
	const filePaths = new Set((packed.files ?? []).map((file) => file.path));
	if (!filePaths.has(prefixedPath) && !filePaths.has(relativePath)) {
		throw new Error(`amaze package tarball is missing native codebase-memory-mcp binary: ${prefixedPath}`);
	}
	const noticePaths = Object.values(codebaseMemoryNativeNoticeRelativePaths()).map((path) => path.replaceAll("\\", "/"));
	const missingNotices = noticePaths.filter((path) => !filePaths.has(`package/${path}`) && !filePaths.has(path));
	if (missingNotices.length > 0) {
		throw new Error(
			`amaze package tarball is missing native codebase-memory-mcp notices: ${missingNotices.join(", ")}`,
		);
	}
}

export function copyCodebaseMemoryNativeNotices(options = {}) {
	const env = options.env ?? process.env;
	const targetRoot = resolveRequiredPath(options.targetRoot, "--target");
	const required = options.required === true || env[requireBinaryEnv] === "1";
	const sources = resolveCodebaseMemoryNativeNoticeSources(env);
	if (!sources.licensePath || !sources.thirdPartyPath) {
		if (required) {
			throw new Error(`Missing codebase-memory-mcp notices. Set ${noticeDirEnv} or ${licenseEnv}/${thirdPartyEnv}.`);
		}
		return { copied: false, checked_paths: sources.checked_paths };
	}
	const relativePaths = codebaseMemoryNativeNoticeRelativePaths();
	const licenseTarget = join(targetRoot, relativePaths.license);
	const thirdPartyTarget = join(targetRoot, relativePaths.thirdParty);
	mkdirSync(dirname(licenseTarget), { recursive: true });
	copyFileSync(sources.licensePath, licenseTarget);
	copyFileSync(sources.thirdPartyPath, thirdPartyTarget);
	return {
		copied: true,
		licensePath: sources.licensePath,
		licenseTarget,
		thirdPartyPath: sources.thirdPartyPath,
		thirdPartyTarget,
	};
}

function parseArgs(argv) {
	const options = { command: argv[0], platform: undefined, targetRoot: undefined, required: false };
	for (let i = 1; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--platform") {
			options.platform = argv[++i];
			continue;
		}
		if (arg === "--target") {
			options.targetRoot = argv[++i];
			continue;
		}
		if (arg === "--required") {
			options.required = true;
			continue;
		}
		if (arg === "--help") {
			printUsage();
			process.exit(0);
		}
		throw new Error(`Unknown option: ${arg}`);
	}
	return options;
}

function printUsage() {
	console.log(`Usage: node scripts/codebase-memory-native-assets.mjs <copy|copy-notices|assert|path> [options]

Options:
  --platform <id>   Platform id. Defaults to the current platform.
  --target <dir>    Root directory that should contain native/codebase-memory-mcp.
  --required        Fail when no source binary is configured.

Source env:
  ${genericBinaryEnv}                    Current-platform binary path.
  ${genericBinaryEnv}_DARWIN_ARM64       Platform-specific binary path.
  ${genericBinaryEnv}_DARWIN_X64
  ${genericBinaryEnv}_LINUX_ARM64
  ${genericBinaryEnv}_LINUX_X64
  ${genericBinaryEnv}_WINDOWS_ARM64
  ${genericBinaryEnv}_WINDOWS_X64
  ${noticeDirEnv}             Directory containing LICENSE and THIRD_PARTY.md.
  ${licenseEnv}               Explicit LICENSE file path.
  ${thirdPartyEnv}            Explicit THIRD_PARTY.md file path.
`);
}

function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.command === "copy") {
		const result = copyCodebaseMemoryNativeAsset(options);
		console.log(JSON.stringify(result, undefined, "\t"));
		return;
	}
	if (options.command === "assert") {
		const result = assertCodebaseMemoryNativeAsset(options);
		const notices = assertCodebaseMemoryNativeNotices(options);
		console.log(JSON.stringify({ ...result, notices }, undefined, "\t"));
		return;
	}
	if (options.command === "copy-notices") {
		const result = copyCodebaseMemoryNativeNotices(options);
		console.log(JSON.stringify(result, undefined, "\t"));
		return;
	}
	if (options.command === "path") {
		const platform = options.platform ?? currentCodebaseMemoryNativePlatform();
		console.log(codebaseMemoryNativeRelativePath(platform));
		return;
	}
	printUsage();
	throw new Error(`Unknown command: ${options.command ?? "(missing)"}`);
}

function resolveRequiredPath(path, optionName) {
	if (!path) throw new Error(`${optionName} is required`);
	return resolve(path);
}

function assertKnownPlatform(platform) {
	if (!codebaseMemoryNativePlatforms.includes(platform)) {
		throw new Error(`Unsupported codebase-memory-mcp platform: ${platform}`);
	}
}

function isExecutableFile(path, platform) {
	try {
		if (!statSync(path).isFile()) return false;
		if (platform.startsWith("windows-")) return true;
		accessSync(path, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

function resolveCodebaseMemoryNativeNoticeSources(env) {
	const checkedPaths = [];
	const explicitLicense = env[licenseEnv];
	const explicitThirdParty = env[thirdPartyEnv];
	if (explicitLicense) checkedPaths.push(explicitLicense);
	if (explicitThirdParty) checkedPaths.push(explicitThirdParty);
	if (explicitLicense && explicitThirdParty && isReadableFile(explicitLicense) && isReadableFile(explicitThirdParty)) {
		return { licensePath: explicitLicense, thirdPartyPath: explicitThirdParty, checked_paths: checkedPaths };
	}

	const noticeDir = env[noticeDirEnv];
	if (noticeDir) {
		const licensePath = join(noticeDir, "LICENSE");
		const thirdPartyPath = join(noticeDir, "THIRD_PARTY.md");
		checkedPaths.push(licensePath, thirdPartyPath);
		if (isReadableFile(licensePath) && isReadableFile(thirdPartyPath)) {
			return { licensePath, thirdPartyPath, checked_paths: checkedPaths };
		}
	}

	return { checked_paths: checkedPaths };
}

function isReadableFile(path) {
	try {
		return existsSync(path) && statSync(path).isFile();
	} catch {
		return false;
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main();
}
