import { describe, expect, test } from "bun:test";
import { getKnownRoleIds, getRoleInfo } from "@steve-z8k/pi-coding-agent/config/model-roles";
import { Settings } from "@steve-z8k/pi-coding-agent/config/settings";

describe("getRoleInfo", () => {
	test("returns built-in role info", () => {
		const settings = Settings.isolated({});

		expect(getRoleInfo("flash", settings)).toEqual({
			name: "Flash",
			color: "warning",
			tag: "FLASH",
		});
		expect(getRoleInfo("deep", settings)).toEqual({
			name: "Deep",
			color: "error",
			tag: "DEEP",
		});
		expect(getRoleInfo("ultra", settings)).toEqual({
			name: "Ultra",
			color: "accent",
			tag: "ULTRA",
		});
	});

	test("returns custom role info from modelTags", () => {
		const settings = Settings.isolated({
			modelTags: {
				custom: { name: "My Custom Tag", color: "error" },
				another: { name: "Another Tag" },
			},
		});

		expect(getRoleInfo("custom", settings)).toEqual({
			name: "My Custom Tag",
			color: "error",
		});
		expect(getRoleInfo("another", settings)).toEqual({
			name: "Another Tag",
			color: undefined,
		});
	});

	test("returns fallback for unknown roles", () => {
		const settings = Settings.isolated({});

		expect(getRoleInfo("unknown-role", settings)).toEqual({
			name: "unknown-role",
			color: "muted",
		});
	});

	test("configured metadata overrides built-in role info while keeping built-in defaults", () => {
		const settings = Settings.isolated({
			modelTags: {
				flash: { name: "My Flash", color: "success" },
			},
		});

		expect(getRoleInfo("flash", settings)).toEqual({
			tag: "FLASH",
			name: "My Flash",
			color: "success",
			hidden: undefined,
		});
	});

	test("omits hidden custom roles from known role ids", () => {
		const settings = Settings.isolated({
			cycleOrder: ["custom-visible", "custom-hidden"],
			modelRoles: {
				"custom-visible": "openai/gpt-5.4",
				"custom-hidden": "openai/gpt-5.4-mini",
			},
			modelTags: {
				"custom-hidden": { name: "Hidden Custom", hidden: true },
			},
		});

		expect(getKnownRoleIds(settings)).toContain("custom-visible");
		expect(getKnownRoleIds(settings)).not.toContain("custom-hidden");
	});
});
