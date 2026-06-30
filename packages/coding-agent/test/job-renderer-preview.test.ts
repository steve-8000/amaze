/**
 * The job tool's TUI preview must not leak the model-facing `<task-result>`
 * envelope (prompts/tools/task-summary.md): a settled task job previews the
 * inner <output>/<preview> body, while non-envelope result text (bash jobs)
 * passes through unchanged.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { AsyncJobManager } from "@steve-z8k/pi-coding-agent/async/job-manager";
import { resetSettingsForTest, Settings } from "@steve-z8k/pi-coding-agent/config/settings";
import { initTheme, theme } from "@steve-z8k/pi-coding-agent/modes/theme/theme";
import { AgentRegistry } from "@steve-z8k/pi-coding-agent/registry/agent-registry";
import { JobTool, jobToolRenderer } from "@steve-z8k/pi-coding-agent/tools/job";
import { prompt } from "@steve-z8k/pi-utils";
import taskSummaryTemplate from "../src/prompts/tools/task-summary.md" with { type: "text" };

function renderLines(resultText: string): string {
	const result = {
		content: [{ type: "text", text: "" }],
		details: {
			jobs: [
				{
					id: "SpawnProbe",
					type: "task" as const,
					status: "completed" as const,
					label: "SpawnProbe",
					agentName: "flash",
					durationMs: 8_700,
					resultText,
				},
			],
		},
	};
	const component = jobToolRenderer.renderResult(
		result,
		{ expanded: true } as Parameters<typeof jobToolRenderer.renderResult>[1],
		theme,
	);
	return (component.render(120) as readonly string[]).join("\n");
}

describe("job renderer task-result preview", () => {
	beforeAll(async () => {
		resetSettingsForTest();
		await Settings.init({ inMemory: true });
		await initTheme();
	});

	afterEach(() => {
		AgentRegistry.resetGlobalForTests();
	});

	afterAll(() => {
		resetSettingsForTest();
	});

	it("previews the envelope body, not the wrapper markup", () => {
		const summary = prompt.render(taskSummaryTemplate, {
			agentName: "quick_task",
			id: "SpawnProbe",
			status: "completed",
			duration: "8.7s",
			preview: "Probe finished: spawned worker, ping ok.",
			truncated: false,
			meta: { lineCount: 3, charSize: "120 B" },
			mergeSummary: "",
		});
		const deliveryText = `${summary}\n\nSpawnProbe completed — transcript at history://SpawnProbe`;

		const output = renderLines(deliveryText);
		expect(output).toContain("Probe finished: spawned worker, ping ok.");
		expect(output).not.toContain("<task-result");
		expect(output).not.toContain("<output>");
	});

	it("previews the truncated <preview> body the same way", () => {
		const summary = prompt.render(taskSummaryTemplate, {
			agentName: "task",
			id: "BigOne",
			status: "completed",
			duration: "2m",
			preview: "first line of long output",
			truncated: true,
			mergeSummary: "",
		});

		const output = renderLines(summary);
		expect(output).toContain("first line of long output");
		expect(output).not.toContain("<task-result");
	});

	it("flattens a pretty-printed JSON body instead of previewing a lone brace", () => {
		const summary = prompt.render(taskSummaryTemplate, {
			agentName: "quick_task",
			id: "EchoAlpha",
			status: "completed",
			duration: "11.6s",
			preview: '{\n  "echo": "alpha",\n  "ok": true\n}',
			truncated: false,
			mergeSummary: "",
		});

		const output = Bun.stripANSI(renderLines(summary));
		expect(output).toContain('{ "echo": "alpha", "ok": true }');
		expect(output.split("\n").some(line => line.trim() === "{")).toBe(false);
	});

	it("passes non-envelope result text through unchanged", () => {
		const output = renderLines("42 pass, 0 fail (18.4s)");
		expect(output).toContain("42 pass, 0 fail (18.4s)");
	});

	it("renders the task subagent name in the type badge without repeating the id", () => {
		const output = Bun.stripANSI(renderLines("done"));
		const header = output.split("\n").find(line => line.includes("SpawnProbe"));
		expect(header).toBeDefined();
		expect(header).toContain("task:flash");
		expect(header!.match(/SpawnProbe/g)).toHaveLength(1);
	});

	it("infers the task subagent badge from the agent registry for legacy running jobs", async () => {
		AgentRegistry.global().register({
			id: "LegacyRunning",
			agentName: "flash",
			displayName: "tool cleanup",
			kind: "sub",
			session: null,
			status: "running",
		});
		const manager = new AsyncJobManager({ onJobComplete: () => {} });
		const release = Promise.withResolvers<string>();
		const jobId = manager.register("task", "LegacyRunning", async () => release.promise, { id: "LegacyRunning" });
		try {
			const tool = new JobTool({ asyncJobManager: manager, getAgentId: () => null } as never);
			const result = await tool.execute("tc-legacy-running", { list: true });
			expect(result.details?.jobs.find(job => job.id === jobId)?.agentName).toBe("flash");
			const component = jobToolRenderer.renderResult(
				result,
				{ expanded: true, isPartial: true } as Parameters<typeof jobToolRenderer.renderResult>[1],
				theme,
				{ list: true },
			);
			const output = Bun.stripANSI((component.render(120) as readonly string[]).join("\n"));
			expect(output).toContain("task:flash");
		} finally {
			release.resolve("done");
			await manager.waitForAll();
		}
	});

	describe("collapse and filter when turned into a result", () => {
		const jobsData = [
			{
				id: "Job1",
				type: "task" as const,
				status: "running" as const,
				label: "Job1 running",
				durationMs: 1200,
			},
			{
				id: "Job2",
				type: "task" as const,
				status: "completed" as const,
				label: "Job2 completed",
				durationMs: 3400,
				resultText: "Job2 result",
			},
			{
				id: "Job3",
				type: "task" as const,
				status: "running" as const,
				label: "Job3 running",
				durationMs: 500,
			},
		];

		it("shows all jobs when isPartial is true", () => {
			const result = {
				content: [{ type: "text" as const, text: "" }],
				details: { jobs: jobsData },
			};
			const component = jobToolRenderer.renderResult(
				result,
				{ expanded: true, isPartial: true } as Parameters<typeof jobToolRenderer.renderResult>[1],
				theme,
				{ poll: [] },
			);
			const output = Bun.stripANSI((component.render(120) as readonly string[]).join("\n"));
			expect(output).toContain("Job1 running");
			expect(output).toContain("Job2 completed");
			expect(output).toContain("Job3 running");
			expect(output).toContain("waiting on 2 of 3 jobs");
		});

		it("shows only finished jobs when isPartial is false and it is a poll call", () => {
			const result = {
				content: [{ type: "text" as const, text: "" }],
				details: { jobs: jobsData },
			};
			const component = jobToolRenderer.renderResult(
				result,
				{ expanded: true, isPartial: false } as Parameters<typeof jobToolRenderer.renderResult>[1],
				theme,
				{ poll: [] },
			);
			const output = Bun.stripANSI((component.render(120) as readonly string[]).join("\n"));
			expect(output).not.toContain("Job1 running");
			expect(output).toContain("Job2 completed");
			expect(output).not.toContain("Job3 running");
			expect(output).toContain("1 job settled");
		});

		it("shows nothing when isPartial is false and all jobs are running and it is a poll call", () => {
			const runningJobsOnly = [
				{
					id: "Job1",
					type: "task" as const,
					status: "running" as const,
					label: "Job1 running",
					durationMs: 1200,
				},
			];
			const result = {
				content: [{ type: "text" as const, text: "" }],
				details: { jobs: runningJobsOnly },
			};
			const component = jobToolRenderer.renderResult(
				result,
				{ expanded: true, isPartial: false } as Parameters<typeof jobToolRenderer.renderResult>[1],
				theme,
				{ poll: [] },
			);
			const lines = component.render(120) as readonly string[];
			expect(lines).toHaveLength(0);
		});

		it("does not collapse running jobs when isPartial is false and list is true", () => {
			const result = {
				content: [{ type: "text" as const, text: "" }],
				details: { jobs: jobsData },
			};
			const component = jobToolRenderer.renderResult(
				result,
				{ expanded: true, isPartial: false } as Parameters<typeof jobToolRenderer.renderResult>[1],
				theme,
				{ list: true },
			);
			const output = Bun.stripANSI((component.render(120) as readonly string[]).join("\n"));
			expect(output).toContain("Job1 running");
			expect(output).toContain("Job2 completed");
			expect(output).toContain("Job3 running");
			expect(output).toContain("waiting on 2 of 3 jobs");
		});

		it("does not collapse running jobs when isPartial is false and cancel-only is true", () => {
			const result = {
				content: [{ type: "text" as const, text: "" }],
				details: { jobs: jobsData },
			};
			const component = jobToolRenderer.renderResult(
				result,
				{ expanded: true, isPartial: false } as Parameters<typeof jobToolRenderer.renderResult>[1],
				theme,
				{ cancel: ["Job1"] },
			);
			const output = Bun.stripANSI((component.render(120) as readonly string[]).join("\n"));
			expect(output).toContain("Job1 running");
			expect(output).toContain("Job2 completed");
			expect(output).toContain("Job3 running");
			expect(output).toContain("waiting on 2 of 3 jobs");
		});
	});
});
