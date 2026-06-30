/**
 * Tests for plan mode thinking level propagation.
 *
 * Bug: When entering plan mode, the thinking level configured on the plan role
 * (e.g., "anthropic/claude-sonnet-4-6:xhigh") is discarded. resolveRoleModel()
 * calls resolveModelRoleValue() but only returns .model, dropping the thinking level.
 * #applyPlanModeModel() therefore has no thinking level to apply.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import * as path from "node:path";
import { Agent, ThinkingLevel } from "@steve-z8k/pi-agent-core";
import { ModelRegistry } from "@steve-z8k/pi-coding-agent/config/model-registry";
import { Settings } from "@steve-z8k/pi-coding-agent/config/settings";
import { AgentSession } from "@steve-z8k/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@steve-z8k/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@steve-z8k/pi-coding-agent/session/session-manager";
import { TempDir } from "@steve-z8k/pi-utils";

describe("plan mode thinking level", () => {
	let tempDir: TempDir;
	let session: AgentSession;
	let modelRegistry: ModelRegistry;
	let authStorage: AuthStorage;

	beforeAll(async () => {
		tempDir = TempDir.createSync("@pi-plan-thinking-");
		authStorage = await AuthStorage.create(path.join(tempDir.path(), "testauth.db"));
		authStorage.setRuntimeApiKey("anthropic", "test-key");
		modelRegistry = new ModelRegistry(authStorage);
	});

	afterEach(async () => {
		if (session) {
			await session.dispose();
		}
	});

	afterAll(() => {
		authStorage.close();
		tempDir.removeSync();
	});

	function createSessionWithRoles(modelRoles: Record<string, string>): AgentSession {
		const sonnet = modelRegistry.find("anthropic", "claude-sonnet-4-6");
		if (!sonnet) throw new Error("Expected claude-sonnet-4-6 to exist in registry");

		session = new AgentSession({
			agent: new Agent({
				initialState: { model: sonnet, systemPrompt: ["Test"], tools: [], messages: [] },
			}),
			sessionManager: SessionManager.inMemory(),
			settings: Settings.isolated({ modelRoles }),
			modelRegistry,
		});
		return session;
	}

	describe("resolveRoleModelWithThinking", () => {
		it("returns thinking level when plan role includes a thinking suffix", () => {
			createSessionWithRoles({ plan: "anthropic/claude-sonnet-4-6:xhigh" });

			const result = session.resolveRoleModelWithThinking("plan");

			expect(result.model).toBeDefined();
			expect(result.model!.provider).toBe("anthropic");
			expect(result.model!.id).toBe("claude-sonnet-4-6");
			expect(result.thinkingLevel).toBe(ThinkingLevel.High);
			expect(result.explicitThinkingLevel).toBe(true);
		});

		it("returns no explicit thinking level when plan role has no thinking suffix", () => {
			createSessionWithRoles({ plan: "anthropic/claude-sonnet-4-6" });

			const result = session.resolveRoleModelWithThinking("plan");

			expect(result.model).toBeDefined();
			expect(result.model!.id).toBe("claude-sonnet-4-6");
			expect(result.explicitThinkingLevel).toBe(false);
		});

		it("returns no model when no plan role is configured", () => {
			createSessionWithRoles({});

			const result = session.resolveRoleModelWithThinking("plan");

			expect(result.model).toBeUndefined();
		});

		it("returns thinking level for different levels", () => {
			createSessionWithRoles({ plan: "anthropic/claude-sonnet-4-6:high" });

			const result = session.resolveRoleModelWithThinking("plan");
			expect(result.thinkingLevel).toBe(ThinkingLevel.High);
			expect(result.explicitThinkingLevel).toBe(true);
		});

		it("works with the flash role", () => {
			createSessionWithRoles({ flash: "anthropic/claude-sonnet-4-6:medium" });

			const result = session.resolveRoleModelWithThinking("flash");
			expect(result.model!.id).toBe("claude-sonnet-4-6");
			expect(result.thinkingLevel).toBe(ThinkingLevel.Medium);
			expect(result.explicitThinkingLevel).toBe(true);
		});

		it("resolveRoleModel still returns just the model (backward compat)", () => {
			createSessionWithRoles({ plan: "anthropic/claude-sonnet-4-6:xhigh" });

			const model = session.resolveRoleModel("plan");
			expect(model).toBeDefined();
			expect(model!.provider).toBe("anthropic");
			expect(model!.id).toBe("claude-sonnet-4-6");
		});
	});
});
