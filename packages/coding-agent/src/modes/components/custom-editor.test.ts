import { describe, expect, it } from "bun:test";
import { $ } from "bun";

async function decorateInFreshProcess(text: string, imageLinks?: readonly string[]): Promise<string> {
	const customEditorUrl = new URL("./custom-editor.ts", import.meta.url).href;
	const script = `
import { CustomEditor } from ${JSON.stringify(customEditorUrl)};
const editor = new CustomEditor({});
editor.imageLinks = ${JSON.stringify(imageLinks)};
process.stdout.write(editor.decorateText(${JSON.stringify(text)}));
`;
	const child = await $`bun -e ${script}`.quiet().nothrow();
	const stdout = child.stdout.toString();
	const stderr = child.stderr.toString();
	if (child.exitCode !== 0) throw new Error(stderr || stdout || `decorate subprocess exited with ${child.exitCode}`);
	return stdout;
}

describe("CustomEditor placeholder decoration", () => {
	it("renders paste placeholders before theme initialization", async () => {
		const output = await decorateInFreshProcess("[Paste #1, +30 lines]");
		expect(output).toBe("[Paste #1, +30 lines]");
	});

	it("renders linked image placeholders before theme and settings initialization", async () => {
		const output = await decorateInFreshProcess("[Image #1]", ["/tmp/example.png"]);
		expect(output).toBe("[Image #1]");
	});
});
