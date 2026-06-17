import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

describe("export HTML providerNative rendering", () => {
	it("renders providerNative blocks using details/summary with collapsed and full payloads", () => {
		const templateJs = readFileSync(new URL("../src/core/export-html/template.js", import.meta.url), "utf-8");

		expect(templateJs).toContain("block.type === 'providerNative'");
		expect(templateJs).toContain('<details class="provider-native-block">');
		expect(templateJs).toContain(`<summary>\${providerPrefix}providerNative · \${subtype}</summary>`);
		expect(templateJs).toContain("rawBody.length > 2000");
	});

	it("styles providerNative blocks with theme variables", () => {
		const templateCss = readFileSync(new URL("../src/core/export-html/template.css", import.meta.url), "utf-8");

		expect(templateCss).toContain(".provider-native-block");
		expect(templateCss).toContain("color: var(--muted);");
		expect(templateCss).toContain(".provider-native-block[open] .provider-native-full");
	});
});
