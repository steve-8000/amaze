import { afterEach, describe, expect, it, mock } from "bun:test";
import { Settings } from "@amaze/coding-agent/config/settings";
import { mem0Backend } from "@amaze/coding-agent/memory-backend";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

function mem0Settings() {
	return Settings.isolated({
		"memory.backend": "mem0",
		"memory.mem0.baseUrl": "http://mem0.local",
		"memory.mem0.apiKey": "test-key",
		"memory.mem0.userId": "user-1",
		"memory.mem0.agentId": "amaze-test",
		"memory.mem0.topK": 3,
	});
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("mem0 memory backend", () => {
	it("injects semantic recall before the agent starts", async () => {
		const calls: Array<{ url: string; init?: RequestInit }> = [];
		globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
			calls.push({ url: String(url), init });
			return jsonResponse({ results: [{ memory: "Use local mem0 for durable recall." }] });
		}) as unknown as typeof fetch;

		const session = { settings: mem0Settings() };
		const prompt = await mem0Backend.beforeAgentStartPrompt?.(session as any, "How should memory work?");

		expect(prompt).toContain("# Mem0 Memory");
		expect(prompt).toContain("Use local mem0 for durable recall.");
		expect(calls[0]?.url).toBe("http://mem0.local/search");
		expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
			query: "How should memory work?",
			filters: { user_id: "user-1" },
			top_k: 3,
		});
		expect((calls[0]?.init?.headers as Record<string, string>)["X-API-Key"]).toBe("test-key");
	});

	it("caps semantic recall injected for a single turn", async () => {
		globalThis.fetch = mock(async () =>
			jsonResponse({
				results: Array.from({ length: 10 }, (_, index) => ({
					memory: `memory-${index} ${"x".repeat(2000)}`,
				})),
			}),
		) as unknown as typeof fetch;

		const session = { settings: mem0Settings() };
		const prompt = await mem0Backend.beforeAgentStartPrompt?.(session as any, "Need bounded recall.");

		expect(prompt).toContain("# Mem0 Memory");
		expect(prompt!.length).toBeLessThanOrEqual(6030);
		expect(prompt).toContain("[truncated]");
	});

	it("does not inject the full profile into the stable base prompt", async () => {
		const calls: Array<{ url: string; init?: RequestInit }> = [];
		globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
			calls.push({ url: String(url), init });
			return jsonResponse({ results: [{ memory: "Large historical memory that should stay out of STABLE_CORE." }] });
		}) as unknown as typeof fetch;

		const prompt = await mem0Backend.buildDeveloperInstructions("/agent", mem0Settings());

		expect(prompt).toBeUndefined();
		expect(calls).toHaveLength(0);
	});

	it("syncs assistant turns into mem0", async () => {
		const calls: Array<{ url: string; init?: RequestInit }> = [];
		globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
			calls.push({ url: String(url), init });
			return jsonResponse({ results: [] });
		}) as unknown as typeof fetch;

		const session = { settings: mem0Settings(), sessionId: "session-1" };
		await mem0Backend.onTurnEnd?.(
			session as any,
			{
				type: "turn_end",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "Remember that Amaze mirrors Hermes memory." }],
				},
				toolResults: [],
			} as any,
		);

		const writeCall = calls.find(call => call.url === "http://mem0.local/memories");
		expect(writeCall).toBeDefined();
		const payload = JSON.parse(String(writeCall?.init?.body));
		expect(payload.messages[0].content).toContain("Amaze mirrors Hermes memory");
		expect(payload.user_id).toBe("user-1");
		expect(payload.agent_id).toBe("amaze-test");
		expect(payload.metadata).toEqual({ amaze_memory_tier: "turn_sync", session_id: "session-1" });
		expect(payload.infer).toBe(false);
	});

	it("skips exact duplicate turn sync writes", async () => {
		const calls: Array<{ url: string; init?: RequestInit }> = [];
		globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
			calls.push({ url: String(url), init });
			if (String(url).includes("/memories?")) {
				return jsonResponse({ results: [{ memory: "Already stored durable fact." }] });
			}
			return jsonResponse({ results: [] });
		}) as unknown as typeof fetch;

		const session = { settings: mem0Settings(), sessionId: "session-dup" };
		await mem0Backend.onTurnEnd?.(
			session as any,
			{
				type: "turn_end",
				message: { role: "assistant", content: "Already stored durable fact." },
				toolResults: [],
			} as any,
		);

		expect(calls.map(call => call.url)).toEqual(["http://mem0.local/memories?user_id=user-1"]);
	});

	it("captures pre-compaction checkpoints", async () => {
		const calls: Array<{ url: string; init?: RequestInit }> = [];
		globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
			calls.push({ url: String(url), init });
			return jsonResponse({ results: [] });
		}) as unknown as typeof fetch;

		const session = { settings: mem0Settings(), sessionId: "session-2" };
		const result = await mem0Backend.preCompactionContext?.(
			[{ role: "user", content: "Compression should preserve durable facts.", timestamp: Date.now() }],
			mem0Settings(),
			session as any,
		);

		expect(result).toContain("pre-compaction checkpoint");
		const writeCall = calls.find(call => call.url === "http://mem0.local/memories");
		expect(writeCall).toBeDefined();
		const payload = JSON.parse(String(writeCall?.init?.body));
		expect(payload.messages[0].content).toContain("Compression should preserve durable facts.");
		expect(payload.metadata).toEqual({ amaze_memory_tier: "compression_checkpoint", session_id: "session-2" });
	});
});
