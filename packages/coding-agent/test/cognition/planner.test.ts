import { describe, expect, test } from "bun:test";
import { buildPlannerPrompt, decomposeGoal, type PlannerLlm, parsePlannerOutput } from "../../src/cognition/planner";

describe("parsePlannerOutput", () => {
	test("parses a valid plan with dependencies", () => {
		const raw = JSON.stringify({
			rationale: "split by layer",
			steps: [
				{ id: "s1", description: "define schema", dependsOn: [] },
				{ id: "s2", description: "implement store", dependsOn: ["s1"] },
				{ id: "s3", description: "add tests", dependsOn: ["s2"] },
			],
		});
		const { plan, errors } = parsePlannerOutput(raw);
		expect(errors).toEqual([]);
		expect(plan?.steps).toHaveLength(3);
		expect(plan?.rationale).toBe("split by layer");
		expect(plan?.steps[1]?.edges).toEqual([{ target: "s1", kind: "depends-on" }]);
	});

	test("strips code fences and surrounding prose", () => {
		const raw = 'Here is the plan:\n```json\n{"steps":[{"id":"s1","description":"do it","dependsOn":[]}]}\n```';
		const { plan, errors } = parsePlannerOutput(raw);
		expect(errors).toEqual([]);
		expect(plan?.steps[0]?.description).toBe("do it");
	});

	test("rejects dangling dependency references", () => {
		const raw = JSON.stringify({
			steps: [{ id: "s1", description: "a", dependsOn: ["ghost"] }],
		});
		const { plan, errors } = parsePlannerOutput(raw);
		expect(plan).toBeUndefined();
		expect(errors.some(e => e.includes("unknown step ghost"))).toBe(true);
	});

	test("rejects dependency cycles", () => {
		const raw = JSON.stringify({
			steps: [
				{ id: "s1", description: "a", dependsOn: ["s2"] },
				{ id: "s2", description: "b", dependsOn: ["s1"] },
			],
		});
		const { plan, errors } = parsePlannerOutput(raw);
		expect(plan).toBeUndefined();
		expect(errors).toContain("dependency graph contains a cycle");
	});

	test("rejects duplicate ids, missing descriptions, non-JSON", () => {
		expect(parsePlannerOutput("no json here").errors).toContain("no JSON object found in planner output");
		expect(
			parsePlannerOutput(
				JSON.stringify({
					steps: [
						{ id: "s1", description: "a" },
						{ id: "s1", description: "b" },
					],
				}),
			).errors,
		).toContain("duplicate step id: s1");
		expect(parsePlannerOutput(JSON.stringify({ steps: [{ id: "s1", description: "" }] })).errors).toContain(
			"step s1 has no description",
		);
	});

	test("rejects plans exceeding the step bound", () => {
		const steps = Array.from({ length: 10 }, (_, i) => ({ id: `s${i + 1}`, description: `step ${i + 1}` }));
		const { errors } = parsePlannerOutput(JSON.stringify({ steps }));
		expect(errors.some(e => e.includes("too many steps"))).toBe(true);
	});
});

describe("buildPlannerPrompt", () => {
	test("includes heuristics, world model, and critic feedback sections when present", () => {
		const prompt = buildPlannerPrompt({
			objective: "ship feature",
			constraints: ["no new deps"],
			heuristics: ["smaller steps verify better"],
			worldModel: ["claim [pass] (verified): store exists"],
			criticFeedback: ["step 2 was not verifiable"],
			priorPlan: { steps: [{ id: "s1", description: "old step" }], revision: 1 },
		});
		expect(prompt).toContain("<objective>");
		expect(prompt).toContain("no new deps");
		expect(prompt).toContain("<learned-heuristics>");
		expect(prompt).toContain("<world-model>");
		expect(prompt).toContain('<prior-plan revision="1">');
		expect(prompt).toContain("<critic-feedback>");
	});

	test("omits empty sections", () => {
		const prompt = buildPlannerPrompt({ objective: "x" });
		expect(prompt).not.toContain("<learned-heuristics>");
		expect(prompt).not.toContain("<critic-feedback>");
	});
});

describe("decomposeGoal", () => {
	const validOutput = JSON.stringify({
		steps: [{ id: "s1", description: "only step", dependsOn: [] }],
	});

	test("returns a revision-stamped plan on first valid output", async () => {
		const llm: PlannerLlm = async () => validOutput;
		const { plan, attempts } = await decomposeGoal({ objective: "x" }, llm);
		expect(attempts).toBe(1);
		expect(plan.revision).toBe(1);
	});

	test("retries with validation errors appended, then succeeds", async () => {
		const prompts: string[] = [];
		let call = 0;
		const llm: PlannerLlm = async (_system, user) => {
			prompts.push(user);
			call++;
			return call === 1 ? "garbage" : validOutput;
		};
		const { attempts } = await decomposeGoal({ objective: "x" }, llm);
		expect(attempts).toBe(2);
		expect(prompts[1]).toContain("<validation-errors>");
	});

	test("throws after exhausting attempts", async () => {
		const llm: PlannerLlm = async () => "still garbage";
		await expect(decomposeGoal({ objective: "x" }, llm)).rejects.toThrow(/no valid plan after 2 attempts/);
	});

	test("revision increments over the prior plan", async () => {
		const llm: PlannerLlm = async () => validOutput;
		const { plan } = await decomposeGoal(
			{ objective: "x", priorPlan: { steps: [{ id: "s1", description: "old" }], revision: 4 } },
			llm,
		);
		expect(plan.revision).toBe(5);
	});
});
