#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { mcpEntrypointContract } from "./cli/mcp-contract.ts";
import { APP_NAME, getPackageDir, VERSION } from "./config.ts";
import { handleBootstrapSelfUpdate } from "./self-update-bootstrap.ts";

process.title = APP_NAME;
process.env.AMAZE_CODING_AGENT = "true";
process.emitWarning = (() => {}) as typeof process.emitWarning;

const args = process.argv.slice(2);
const PACKAGE_COMMANDS = new Set(["install", "remove", "uninstall", "update", "list", "config"]);

function isRootCommand(args: readonly string[]): boolean {
	const firstArg = args[0];
	return firstArg === undefined || (firstArg !== "mcp" && firstArg !== "mcp-dev" && !PACKAGE_COMMANDS.has(firstArg));
}

function isPackageManagerInstall(packageDir: string): boolean {
	return packageDir.replace(/\\/g, "/").includes("/node_modules/amaze");
}

function isMissingBundledWorkspaceDependencies(packageDir: string): boolean {
	if (!isPackageManagerInstall(packageDir)) {
		return false;
	}
	const bundledPackages = ["amaze-agent-core", "amaze-ai", "amaze-tui"];
	return bundledPackages.some((name) => {
		return !existsSync(join(packageDir, "node_modules", "@steve-8000", name, "dist", "index.js"));
	});
}

async function runFullCli(): Promise<number> {
	const extension = import.meta.url.endsWith(".ts") ? ".ts" : ".js";
	const fullCliPath = fileURLToPath(new URL(`./cli-main${extension}`, import.meta.url));
	return await new Promise<number>((resolve, reject) => {
		const child = spawn(process.execPath, [...process.execArgv, fullCliPath, ...args], {
			env: process.env,
			stdio: "inherit",
		});
		child.on("error", (error) => {
			reject(error);
		});
		child.on("close", (code, signal) => {
			if (signal) {
				process.kill(process.pid, signal);
				resolve(1);
				return;
			}
			resolve(code ?? 1);
		});
	});
}

async function runMcpBridge(): Promise<number> {
	const extension = import.meta.url.endsWith(".ts") ? ".ts" : ".js";
	const bridgePath = fileURLToPath(new URL(`./amaze/mcp-stdio${extension}`, import.meta.url));
	return await new Promise<number>((resolve, reject) => {
		const child = spawn(process.execPath, [...process.execArgv, bridgePath], {
			env: process.env,
			stdio: "inherit",
		});
		child.on("error", reject);
		child.on("close", (code, signal) => {
			if (signal) {
				process.kill(process.pid, signal);
				resolve(1);
				return;
			}
			resolve(code ?? 1);
		});
	});
}

if (isRootCommand(args) && (args.includes("--version") || args.includes("-v"))) {
	console.log(VERSION);
	process.exit();
}

const mcpContract = mcpEntrypointContract(args);
if (mcpContract.kind === "xenonite-migration") {
	for (const message of mcpContract.messages) console.error(message);
	process.exit(mcpContract.exitCode);
}

if (mcpContract.kind === "local-dev-adapter") {
	process.exitCode = await runMcpBridge();
	process.exit();
}

if (isMissingBundledWorkspaceDependencies(getPackageDir())) {
	if (await handleBootstrapSelfUpdate(args)) {
		process.exit();
	}
}

process.exitCode = await runFullCli();
