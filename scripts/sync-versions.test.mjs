#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = dirname(__dirname);

function writePackage(packagesDir, packageDir, packageJson) {
	const dir = join(packagesDir, packageDir);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "package.json"), `${JSON.stringify(packageJson, null, "\t")}\n`);
}

function readPackage(packagesDir, packageDir) {
	return JSON.parse(readFileSync(join(packagesDir, packageDir, "package.json"), "utf8"));
}

describe("sync-versions", () => {
	it("keeps amaze source dependencies on local workspace versions", () => {
		// Given
		const fixtureRoot = mkdtempSync(join(tmpdir(), "sync-versions-"));
		const packagesDir = join(fixtureRoot, "packages");
		try {
			writePackage(packagesDir, "agent", {
				name: "@steve-8000/amaze-agent-core",
				version: "2026.5.19",
			});
			writePackage(packagesDir, "ai", {
				name: "@steve-8000/amaze-ai",
				version: "2026.5.19",
			});
			writePackage(packagesDir, "tui", {
				name: "@steve-8000/amaze-tui",
				version: "2026.5.19",
			});
			writePackage(packagesDir, "web-ui", {
				name: "@steve-8000/amaze-web-ui",
				version: "2026.5.19",
				dependencies: {
					"@steve-8000/amaze-agent-core": "^0.74.0",
					"@steve-8000/amaze-ai": "^0.74.0",
					"@steve-8000/amaze-tui": "^0.74.0",
				},
			});
			writePackage(packagesDir, "coding-agent", {
				name: "amaze",
				version: "2026.5.19",
				dependencies: {
					"@steve-8000/amaze-agent-core": "^0.74.0",
					"@steve-8000/amaze-ai": "^0.74.0",
					"@steve-8000/amaze-tui": "^0.74.0",
				},
			});

			// When
			execFileSync(process.execPath, [join(root, "scripts/sync-versions.js")], {
				cwd: fixtureRoot,
				stdio: "pipe",
			});

			// Then
			const amazePackage = readPackage(packagesDir, "coding-agent");
			assert.deepEqual(amazePackage.dependencies, {
				"@steve-8000/amaze-agent-core": "^2026.5.19",
				"@steve-8000/amaze-ai": "^2026.5.19",
				"@steve-8000/amaze-tui": "^2026.5.19",
			});
		} finally {
			rmSync(fixtureRoot, { recursive: true, force: true });
		}
	});
});
