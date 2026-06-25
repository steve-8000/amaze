import { afterEach, beforeAll, describe, expect, it, vi } from "bun:test";
import { Settings } from "@amaze/pi-coding-agent/config/settings";
import { WelcomeComponent } from "@amaze/pi-coding-agent/modes/components/welcome";
import { initTheme, theme } from "@amaze/pi-coding-agent/modes/theme/theme";

describe("WelcomeComponent", () => {
	beforeAll(async () => {
		await Settings.init({ inMemory: true });
		await initTheme(false);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("omits tip copy for both symbol presets", () => {
		for (const preset of ["nerd", "unicode"] as const) {
			vi.spyOn(theme, "getSymbolPreset").mockReturnValue(preset);
			const welcome = new WelcomeComponent("1.0.0", "model", "provider");
			const plain = welcome
				.render(120)
				.map(line => Bun.stripANSI(line))
				.join("\n");

			expect(plain).toContain("Flight controls");
			expect(plain).not.toContain("Tip:");
			expect(plain).not.toContain("NEW!");
			vi.restoreAllMocks();
		}
	});
});
