import * as fsSync from "node:fs";
import * as path from "node:path";
import type { NexusScope, NexusScopeKind } from "./types";

const STATIC_SCOPES: Record<Exclude<NexusScopeKind, "project">, NexusScope> = {
	global: { id: "global", kind: "global", key: null, displayName: "global", cwd: null, gitOrigin: null, repoRoot: null },
	user: { id: "user", kind: "user", key: null, displayName: "user", cwd: null, gitOrigin: null, repoRoot: null },
	knowledge: {
		id: "knowledge",
		kind: "knowledge",
		key: null,
		displayName: "knowledge",
		cwd: null,
		gitOrigin: null,
		repoRoot: null,
	},
	failure: { id: "failure", kind: "failure", key: null, displayName: "failure", cwd: null, gitOrigin: null, repoRoot: null },
	session: { id: "session", kind: "session", key: null, displayName: "session", cwd: null, gitOrigin: null, repoRoot: null },
};

export function staticNexusScope(kind: Exclude<NexusScopeKind, "project">): NexusScope {
	return STATIC_SCOPES[kind];
}

export function resolveNexusProjectScope(cwd: string): NexusScope {
	const normalized = path.resolve(cwd);
	const repoRoot = findGitRoot(normalized) ?? normalized;
	const gitOrigin = repoRoot ? readGitOrigin(repoRoot) : null;
	const keySeed = gitOrigin ? `git:${normalizeGitOrigin(gitOrigin)}` : `path:${repoRoot}`;
	const key = Bun.hash(keySeed).toString(16);
	return {
		id: `project:${key}`,
		kind: "project",
		key,
		displayName: path.basename(repoRoot) || repoRoot,
		cwd: normalized,
		gitOrigin: gitOrigin ? normalizeGitOrigin(gitOrigin) : null,
		repoRoot,
	};
}

export function scopeForTarget(target: "memory" | "user" | "project" | "knowledge" | "failure", cwd: string): NexusScope {
	if (target === "memory" || target === "project") return resolveNexusProjectScope(cwd);
	if (target === "user") return staticNexusScope("user");
	if (target === "failure") return staticNexusScope("failure");
	if (target === "knowledge") return staticNexusScope("knowledge");
	return resolveNexusProjectScope(cwd);
}

export function activeScopesForSearch(
	cwd: string,
	scope: "current_project" | "global" | "knowledge" | "failure" | "session" | "all" | undefined,
): NexusScope[] | undefined {
	switch (scope ?? "current_project") {
		case "current_project":
			return [
				resolveNexusProjectScope(cwd),
				staticNexusScope("global"),
				staticNexusScope("user"),
				staticNexusScope("knowledge"),
				staticNexusScope("failure"),
			];
		case "global":
			return [staticNexusScope("global"), staticNexusScope("user")];
		case "knowledge":
			return [staticNexusScope("knowledge")];
		case "failure":
			return [staticNexusScope("failure")];
		case "session":
			return [staticNexusScope("session")];
		case "all":
			return undefined;
	}
}

function findGitRoot(start: string): string | null {
	let current = path.resolve(start);
	while (true) {
		if (fsSync.existsSync(path.join(current, ".git"))) return current;
		const parent = path.dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}

function readGitOrigin(repoRoot: string): string | null {
	const gitPath = path.join(repoRoot, ".git");
	let configPath = path.join(gitPath, "config");
	try {
		const stat = fsSync.statSync(gitPath);
		if (stat.isFile()) {
			const gitFile = fsSync.readFileSync(gitPath, "utf8");
			const match = gitFile.match(/^gitdir:\s*(.+)$/m);
			if (match) configPath = path.resolve(repoRoot, match[1], "config");
		}
	} catch {
		return null;
	}
	try {
		const config = fsSync.readFileSync(configPath, "utf8");
		const originSection = config.match(/\[remote "origin"\]([\s\S]*?)(?:\n\[|$)/);
		const section = originSection?.[1];
		if (!section) return null;
		const url = section.match(/^\s*url\s*=\s*(.+)$/m)?.[1]?.trim();
		return url || null;
	} catch {
		return null;
	}
}

function normalizeGitOrigin(value: string): string {
	return value
		.trim()
		.replace(/^git@([^:]+):/, "https://$1/")
		.replace(/\.git$/i, "")
		.toLowerCase();
}
