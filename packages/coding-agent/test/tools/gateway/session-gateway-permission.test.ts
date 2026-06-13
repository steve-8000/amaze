import { describe, expect, it } from "bun:test";
import { SessionToolGateway } from "../../../src/tools/gateway/session-gateway";

describe("SessionToolGateway permissionMode", () => {
	it("default allow-all permits HIGH/CRITICAL seam tools without approval", async () => {
		const gateway = new SessionToolGateway();
		for (const tool of ["write", "edit", "ast_edit", "bash"]) {
			const decision = await gateway.decide(tool, { toolCallId: "t1" });
			expect(decision.allowed).toBe(true);
		}
	});

	it("enforce denies HIGH/CRITICAL seam tools without granted approval", async () => {
		const gateway = new SessionToolGateway({ permissionMode: "enforce" });
		for (const tool of ["write", "edit", "ast_edit", "bash"]) {
			const decision = await gateway.decide(tool, { toolCallId: "t1" });
			expect(decision.allowed).toBe(false);
			if (!decision.allowed) expect(decision.reason).toMatch(/approval/);
		}
	});

	it("enforce permits seam tools when approval is granted", async () => {
		const gateway = new SessionToolGateway({ permissionMode: "enforce" });
		for (const tool of ["write", "bash"]) {
			const decision = await gateway.decide(tool, { toolCallId: "t1", approvalGranted: true });
			expect(decision.allowed).toBe(true);
		}
	});

	it("enforce still permits MEDIUM tools without approval", async () => {
		const gateway = new SessionToolGateway({ permissionMode: "enforce" });
		const decision = await gateway.decide("github", { toolCallId: "t1" });
		expect(decision.allowed).toBe(true);
	});
});
