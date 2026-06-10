import { describe, expect, test } from "bun:test";
import { Settings } from "../../src/config/settings";
import type { ClientBridge, ClientBridgePermissionOutcome } from "../../src/session/client-bridge";
import { BashTool } from "../../src/tools/bash";
import type { ToolSession } from "../../src/tools/index";

function makeSession(opts: { bridge?: ClientBridge; cwd?: string } = {}): ToolSession {
	return {
		cwd: opts.cwd ?? "/definitely-missing-amaze-infra-test-cwd",
		hasUI: false,
		settings: Settings.isolated({}),
		skills: [],
		getClientBridge: () => opts.bridge,
	} as unknown as ToolSession;
}

function countingBridge(): { bridge: ClientBridge; count: () => number } {
	let requests = 0;
	return {
		bridge: {
			capabilities: { requestPermission: true },
			requestPermission: async (): Promise<ClientBridgePermissionOutcome> => {
				requests++;
				return { outcome: "selected", optionId: "allow_once", kind: "allow_once" };
			},
		} as ClientBridge,
		count: () => requests,
	};
}

async function run(session: ToolSession, command: string): Promise<{ ok: boolean; error?: string }> {
	try {
		await new BashTool(session).execute("call-1", { command, timeout: 5 } as never, undefined, undefined, undefined);
		return { ok: true };
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}
}

describe("bash infra commands", () => {
	test("mutating infra commands are not blocked by a code-enforced approval gate", async () => {
		const result = await run(makeSession(), "kubectl apply -f deploy.yaml");

		expect(result.ok).toBe(false);
		expect(result.error).not.toContain("requires explicit user approval");
		expect(result.error).not.toContain("infra.approval.allowlist");
		expect(result.error).toContain("Working directory does not exist");
	});

	test("local bash execution does not request a separate infra approval from the client bridge", async () => {
		const bridge = countingBridge();
		const result = await run(makeSession({ bridge: bridge.bridge }), "terraform destroy -auto-approve");

		expect(result.ok).toBe(false);
		expect(result.error).not.toContain("requires explicit user approval");
		expect(result.error).toContain("Working directory does not exist");
		expect(bridge.count()).toBe(0);
	});
});
