import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..", "..", "..");
const BLOCKED = new RegExp(
	[["mne", "mopi"].join(""), ["Mne", "mopi"].join(""), ["mnemo", "syne"].join(""), ["Mnemo", "syne"].join("")]
		.map(value => `\\b${value}\\b`)
		.join("|"),
);
const SKIP_DIRS = new Set([".amaze", ".git", "local-ignore", "node_modules", "target", "dist", "build"]);

function* files(dir: string): Generator<string> {
	for (const entry of readdirSync(dir)) {
		if (SKIP_DIRS.has(entry)) continue;
		const full = path.join(dir, entry);
		const stat = statSync(full);
		if (stat.isDirectory()) yield* files(full);
		else if (stat.isFile()) yield full;
	}
}

describe("Rocky naming contract", () => {
	test("Amaze source no longer exposes old memory/codebase service names", () => {
		const offenders: string[] = [];
		for (const file of files(ROOT)) {
			const text = readFileSync(file, "utf8");
			if (BLOCKED.test(text)) offenders.push(path.relative(ROOT, file));
		}
		expect(offenders).toEqual([]);
	});
});
