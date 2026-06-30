import { describe, expect, it } from "bun:test";
import { Effort } from "@steve-z8k/pi-ai";
import { getBundledModel } from "@steve-z8k/pi-catalog/models";
import { resolveFlashModel, resolvePrimaryModel } from "@steve-z8k/pi-coding-agent/commit/model-selection";

function getModelOrThrow(id: string) {
	const model = getBundledModel("anthropic", id);
	if (!model) throw new Error(`Expected model ${id}`);
	return model;
}

function createSettings(modelRoles: Record<string, string>) {
	return {
		getModelRole(role: string) {
			return modelRoles[role];
		},
		getStorage() {
			return undefined;
		},
		setModelRole(role: string, value: string) {
			modelRoles[role] = value;
		},
		get(path: string) {
			if (path === "modelRoles") return modelRoles;
			return undefined;
		},
	} as never;
}

describe("commit role thinking selection", () => {
	it("returns explicit thinking for flash lane roles, including alias overrides", async () => {
		const defaultModel = getModelOrThrow("claude-sonnet-4-6");
		const commitModel = getModelOrThrow("claude-opus-4-8");
		const settings = createSettings({
			flash: `${commitModel.provider}/${commitModel.id}:low`,
			deep: `${defaultModel.provider}/${defaultModel.id}:high`,
		});
		const registry = {
			getAvailable: () => [defaultModel, commitModel],
			getApiKey: async () => "test-key",
			getApiKeyForProvider: async () => "test-key",
			authStorage: { rotateSessionCredential: async () => false as const },
			resolver: () => async () => "test-key",
		};

		const primary = await resolvePrimaryModel(undefined, settings, registry);
		expect(primary.model.id).toBe(commitModel.id);
		expect(primary.thinkingLevel).toBe(Effort.Low);

		const smol = await resolveFlashModel(settings, registry, commitModel, "fallback-key");
		expect(smol.model.id).toBe(commitModel.id);
		expect(smol.thinkingLevel).toBe(Effort.Low);
	});
});
