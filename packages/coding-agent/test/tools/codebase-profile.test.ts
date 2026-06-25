import { describe, expect, it } from "bun:test";
import { Settings } from "@amaze/pi-coding-agent/config/settings";
import type { ToolSession } from "../../src/tools";
import { CodebasePlanTool, CodebaseReadTool, CodebaseValidateTool } from "../../src/tools/codebase-profile";

type TestFetch = NonNullable<ToolSession["fetch"]>;
type TestFetchInput = Parameters<TestFetch>[0];
type TestFetchInit = Parameters<TestFetch>[1];

function createSession(fetch: TestFetch): ToolSession {
	return {
		cwd: "/repo/packages/coding-agent",
		hasUI: false,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		fetch,
		settings: Settings.isolated({
			"rocky.apiUrl": "http://rocky.test",
			"rocky.projectPath": "/repo",
		}),
	} as ToolSession;
}

describe("Rocky codebase profile tools", () => {
	it("sends bounded profile plan requests through Rocky", async () => {
		const calls: unknown[] = [];
		const fetch = async (input: TestFetchInput, init?: TestFetchInit) => {
			calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
			return new Response(JSON.stringify({ ok: true, plan_id: "cp_1", primary: [], deferred_clusters: [] }));
		};
		const tool = new CodebasePlanTool(createSession(fetch));

		const result = await tool.execute("plan", {
			profile: "bug_investigation",
			query: "turn repeats",
			scope: "workspace",
			max_primary_points: 4,
			include_tests: false,
			prefer_changed_files: true,
			allow_lexical_fallback: false,
			changed_files: ["src/agent-loop.ts"],
		});

		expect(calls).toEqual([
			{
				url: "http://rocky.test/v1/rocky/codebase/plan",
				body: {
					profile: "bug_investigation",
					query: "turn repeats",
					scope: { kind: "workspace", cwd: "/repo/packages/coding-agent", roots: ["/repo"] },
					budget: { max_primary_points: 4 },
					constraints: {
						include_tests: false,
						prefer_changed_files: true,
						allow_lexical_fallback: false,
						changed_files: ["src/agent-loop.ts"],
					},
				},
			},
		]);
		expect(result.content[0]).toEqual({
			type: "text",
			text: JSON.stringify({ ok: true, plan_id: "cp_1", primary: [], deferred_clusters: [] }),
		});
	});

	it("reads and validates plan points through Rocky", async () => {
		const calls: string[] = [];
		const fetch = async (input: TestFetchInput) => {
			calls.push(String(input));
			return new Response(JSON.stringify({ ok: true, points: [{ point_id: "pt_1", fresh: true }] }));
		};
		const session = createSession(fetch);

		await new CodebaseReadTool(session).execute("read", { plan_id: "cp_1", point_ids: ["pt_1"] });
		await new CodebaseValidateTool(session).execute("validate", { plan_id: "cp_1", point_ids: ["pt_1"] });

		expect(calls).toEqual([
			"http://rocky.test/v1/rocky/codebase/read",
			"http://rocky.test/v1/rocky/codebase/validate_points",
		]);
	});
});
