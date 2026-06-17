import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FreshBootContract } from "../../src/harness/fresh-boot-contract.ts";
import type { PathContract } from "../../src/harness/path-contract.ts";
import {
	DEFAULT_SCOUT_ACTIVITY_BUDGET,
	withDefaultScoutActivityBudget,
} from "../../src/runs/shared/default-activity-budget.ts";

describe("default scout activity budget", () => {
	it("adds a bounded activity budget for scout when no contract is supplied", () => {
		const contract = withDefaultScoutActivityBudget("scout", undefined, undefined);

		assert.deepEqual(contract, {
			contract_id: "default-scout-activity-budget",
			assigned_worker: "scout",
			activity_budget: DEFAULT_SCOUT_ACTIVITY_BUDGET,
		});
	});

	it("does not override explicit path or boot contracts", () => {
		const pathContract: PathContract = {
			contract_id: "explicit",
			activity_budget: { max_tool_uses: 3 },
		};
		const bootContract = {} as FreshBootContract;

		assert.equal(withDefaultScoutActivityBudget("scout", pathContract, undefined), pathContract);
		assert.equal(withDefaultScoutActivityBudget("scout", undefined, bootContract), undefined);
	});

	it("does not add budgets for non-scout agents", () => {
		assert.equal(withDefaultScoutActivityBudget("reviewer", undefined, undefined), undefined);
	});
});
