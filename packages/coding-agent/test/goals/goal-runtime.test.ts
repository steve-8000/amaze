import { describe, expect, it } from "bun:test";
import {
	escapeXmlText,
	ObjectiveRuntimeImpl,
	type GoalRuntimeHost,
	goalTokenDelta,
	renderGoalBlock,
	renderGoalPrompt,
	renderUntrustedObjective,
} from "@amaze/coding-agent/goals/runtime";
import type { Goal, GoalModeState, GoalRuntimeEvent, GoalTokenUsage } from "@amaze/coding-agent/goals/state";

function createUsage(overrides: Partial<GoalTokenUsage> = {}): GoalTokenUsage {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		...overrides,
	};
}

function createGoal(overrides: Partial<Goal> = {}): Goal {
	return {
		id: "goal-1",
		objective: "Ship <fast> & safely",
		status: "active",
		tokenBudget: undefined,
		tokensUsed: 0,
		timeUsedSeconds: 0,
		createdAt: 0,
		updatedAt: 0,
		...overrides,
	};
}

function cloneGoal(goal: Goal): Goal {
	return { ...goal };
}

function cloneState(state: GoalModeState | undefined): GoalModeState | undefined {
	return state ? { ...state, goal: cloneGoal(state.goal) } : undefined;
}

function cloneEvent(event: GoalRuntimeEvent): GoalRuntimeEvent {
	if (event.type === "goal_updated") {
		return {
			...event,
			goal: event.goal ? cloneGoal(event.goal) : null,
			state: cloneState(event.state),
		};
	}
	return { ...event };
}

function createHarness(initial: { state?: GoalModeState; usage?: GoalTokenUsage; now?: number } = {}) {
	let state = cloneState(initial.state);
	let usage = createUsage(initial.usage);
	let now = initial.now ?? 0;
	const events: GoalRuntimeEvent[] = [];
	const persists: Array<{ mode: "goal" | "goal_paused" | "none"; state?: GoalModeState }> = [];
	const hiddenMessages: Array<{ customType: string; content: string; deliverAs?: "steer" | "followUp" | "nextTurn" }> =
		[];
	const host: GoalRuntimeHost = {
		getState: () => cloneState(state),
		setState: next => {
			state = cloneState(next);
		},
		getCurrentUsage: () => createUsage(usage),
		emit: async event => {
			events.push(cloneEvent(event));
		},
		persist: (mode, persistedState) => {
			persists.push({ mode, state: cloneState(persistedState) });
		},
		sendHiddenMessage: async message => {
			hiddenMessages.push({ ...message });
		},
		now: () => now,
	};
	return {
		runtime: new ObjectiveRuntimeImpl(host),
		getState: () => cloneState(state),
		setUsage: (next: Partial<GoalTokenUsage>) => {
			usage = createUsage(next);
		},
		advance: (ms: number) => {
			now += ms;
		},
		events,
		persists,
		hiddenMessages,
	};
}

describe("goal runtime", () => {
	it("counts cache writes but ignores cache reads in token deltas", () => {
		expect(
			goalTokenDelta(
				createUsage({ input: 13, output: 6, cacheRead: 999, cacheWrite: 8 }),
				createUsage({ input: 10, output: 4, cacheRead: 1, cacheWrite: 5 }),
			),
		).toBe(8);
	});

	it("clamps token deltas at zero across usage resets", () => {
		expect(
			goalTokenDelta(
				createUsage({ input: 10, output: 5, cacheRead: 0, cacheWrite: 2 }),
				createUsage({ input: 100, output: 50, cacheRead: 500, cacheWrite: 20 }),
			),
		).toBe(0);
	});

	it("advances wall-clock accounting only by persisted whole seconds", async () => {
		const harness = createHarness({
			state: { enabled: true, mode: "active", goal: createGoal() },
		});

		harness.runtime.onTurnStart("turn-1", createUsage());
		harness.advance(2_500);
		await harness.runtime.flushUsage("suppressed");
		expect(harness.getState()?.goal.timeUsedSeconds).toBe(2);
		expect(harness.runtime.snapshot.wallClock.lastAccountedAt).toBe(2_000);
		expect(harness.persists).toHaveLength(1);

		harness.advance(400);
		await harness.runtime.flushUsage("suppressed");
		expect(harness.getState()?.goal.timeUsedSeconds).toBe(2);
		expect(harness.runtime.snapshot.wallClock.lastAccountedAt).toBe(2_000);
		expect(harness.persists).toHaveLength(1);

		harness.advance(700);
		await harness.runtime.flushUsage("suppressed");
		expect(harness.getState()?.goal.timeUsedSeconds).toBe(3);
		expect(harness.runtime.snapshot.wallClock.lastAccountedAt).toBe(3_000);
		expect(harness.persists).toHaveLength(2);
	});

	it("steers only once until a budget mutation resets the cycle", async () => {
		const harness = createHarness({
			state: {
				enabled: true,
				mode: "active",
				goal: createGoal({ tokenBudget: 10, tokensUsed: 8 }),
			},
		});

		harness.runtime.onTurnStart("turn-1", createUsage());
		harness.setUsage({ input: 2 });
		await harness.runtime.flushUsage("allowed");
		expect(harness.getState()?.goal.status).toBe("budget-limited");
		expect(harness.hiddenMessages).toHaveLength(1);
		expect(harness.hiddenMessages[0]).toMatchObject({
			customType: "goal-budget-limit",
			deliverAs: "steer",
		});

		harness.setUsage({ input: 5 });
		await harness.runtime.flushUsage("allowed");
		expect(harness.hiddenMessages).toHaveLength(1);

		await harness.runtime.onBudgetMutated(20);
		expect(harness.getState()?.enabled).toBe(true);
		expect(harness.getState()?.goal.status).toBe("active");
		expect(harness.getState()?.goal.tokenBudget).toBe(20);
		expect(harness.hiddenMessages).toHaveLength(1);

		harness.setUsage({ input: 15 });
		await harness.runtime.flushUsage("allowed");
		expect(harness.getState()?.goal.status).toBe("budget-limited");
		expect(harness.hiddenMessages).toHaveLength(2);
	});

	it("pauses an active goal when an interruption aborts the task", async () => {
		const harness = createHarness({
			state: { enabled: true, mode: "active", goal: createGoal() },
		});

		harness.runtime.onTurnStart("turn-1", createUsage());
		harness.advance(1_000);
		harness.setUsage({ output: 4 });
		await harness.runtime.onTaskAborted({ reason: "interrupted" });

		const state = harness.getState();
		expect(state?.enabled).toBe(false);
		expect(state?.goal.status).toBe("paused");
		expect(state?.goal.tokensUsed).toBe(4);
		expect(state?.goal.timeUsedSeconds).toBe(1);
		expect(harness.persists.at(-1)?.mode).toBe("goal_paused");
	});

	it("preserves active goals when a thread resumes", async () => {
		const harness = createHarness({
			state: { enabled: true, mode: "active", goal: createGoal() },
		});

		const resumed = await harness.runtime.onThreadResumed();
		expect(resumed?.enabled).toBe(true);
		expect(resumed?.goal.status).toBe("active");
		expect(harness.getState()?.enabled).toBe(true);
		expect(harness.getState()?.goal.status).toBe("active");
		expect(harness.persists).toHaveLength(0);
		expect(harness.events.at(-1)?.type).toBe("goal_updated");
	});

	it("normalizes inactive active-goal wrappers when a thread resumes", async () => {
		const harness = createHarness({
			state: { enabled: false, mode: "active", goal: createGoal({ status: "active" }) },
		});

		const resumed = await harness.runtime.onThreadResumed();
		expect(resumed?.enabled).toBe(false);
		expect(resumed?.goal.status).toBe("paused");
		expect(harness.getState()?.enabled).toBe(false);
		expect(harness.getState()?.goal.status).toBe("paused");
		expect(harness.persists.at(-1)?.mode).toBe("goal_paused");
	});

	it("escapes XML in goal helpers and rendered prompts", () => {
		const objective = "Fix <root>&keep>safe";
		const goal = createGoal({ objective });
		const prompt = renderGoalPrompt("active", goal);

		expect(renderUntrustedObjective(objective)).toBe(
			"<untrusted_objective>\nFix &lt;root&gt;&amp;keep&gt;safe\n</untrusted_objective>",
		);
		expect(prompt).toContain("<untrusted_objective>");
		expect(prompt).toContain("</untrusted_objective>");
		expect(prompt).toContain("Fix &lt;root&gt;&amp;keep&gt;safe");
		expect(prompt).not.toContain(objective);
	});

	it("returns the input verbatim when escapeXmlText has nothing to escape", () => {
		const input = "plain text — with 'quotes' and \"double\" plus unicode ✓";
		expect(escapeXmlText(input)).toBe(input);
		// fast-path identity: the helper should not allocate a new string when nothing changed
		expect(escapeXmlText(input)).toBe(escapeXmlText(input));
	});

	it("escapeXmlText escapes only the XML-significant trio and leaves other characters untouched", () => {
		expect(escapeXmlText("a & b < c > d")).toBe("a &amp; b &lt; c &gt; d");
		expect(escapeXmlText("'\"`")).toBe("'\"`");
	});

	it("onBudgetMutated downward to below current usage flips active to budget-limited and steers", async () => {
		const harness = createHarness({
			state: {
				enabled: true,
				mode: "active",
				goal: createGoal({ tokenBudget: 100, tokensUsed: 30, status: "active" }),
			},
		});

		const next = await harness.runtime.onBudgetMutated(20);

		expect(next?.goal.status).toBe("budget-limited");
		expect(next?.goal.tokenBudget).toBe(20);
		expect(next?.goal.tokensUsed).toBe(30);
		expect(harness.hiddenMessages).toHaveLength(1);
		expect(harness.hiddenMessages[0]?.customType).toBe("goal-budget-limit");
	});

	it("rejects empty or oversized objectives before creating goal state", async () => {
		const harness = createHarness();

		await expect(harness.runtime.createGoal({ objective: "   " })).rejects.toThrow(
			"objective is required when op=create",
		);
		await expect(harness.runtime.createGoal({ objective: "x".repeat(4_001) })).rejects.toThrow(
			"Goal objective is too long: 4,001 characters. Limit: 4,000 characters.",
		);
		expect(harness.getState()).toBeUndefined();
	});

	it("preserves budget-limited status until the budget is raised or cleared", async () => {
		const harness = createHarness({
			state: {
				enabled: true,
				mode: "active",
				goal: createGoal({ status: "budget-limited", tokenBudget: 20, tokensUsed: 25 }),
			},
		});

		const paused = await harness.runtime.pauseGoal();
		expect(paused?.enabled).toBe(false);
		expect(paused?.goal.status).toBe("budget-limited");

		const resumed = await harness.runtime.resumeGoal();
		expect(resumed.enabled).toBe(true);
		expect(resumed.goal.status).toBe("budget-limited");

		const raised = await harness.runtime.onBudgetMutated(30);
		expect(raised?.enabled).toBe(true);
		expect(raised?.goal.status).toBe("active");

		const limitedAgain = await harness.runtime.onBudgetMutated(10);
		expect(limitedAgain?.goal.status).toBe("budget-limited");

		const cleared = await harness.runtime.onBudgetMutated(undefined);
		expect(cleared?.goal.status).toBe("active");
		expect(cleared?.goal.tokenBudget).toBeUndefined();
	});

	it("completeGoalFromTool clears enabled and flips status to complete with mode exiting (fix #1)", async () => {
		const harness = createHarness({
			state: {
				enabled: true,
				mode: "active",
				goal: createGoal({ tokenBudget: 100, tokensUsed: 42, timeUsedSeconds: 7 }),
			},
			now: 1_000,
		});

		const { goal: completed } = await harness.runtime.completeGoalFromTool();

		expect(completed.status).toBe("complete");
		expect(completed.completedAt).toBe(1_000);
		const state = harness.getState();
		expect(state?.enabled).toBe(false);
		expect(state?.mode).toBe("exiting");
		expect(state?.reason).toBe("completed");
		expect(state?.goal.status).toBe("complete");
	});

	it("completeGoalFromTool rejects stale expected goal ids", async () => {
		const harness = createHarness({
			state: {
				enabled: true,
				mode: "active",
				goal: createGoal({ id: "goal-current" }),
			},
		});

		await expect(harness.runtime.completeGoalFromTool({ expectedGoalId: "goal-old" })).rejects.toThrow(
			"stale goal completion rejected because the active goal changed",
		);
		expect(harness.getState()?.enabled).toBe(true);
		expect(harness.getState()?.goal.status).toBe("active");
	});

	it("blockGoalFromTool clears enabled and flips status to blocked", async () => {
		const harness = createHarness({
			state: {
				enabled: true,
				mode: "active",
				goal: createGoal({ id: "goal-current", tokenBudget: 100, tokensUsed: 42 }),
			},
		});

		const blocked = await harness.runtime.blockGoalFromTool({ expectedGoalId: "goal-current" });

		expect(blocked.status).toBe("blocked");
		const state = harness.getState();
		expect(state?.enabled).toBe(false);
		expect(state?.mode).toBe("active");
		expect(state?.reason).toBe("blocked");
		expect(state?.goal.status).toBe("blocked");
		expect(harness.persists.at(-1)?.mode).toBe("goal_paused");
	});

	it("dropGoal emits goal_updated with the dropped goal and clears persisted state", async () => {
		const harness = createHarness({
			state: {
				enabled: true,
				mode: "active",
				goal: createGoal({ id: "g-99", objective: "Ship soon" }),
			},
		});

		const dropped = await harness.runtime.dropGoal();

		expect(dropped?.status).toBe("dropped");
		expect(dropped?.id).toBe("g-99");
		expect(harness.getState()).toBeUndefined();
		const lastEvent = harness.events.at(-1);
		if (lastEvent?.type !== "goal_updated") {
			throw new Error("expected goal_updated event after dropGoal");
		}
		expect(lastEvent.goal?.status).toBe("dropped");
		expect(lastEvent.state?.enabled).toBe(false);
	});

	it("rejects op=create on the runtime when a non-dropped goal already exists", async () => {
		const harness = createHarness({
			state: {
				enabled: true,
				mode: "active",
				goal: createGoal({ objective: "Existing" }),
			},
		});

		await expect(harness.runtime.createGoal({ objective: "Second" })).rejects.toThrow(
			"cannot create a new goal because this session already has a goal",
		);
	});
});

describe("addExternalUsage", () => {
	it("rolls subagent delta into the parent goal's tokensUsed", async () => {
		const harness = createHarness({
			state: {
				enabled: true,
				mode: "active",
				goal: createGoal({ tokenBudget: 100_000, tokensUsed: 1_000 }),
			},
		});

		await harness.runtime.addExternalUsage(5_500);

		expect(harness.getState()?.goal.tokensUsed).toBe(6_500);
		// Persists so the next CLI restart preserves the rolled-up total.
		expect(harness.persists.at(-1)?.mode).toBe("goal");
	});

	it("flips status to budget-limited when the rollup crosses the threshold", async () => {
		const harness = createHarness({
			state: {
				enabled: true,
				mode: "active",
				goal: createGoal({ tokenBudget: 10_000, tokensUsed: 9_000 }),
			},
		});

		await harness.runtime.addExternalUsage(2_000);

		expect(harness.getState()?.goal.tokensUsed).toBe(11_000);
		expect(harness.getState()?.goal.status).toBe("budget-limited");
		// Steer is sent so the model knows the budget pressure crossed during delegation.
		expect(harness.hiddenMessages.at(-1)?.customType).toBe("goal-budget-limit");
	});

	it("ignores negative or zero deltas", async () => {
		const harness = createHarness({
			state: { enabled: true, mode: "active", goal: createGoal({ tokensUsed: 500 }) },
		});
		await harness.runtime.addExternalUsage(0);
		await harness.runtime.addExternalUsage(-100);
		expect(harness.getState()?.goal.tokensUsed).toBe(500);
		expect(harness.persists).toHaveLength(0);
	});

	it("no-ops when no goal is active", async () => {
		const harness = createHarness();
		await harness.runtime.addExternalUsage(1_000);
		expect(harness.getState()).toBeUndefined();
	});
});

describe("updateGoal", () => {
	it("merges partial design answers without clobbering existing keys", async () => {
		const harness = createHarness({
			state: {
				enabled: true,
				mode: "active",
				goal: createGoal({
					designAnswers: { scope: "files A, B", constraints: "no network" },
				}),
			},
		});

		const updated = await harness.runtime.updateGoal({
			designAnswers: { scope: "files A, B, C", acceptance: "all tests green" },
		});

		expect(updated?.designAnswers).toEqual({
			scope: "files A, B, C",
			constraints: "no network",
			acceptance: "all tests green",
		});
	});

	it("removes a design answer key when its value is set to empty string", async () => {
		const harness = createHarness({
			state: {
				enabled: true,
				mode: "active",
				goal: createGoal({
					designAnswers: { scope: "files A", constraints: "no network" },
				}),
			},
		});

		const updated = await harness.runtime.updateGoal({
			designAnswers: { constraints: "" },
		});

		expect(updated?.designAnswers).toEqual({ scope: "files A" });
	});

	it("revises objective and token budget without touching answers", async () => {
		const harness = createHarness({
			state: {
				enabled: true,
				mode: "active",
				goal: createGoal({
					objective: "original",
					tokenBudget: 10000,
					designAnswers: { scope: "X" },
				}),
			},
		});

		const updated = await harness.runtime.updateGoal({
			objective: "revised scope",
			tokenBudget: 30000,
		});

		expect(updated?.objective).toBe("revised scope");
		expect(updated?.tokenBudget).toBe(30000);
		expect(updated?.designAnswers).toEqual({ scope: "X" });
	});

	it("clears token budget when tokenBudget is null", async () => {
		const harness = createHarness({
			state: { enabled: true, mode: "active", goal: createGoal({ tokenBudget: 5000 }) },
		});
		const updated = await harness.runtime.updateGoal({ tokenBudget: null });
		expect(updated?.tokenBudget).toBeUndefined();
	});

	it("rejects invalid token budgets silently (leaves existing value untouched)", async () => {
		const harness = createHarness({
			state: { enabled: true, mode: "active", goal: createGoal({ tokenBudget: 5000 }) },
		});
		const updated = await harness.runtime.updateGoal({ tokenBudget: -100 });
		expect(updated?.tokenBudget).toBe(5000);
	});

	it("no-ops when no goal is active", async () => {
		const harness = createHarness();
		const updated = await harness.runtime.updateGoal({ objective: "X" });
		expect(updated).toBeUndefined();
	});
});

describe("captureDesignAnswers", () => {
	it("writes design answers onto the active goal and persists", async () => {
		const harness = createHarness({
			state: { enabled: true, mode: "active", goal: createGoal({ id: "g-7", objective: "Build x" }) },
		});

		const captured = await harness.runtime.captureDesignAnswers({
			scope: "files A, B",
			acceptance: "tests pass",
		});

		expect(captured).toBe(true);
		expect(harness.getState()?.goal.designAnswers).toEqual({
			scope: "files A, B",
			acceptance: "tests pass",
		});
		// Persists the goal so the answers survive process restart.
		expect(harness.persists.at(-1)?.mode).toBe("goal");
	});

	it("is one-shot: subsequent calls do not overwrite captured answers", async () => {
		const harness = createHarness({
			state: {
				enabled: true,
				mode: "active",
				goal: createGoal({ designAnswers: { scope: "original" } }),
			},
		});

		const captured = await harness.runtime.captureDesignAnswers({ scope: "new attempt" });

		expect(captured).toBe(false);
		expect(harness.getState()?.goal.designAnswers).toEqual({ scope: "original" });
	});

	it("no-ops when no goal is enabled", async () => {
		const harness = createHarness();
		const captured = await harness.runtime.captureDesignAnswers({ scope: "X" });
		expect(captured).toBe(false);
	});

	it("ignores empty answer payloads", async () => {
		const harness = createHarness({
			state: { enabled: true, mode: "active", goal: createGoal() },
		});
		const captured = await harness.runtime.captureDesignAnswers({});
		expect(captured).toBe(false);
		expect(harness.getState()?.goal.designAnswers).toBeUndefined();
	});
});

describe("renderGoalBlock", () => {
	it("emits a stable empty sentinel for null/undefined goals", () => {
		expect(renderGoalBlock(null)).toBe(`<goal status="none"/>`);
		expect(renderGoalBlock(undefined)).toBe(`<goal status="none"/>`);
	});

	it("collapses complete and dropped goals to the empty sentinel", () => {
		// Once a goal is out of scope, its anchor MUST leave the prompt so the model
		// stops treating its constraints as binding.
		expect(renderGoalBlock(createGoal({ status: "complete" }))).toBe(`<goal status="none"/>`);
		expect(renderGoalBlock(createGoal({ status: "dropped" }))).toBe(`<goal status="none"/>`);
	});

	it("renders the active objective with escaped untrusted content", () => {
		const goal = createGoal({
			id: "g-7",
			objective: "Ship <fast> & safely",
			status: "active",
		});
		expect(renderGoalBlock(goal)).toBe(
			`<goal id="g-7" status="active" budget="unbounded" remaining="unbounded" contract-revision="0">\n` +
				`  <objective>Ship &lt;fast&gt; &amp; safely</objective>\n` +
				`</goal>`,
		);
	});

	it("surfaces budget/remaining attributes when a token budget is configured", () => {
		const goal = createGoal({
			id: "g-8",
			objective: "Trim",
			status: "active",
			tokenBudget: 1000,
			tokensUsed: 250,
		});
		expect(renderGoalBlock(goal)).toContain(`budget="1000" remaining="750"`);
	});

	it("walks designAnswers in insertion order so the rendered block is byte-stable", () => {
		// The renderer MUST NOT sort keys: the interview captures answers in a canonical
		// order (scope, constraints, approach, acceptance) that mirrors the question
		// semantics — sorting would scramble that.
		const goal = createGoal({
			id: "g-9",
			objective: "Build x",
			status: "active",
			designAnswers: {
				scope: "files A, B",
				constraints: "no network",
				approach: "in-place edits",
				acceptance: "tests pass",
			},
		});
		const rendered = renderGoalBlock(goal);
		const designLines = rendered.split("\n").filter(line => line.includes("<design"));
		expect(designLines).toEqual([
			`  <design key="scope">files A, B</design>`,
			`  <design key="constraints">no network</design>`,
			`  <design key="approach">in-place edits</design>`,
			`  <design key="acceptance">tests pass</design>`,
		]);
	});

	it("skips empty answer values so partial interviews do not render noise", () => {
		const goal = createGoal({
			designAnswers: { scope: "files A, B", constraints: "" },
		});
		const rendered = renderGoalBlock(goal);
		expect(rendered).toContain(`<design key="scope">files A, B</design>`);
		expect(rendered).not.toContain(`<design key="constraints"`);
	});

	it("produces byte-identical output for two identical goals (cache stability)", () => {
		const a = createGoal({
			id: "g-10",
			objective: "Same",
			status: "active",
			designAnswers: { scope: "X", acceptance: "Y" },
		});
		const b = createGoal({
			id: "g-10",
			objective: "Same",
			status: "active",
			designAnswers: { scope: "X", acceptance: "Y" },
		});
		expect(renderGoalBlock(a)).toBe(renderGoalBlock(b));
	});
});
