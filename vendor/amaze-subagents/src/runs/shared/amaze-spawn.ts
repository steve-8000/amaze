import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export const AMAZE_PACKAGE = "amaze";

export function findAmazePackageRootFromEntry(entryPoint: string): string | undefined {
	let dir = path.dirname(entryPoint);
	while (dir !== path.dirname(dir)) {
		const packageJsonPath = path.join(dir, "package.json");
		if (fs.existsSync(packageJsonPath)) {
			const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as { name?: unknown };
			if (pkg.name === AMAZE_PACKAGE) return dir;
		}
		dir = path.dirname(dir);
	}
	return undefined;
}

export function resolveInstalledAmazePackageRoot(): string | undefined {
	return findAmazePackageRootFromEntry(fileURLToPath(import.meta.resolve(AMAZE_PACKAGE)));
}

export function resolveAmazePackageRoot(): string | undefined {
	try {
		const entry = process.argv[1];
		return entry ? findAmazePackageRootFromEntry(fs.realpathSync(entry)) : undefined;
	} catch {
		// process.argv[1] probing is best-effort; callers can fall back to PATH/package resolution.
		return undefined;
	}
}

export interface PiSpawnDeps {
	platform?: NodeJS.Platform;
	execPath?: string;
	argv1?: string;
	existsSync?: (filePath: string) => boolean;
	readFileSync?: (filePath: string, encoding: "utf-8") => string;
	resolvePackageJson?: () => string;
	resolvePackageEntry?: () => string;
	piPackageRoot?: string;
}

interface PiSpawnCommand {
	command: string;
	args: string[];
}

function isRunnableNodeScript(filePath: string, existsSync: (filePath: string) => boolean): boolean {
	if (!existsSync(filePath)) return false;
	return /\.(?:mjs|cjs|js)$/i.test(filePath);
}

function normalizePath(filePath: string): string {
	return path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
}

export function resolveWindowsPiCliScript(deps: PiSpawnDeps = {}): string | undefined {
	const existsSync = deps.existsSync ?? fs.existsSync;
	const readFileSync = deps.readFileSync ?? ((filePath, encoding) => fs.readFileSync(filePath, encoding));
	const argv1 = deps.argv1 ?? process.argv[1];

	if (argv1) {
		const argvPath = normalizePath(argv1);
		if (isRunnableNodeScript(argvPath, existsSync)) {
			return argvPath;
		}
	}

	try {
		const resolvePackageJson = deps.resolvePackageJson ?? (() => {
			const root = deps.piPackageRoot ?? resolveAmazePackageRoot();
			if (root) return path.join(root, "package.json");
			const packageRoot = deps.resolvePackageEntry
				? findAmazePackageRootFromEntry(deps.resolvePackageEntry())
				: resolveInstalledAmazePackageRoot();
			if (!packageRoot) throw new Error(`Could not resolve ${AMAZE_PACKAGE} package root`);
			return path.join(packageRoot, "package.json");
		});
		const packageJsonPath = resolvePackageJson();
		const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
			bin?: string | Record<string, string>;
		};
		const binField = packageJson.bin;
		const binPath = typeof binField === "string"
			? binField
			: binField?.pi ?? Object.values(binField ?? {})[0];
		if (!binPath) return undefined;
		const candidate = path.resolve(path.dirname(packageJsonPath), binPath);
		if (isRunnableNodeScript(candidate, existsSync)) {
			return candidate;
		}
	} catch {
		// Windows CLI resolution is optional; falling back to `pi` lets PATH handle execution.
		return undefined;
	}

	return undefined;
}

export function getAmazeSpawnCommand(args: string[], deps: PiSpawnDeps = {}): PiSpawnCommand {
	const platform = deps.platform ?? process.platform;
	if (platform === "win32") {
		const piCliPath = resolveWindowsPiCliScript(deps);
		if (piCliPath) {
			return {
				command: deps.execPath ?? process.execPath,
				args: [piCliPath, ...args],
			};
		}
	}

	return { command: "amaze", args };
}
