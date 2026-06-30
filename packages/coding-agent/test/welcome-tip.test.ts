import { beforeAll, describe, expect, it } from "bun:test";
import { Settings } from "@steve-z8k/pi-coding-agent/config/settings";
import { WelcomeComponent } from "@steve-z8k/pi-coding-agent/modes/components/welcome";
import { initTheme } from "@steve-z8k/pi-coding-agent/modes/theme/theme";

describe("WelcomeComponent", () => {
	beforeAll(async () => {
		await Settings.init({ inMemory: true });
		await initTheme(false);
	});

	it("does not render any tip footer", () => {
		const welcome = new WelcomeComponent("1.0.0", "gpt-5.4", "openai");
		const plain = welcome
			.render(120)
			.map(line => Bun.stripANSI(line))
			.join("\n");

		expect(plain).toContain("Flight controls");
		expect(plain).not.toContain("Tip:");
		expect(plain).not.toContain("NEW!");
	});
});
