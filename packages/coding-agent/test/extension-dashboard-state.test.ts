import { describe, expect, test } from "bun:test";
import { disableProvider, enableProvider } from "@steve-z8k/pi-coding-agent/discovery";
import { applyDisabledExtensionsToState } from "@steve-z8k/pi-coding-agent/modes/components/extensions/state-manager";
import type { DashboardState, Extension } from "@steve-z8k/pi-coding-agent/modes/components/extensions/types";

function extension(overrides: Partial<Extension> & Pick<Extension, "id">): Extension {
	return {
		kind: "skill",
		name: overrides.id.replace(/^skill:/, ""),
		displayName: overrides.id.replace(/^skill:/, ""),
		path: `/tmp/${overrides.id}`,
		source: { provider: "native", providerName: "Native", level: "native" },
		state: "active",
		raw: {},
		...overrides,
	};
}

function dashboardState(extensions: Extension[], selected: Extension | null = extensions[0] ?? null): DashboardState {
	return {
		tabs: [{ id: "all", label: "ALL", enabled: true, count: extensions.length }],
		activeTabIndex: 0,
		extensions,
		tabFiltered: extensions,
		searchFiltered: extensions,
		searchQuery: "",
		listIndex: 0,
		scrollOffset: 0,
		selected,
	};
}

describe("applyDisabledExtensionsToState", () => {
	test("immediately applies item-disabled state to every visible dashboard slice", () => {
		const selected = extension({ id: "skill:alpha" });
		const state = dashboardState([selected, extension({ id: "skill:beta" })], selected);

		const next = applyDisabledExtensionsToState(state, ["skill:alpha"]);

		expect(next.extensions[0]).toMatchObject({
			id: "skill:alpha",
			state: "disabled",
			disabledReason: "item-disabled",
		});
		expect(next.tabFiltered[0]).toMatchObject({
			id: "skill:alpha",
			state: "disabled",
			disabledReason: "item-disabled",
		});
		expect(next.searchFiltered[0]).toMatchObject({
			id: "skill:alpha",
			state: "disabled",
			disabledReason: "item-disabled",
		});
		expect(next.selected).toMatchObject({ id: "skill:alpha", state: "disabled", disabledReason: "item-disabled" });
		expect(next.extensions[1]).toMatchObject({ id: "skill:beta", state: "active" });
	});

	test("restores a previously item-disabled shadowed extension as shadowed", () => {
		const shadowed = extension({
			id: "skill:shadowed",
			state: "disabled",
			disabledReason: "item-disabled",
			shadowedBy: "skill:shadowing",
		});
		const state = dashboardState([shadowed], shadowed);

		const next = applyDisabledExtensionsToState(state, []);

		expect(next.extensions[0]).toMatchObject({
			id: "skill:shadowed",
			state: "shadowed",
			disabledReason: "shadowed",
			shadowedBy: "skill:shadowing",
		});
		expect(next.selected).toMatchObject({ id: "skill:shadowed", state: "shadowed", disabledReason: "shadowed" });
	});

	test("restores a previously item-disabled extension as provider-disabled when its provider is off", () => {
		const provider = "test-provider";
		disableProvider(provider);
		try {
			const providerDisabled = extension({
				id: "skill:provider-disabled",
				state: "disabled",
				disabledReason: "item-disabled",
				source: { provider, providerName: "Test", level: "native" },
			});
			const state = dashboardState([providerDisabled], providerDisabled);

			const next = applyDisabledExtensionsToState(state, []);

			expect(next.extensions[0]).toMatchObject({
				id: "skill:provider-disabled",
				state: "disabled",
				disabledReason: "provider-disabled",
			});
			expect(next.selected).toMatchObject({
				id: "skill:provider-disabled",
				state: "disabled",
				disabledReason: "provider-disabled",
			});
		} finally {
			enableProvider(provider);
		}
	});

	test("restores a previously item-disabled shadowed extension as provider-disabled when both apply", () => {
		const provider = "shadowed-provider";
		disableProvider(provider);
		try {
			const shadowedProviderDisabled = extension({
				id: "skill:shadowed-provider-disabled",
				state: "disabled",
				disabledReason: "item-disabled",
				shadowedBy: "skill:shadowing",
				source: { provider, providerName: "Shadowed Test", level: "native" },
			});
			const state = dashboardState([shadowedProviderDisabled], shadowedProviderDisabled);

			const next = applyDisabledExtensionsToState(state, []);

			expect(next.extensions[0]).toMatchObject({
				id: "skill:shadowed-provider-disabled",
				state: "disabled",
				disabledReason: "provider-disabled",
				shadowedBy: "skill:shadowing",
			});
			expect(next.selected).toMatchObject({
				id: "skill:shadowed-provider-disabled",
				state: "disabled",
				disabledReason: "provider-disabled",
			});
		} finally {
			enableProvider(provider);
		}
	});
});
