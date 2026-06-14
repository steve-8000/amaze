import { describe, expect, it } from "bun:test";
import {
	createBlockWorkingDirChangesPolicy,
	parseShellInvocations,
	RuntimePolicyEngine,
	RuntimePolicyRegistry,
} from "@amaze/coding-agent/tools/gateway/index";
import { SessionToolGateway } from "../../../src/tools/gateway/session-gateway";
import type { ToolDescriptor } from "../../../src/tools/registry/tool-descriptor";

function descriptor(overrides: Partial<ToolDescriptor> & Pick<ToolDescriptor, "name">): ToolDescriptor {
	return {
		toolClass: "native",
		domain: "shell",
		riskLevel: "CRITICAL",
		mutatesWorkspace: true,
		requiresApproval: false,
		supportsRollback: false,
		execute: async () => ({ ok: true, output: undefined }),
		...overrides,
	};
}

describe("RuntimePolicyRegistry", () => {
	it("rejects duplicate policy ids", () => {
		const registry = new RuntimePolicyRegistry();
		const policy = { id: "p", name: "P", description: "test", factory: () => () => undefined };
		registry.register(policy);
		expect(() => registry.register(policy)).toThrow(/duplicate policy id/);
		expect(registry.list()).toHaveLength(1);
	});
});

describe("RuntimePolicyEngine", () => {
	it("short-circuits on DENY and applies state updates", () => {
		const engine = new RuntimePolicyEngine([
			() => ({ result: "ALLOW", stateUpdates: [{ key: "calls", action: "increment" }] }),
			() => ({ result: "DENY", reason: "blocked", code: "BLOCKED" }),
			() => {
				throw new Error("must not run");
			},
		]);
		const decision = engine.check(descriptor({ name: "bash" }), { input: { command: "echo ok" } }, "CRITICAL");
		expect(decision).toMatchObject({ allowed: false, reason: "blocked", code: "BLOCKED" });
		expect(engine.state.calls).toBe(1);
	});

	it("fails closed when a policy throws", () => {
		const engine = new RuntimePolicyEngine([
			() => {
				throw new Error("boom");
			},
		]);
		const decision = engine.check(descriptor({ name: "bash" }), {}, "CRITICAL");
		expect(decision).toMatchObject({ allowed: false, code: "POLICY_EXCEPTION" });
	});
});

describe("shell working-directory policy", () => {
	it("unwraps wrappers and shell interpreters", () => {
		const invocations = parseShellInvocations("sudo env FOO=1 bash -c 'git -C /tmp status && echo ok'");
		expect(invocations.map(invocation => invocation.argv)).toEqual([
			["git", "-C", "/tmp", "status"],
			["echo", "ok"],
		]);
	});

	it("blocks cd and git worktree changes through SessionToolGateway", async () => {
		const gateway = new SessionToolGateway({
			policies: [createBlockWorkingDirChangesPolicy()],
		});
		const cd = await gateway.decide("bash", { input: { command: "echo ok && cd /tmp" } });
		expect(cd).toMatchObject({ allowed: false, code: "WORKING_DIR_CHANGE_BLOCKED" });

		const worktree = await gateway.decide("bash", { input: { command: "bash -c 'git worktree add ../x'" } });
		expect(worktree).toMatchObject({ allowed: false, code: "WORKING_DIR_CHANGE_BLOCKED" });
	});

	it("allows configured directories and normal commands", async () => {
		const gateway = new SessionToolGateway({
			policies: [createBlockWorkingDirChangesPolicy({ allowedDirs: ["/repo"] })],
		});
		const allowedCd = await gateway.decide("bash", { input: { command: "cd /repo/src && bun test" } });
		expect(allowedCd.allowed).toBe(true);

		const normal = await gateway.decide("bash", { input: { command: "git status && bun test" } });
		expect(normal.allowed).toBe(true);
	});

	it("treats ambiguous shell quoting as review-required", async () => {
		const gateway = new SessionToolGateway({
			policies: [createBlockWorkingDirChangesPolicy({ action: "ask" })],
		});
		const decision = await gateway.decide("bash", { input: { command: "echo 'unterminated" } });
		expect(decision).toMatchObject({ allowed: false, code: "SHELL_COMMAND_AMBIGUOUS" });
	});
});
