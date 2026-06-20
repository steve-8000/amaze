import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { readExactCodeSpan } from "../src/core/tools/xenonite.ts";

const tempDirs: string[] = [];

async function makeProject(): Promise<string> {
	const dir = await mkdtemp(path.join(tmpdir(), "amaze-code-read-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("readExactCodeSpan", () => {
	test("returns the requested range exactly with line numbers and no judgement fields", async () => {
		const project = await makeProject();
		await writeFile(
			path.join(project, "sample.ts"),
			["const one = 1;", "const two = 2;", "const three = 3;", "const four = 4;"].join("\n"),
		);

		const result = await readExactCodeSpan(
			{
				filePath: "sample.ts",
				projectPath: project,
				startLine: 2,
				endLine: 3,
			},
			project,
			"/host",
		);

		expect(result).toMatchObject({
			ok: true,
			relativePath: "sample.ts",
			language: "typescript",
			requestedRange: { startLine: 2, endLine: 3, contextLines: 0 },
			returnedRange: { startLine: 2, endLine: 3 },
			complete: true,
			truncated: false,
			lineNumbers: true,
			content: "2: const two = 2;\n3: const three = 3;",
		});
		expect(result).not.toHaveProperty("contextAssessment");
		expect(result).not.toHaveProperty("patchReadiness");
		expect(result).not.toHaveProperty("nextAction");
		expect(result).not.toHaveProperty("continuationTargets");
	});

	test("includes explicit context lines without exceeding the hard cap", async () => {
		const project = await makeProject();
		await writeFile(path.join(project, "sample.txt"), ["a", "b", "c", "d", "e"].join("\n"));

		const result = await readExactCodeSpan(
			{
				filePath: "sample.txt",
				projectPath: project,
				startLine: 3,
				endLine: 3,
				contextLines: 1,
				maxLines: 3,
				lineNumbers: false,
			},
			project,
			"/host",
		);

		expect(result).toMatchObject({
			requestedRange: { startLine: 3, endLine: 3, contextLines: 1 },
			returnedRange: { startLine: 2, endLine: 4 },
			content: "b\nc\nd",
			lineNumbers: false,
			truncated: false,
		});
	});

	test("fails instead of truncating when the requested range exceeds maxLines", async () => {
		const project = await makeProject();
		await writeFile(path.join(project, "sample.txt"), ["a", "b", "c", "d", "e"].join("\n"));

		await expect(
			readExactCodeSpan(
				{
					filePath: "sample.txt",
					projectPath: project,
					startLine: 1,
					endLine: 5,
					maxLines: 4,
				},
				project,
				"/host",
			),
		).rejects.toThrow("exceeding maxLines 4");
	});

	test("requires explicit startLine and endLine", async () => {
		const project = await makeProject();
		await writeFile(path.join(project, "sample.txt"), "a\nb\n");

		await expect(
			readExactCodeSpan(
				{
					filePath: "sample.txt",
					projectPath: project,
					startLine: 1,
				},
				project,
				"/host",
			),
		).rejects.toThrow("requires explicit integer startLine and endLine");
	});
});
