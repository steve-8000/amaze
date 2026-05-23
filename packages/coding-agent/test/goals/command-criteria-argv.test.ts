import { describe, expect, it } from "bun:test";
import { resetSettingsForTest, Settings } from "@amaze/coding-agent/config/settings";
import { type AcceptanceCriterion, AcceptanceVerifier } from "@amaze/coding-agent/goals/verifier";

async function withSettings(
	overrides: Partial<Record<"verifier.allowShellCriteria", unknown>>,
	run: () => Promise<void>,
) {
	resetSettingsForTest();
	await Settings.init({ inMemory: true, overrides });
	try {
		await run();
	} finally {
		resetSettingsForTest();
	}
}

async function verifyOne(criterion: AcceptanceCriterion) {
	const [result] = await new AcceptanceVerifier().verify([criterion], { cwd: "/tmp", changedFiles: [] });
	return result;
}

describe("AcceptanceVerifier command criteria argv mode", () => {
	it("passes command-output checks using argv", async () => {
		await withSettings({}, async () => {
			const result = await verifyOne({
				id: "argv-output",
				description: "echoes hi",
				check: { type: "command-output", argv: ["/bin/echo", "hi"], stdoutPattern: "^hi\\n?$" },
			});

			expect(result.status).toBe("pass");
		});
	});

	it("fails deprecated shell command checks when shell criteria are disabled", async () => {
		await withSettings({ "verifier.allowShellCriteria": false }, async () => {
			const result = await verifyOne({
				id: "shell-disabled",
				description: "shell command is gated",
				check: { type: "command-output", command: "echo hi", stdoutPattern: "hi" },
			});

			expect(result.status).toBe("fail");
			expect(result.evidence).toBe("shell criteria disabled by policy");
		});
	});

	it("passes deprecated shell command checks when shell criteria are explicitly enabled", async () => {
		await withSettings({ "verifier.allowShellCriteria": true }, async () => {
			const result = await verifyOne({
				id: "shell-enabled",
				description: "shell command can run",
				check: { type: "command-output", command: "echo hi", stdoutPattern: "^hi\\n?$" },
			});

			expect(result.status).toBe("pass");
		});
	});
});
