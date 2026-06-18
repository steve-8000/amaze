import { describe, expect, it } from "vitest";
import { mcpEntrypointContract } from "../src/cli/mcp-contract.ts";

describe("CLI MCP entrypoint contract", () => {
	it("routes amaze mcp to Xenonite migration guidance with exit code 2", () => {
		const contract = mcpEntrypointContract(["mcp"]);

		expect(contract).toMatchObject({ kind: "xenonite-migration", exitCode: 2 });
		if (contract.kind !== "xenonite-migration") throw new Error("expected Xenonite migration contract");
		expect(contract.messages.join("\n")).toContain("amaze mcp has moved to Xenonite");
		expect(contract.messages.join("\n")).toContain("XENONITE_MCP_TOOL_MODE=full npm start");
		expect(contract.messages.join("\n")).toContain("amaze mcp-dev");
	});

	it("keeps amaze mcp-dev routed to the local experimental adapter", () => {
		expect(mcpEntrypointContract(["mcp-dev"])).toEqual({ kind: "local-dev-adapter" });
	});

	it("does not intercept normal root CLI commands", () => {
		expect(mcpEntrypointContract(["--help"])).toEqual({ kind: "none" });
	});
});
