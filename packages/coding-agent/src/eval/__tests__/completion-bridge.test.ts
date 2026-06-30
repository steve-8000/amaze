import { afterAll, afterEach, describe, expect, it, vi } from "bun:test";
import * as path from "node:path";
import type { Api, AssistantMessage, Model } from "@steve-z8k/pi-ai";
import * as ai from "@steve-z8k/pi-ai";
import { Effort } from "@steve-z8k/pi-ai";
import { TempDir } from "@steve-z8k/pi-utils";
import { $ } from "bun";
import type { ModelRegistry } from "../../config/model-registry";
import { Settings } from "../../config/settings";
import type { ToolSession } from "../../tools";
import { ToolError } from "../../tools/tool-errors";
import { EVAL_TIMEOUT_PAUSE_OP, EVAL_TIMEOUT_RESUME_OP } from "../bridge-timeout";
import { runEvalCompletion } from "../completion-bridge";
import { IdleTimeout } from "../idle-timeout";
import { disposeAllVmContexts } from "../js/context-manager";
import { executeJs } from "../js/executor";
import { disposeAllKernelSessions, type PythonResult } from "../py/executor";

function makeModel(provider: string, id: string, extra: Partial<Model<Api>> = {}): Model<Api> {
	return {
		id,
		name: id,
		api: "openai-responses",
		provider,
		baseUrl: "https://example.test/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 1 },
		contextWindow: 128000,
		maxTokens: 4096,
		...extra,
	} as Model<Api>;
}

const FLASH = makeModel("p", "flash");
const DEEP = makeModel("p", "deep");
const REASONING_DEEP = makeModel("p", "deep", {
	api: "anthropic-messages",
	reasoning: true,
	thinking: { efforts: [Effort.Low, Effort.Medium, Effort.High], mode: "anthropic-adaptive" },
});

interface SessionOptions {
	available?: Model<Api>[];
	apiKey?: string | null;
	activeModel?: string;
	roles?: Partial<Record<"flash" | "spark" | "deep" | "ultra", string>>;
}

function makeSession(opts: SessionOptions = {}): ToolSession {
	const settings = Settings.isolated({ "async.enabled": false, "task.isolation.mode": "none" });
	const roles = opts.roles ?? { flash: "p/flash", spark: "p/flash", deep: "p/deep", ultra: "p/deep" };
	for (const role in roles) {
		const value = roles[role as keyof typeof roles];
		if (value) settings.setModelRole(role, value);
	}
	const modelRegistry = {
		getAvailable: () => opts.available ?? [FLASH, DEEP],
		getApiKey: async () => (opts.apiKey === undefined ? "test-key" : opts.apiKey),
		resolver: () => async () => (opts.apiKey === undefined ? "test-key" : opts.apiKey),
	} as unknown as ModelRegistry;
	return {
		settings,
		modelRegistry,
		getActiveModelString: () => opts.activeModel ?? "p/flash",
	} as unknown as ToolSession;
}

function assistant(opts: {
	text?: string;
	toolCall?: { name: string; arguments: Record<string, unknown> };
	stopReason?: AssistantMessage["stopReason"];
	errorMessage?: string;
}): AssistantMessage {
	const content: AssistantMessage["content"] = [];
	if (opts.text) content.push({ type: "text", text: opts.text });
	if (opts.toolCall) {
		content.push({ type: "toolCall", id: "tc-1", name: opts.toolCall.name, arguments: opts.toolCall.arguments });
	}
	return {
		role: "assistant",
		content,
		api: "openai-responses",
		provider: "p",
		model: "flash",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: opts.stopReason ?? "stop",
		errorMessage: opts.errorMessage,
		timestamp: Date.now(),
	};
}

async function runPythonCompletionInSubprocess(options: {
	structured: boolean;
	tempDir: TempDir;
}): Promise<PythonResult> {
	const repoRoot = path.resolve(import.meta.dir, "../../../..");
	const scriptPath = path.join(options.tempDir.path(), "run-python-completion.ts");
	const resultPath = path.join(options.tempDir.path(), "python-completion-result.json");
	const aiPath = path.resolve(import.meta.dir, "../../../../ai/src/index.ts");
	const executorPath = path.resolve(import.meta.dir, "../py/executor.ts");
	const settingsPath = path.resolve(import.meta.dir, "../../config/settings.ts");
	const code = options.structured
		? 'import json\nprint(json.dumps(completion("hi", schema={"type": "object"})))'
		: 'print(completion("hi", model="flash"))';
	const responseContent = options.structured
		? '[{ type: "toolCall", id: "tc-1", name: "respond", arguments: { ok: true } }]'
		: '[{ type: "text", text: "hello from python" }]';
	await Bun.write(
		scriptPath,
		`
import { vi } from "bun:test";
import * as ai from ${JSON.stringify(aiPath)};
import { executePython } from ${JSON.stringify(executorPath)};
import { Settings } from ${JSON.stringify(settingsPath)};

const FLASH = {
	id: "flash",
	name: "flash",
	api: "openai-responses",
	provider: "p",
	baseUrl: "https://example.test/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 1 },
	contextWindow: 128000,
	maxTokens: 4096,
};
const settings = Settings.isolated({ "async.enabled": false, "task.isolation.mode": "none" });
settings.setModelRole("flash", "p/flash");
settings.setModelRole("deep", "p/deep");
const session = {
	settings,
	modelRegistry: {
		getAvailable: () => [FLASH],
		getApiKey: async () => "test-key",
		resolver: () => async () => "test-key",
	},
	getActiveModelString: () => "p/flash",
};
vi.spyOn(ai, "completeSimple").mockResolvedValue({
	role: "assistant",
	api: "openai-responses",
	provider: "p",
	model: "flash",
	stopReason: "stop",
	content: ${responseContent},
});
const result = await executePython(${JSON.stringify(code)}, {
	cwd: ${JSON.stringify(options.tempDir.path())},
	sessionId: ${JSON.stringify(`py-completion:${options.structured ? "struct" : "plain"}`)},
	sessionFile: ${JSON.stringify(path.join(options.tempDir.path(), "session.jsonl"))},
	toolSession: session,
	kernelMode: "per-call",
});
await Bun.write(${JSON.stringify(resultPath)}, JSON.stringify(result));
process.exit(0);
`,
	);
	const child = await $`bun ${scriptPath}`.cwd(repoRoot).quiet().nothrow();
	const stdout = child.stdout.toString();
	const stderr = child.stderr.toString();
	if (child.exitCode !== 0)
		throw new Error(stderr || stdout || `Python completion subprocess exited with ${child.exitCode}`);
	return (await Bun.file(resultPath).json()) as PythonResult;
}

describe("runEvalCompletion", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("resolves each tier to its expected model role alias", async () => {
		const spy = vi.spyOn(ai, "completeSimple").mockResolvedValue(assistant({ text: "ok" }));
		const session = makeSession();

		await runEvalCompletion({ prompt: "q", model: "flash" }, { session });
		await runEvalCompletion({ prompt: "q", model: "spark" }, { session });
		await runEvalCompletion({ prompt: "q", model: "deep" }, { session });
		await runEvalCompletion({ prompt: "q", model: "ultra" }, { session });

		const resolved = spy.mock.calls.map(call => {
			const model = call[0] as Model<Api>;
			return `${model.provider}/${model.id}`;
		});
		expect(resolved).toEqual(["p/flash", "p/flash", "p/deep", "p/deep"]);
	});

	it("prefers the session active model for the flash lane, falling back to pi/flash", async () => {
		const spy = vi.spyOn(ai, "completeSimple").mockResolvedValue(assistant({ text: "ok" }));
		const session = makeSession({ available: [FLASH, DEEP], activeModel: "p/deep" });

		await runEvalCompletion({ prompt: "q", model: "flash" }, { session });

		const model = spy.mock.calls[0]?.[0] as Model<Api>;
		expect(`${model.provider}/${model.id}`).toBe("p/deep");
	});

	it("returns the completion text in plain mode", async () => {
		vi.spyOn(ai, "completeSimple").mockResolvedValue(assistant({ text: "the answer" }));
		const result = await runEvalCompletion({ prompt: "q", model: "flash" }, { session: makeSession() });
		expect(result.text).toBe("the answer");
		expect(result.details).toEqual({ model: "p/flash", tier: "flash", structured: false });
	});

	it("supplies a non-empty systemPrompt when system is omitted (codex 'Instructions are required' guard)", async () => {
		// The openai-codex Responses transformer drops `instructions` when no
		// system prompt is provided, and the remote endpoint then 400s with
		// "Instructions are required". runEvalCompletion must always carry a non-empty
		// systemPrompt so `completion("…")` without a `system` argument works.
		const spy = vi.spyOn(ai, "completeSimple").mockResolvedValue(assistant({ text: "ok" }));
		await runEvalCompletion({ prompt: "q", model: "flash" }, { session: makeSession() });
		const ctx = spy.mock.calls[0]?.[1] as { systemPrompt?: string[] };
		expect(ctx.systemPrompt).toBeDefined();
		expect(ctx.systemPrompt?.length).toBeGreaterThan(0);
		expect(ctx.systemPrompt?.[0]).toMatch(/.+/);
	});

	it("honors an explicit system prompt instead of overriding it", async () => {
		const spy = vi.spyOn(ai, "completeSimple").mockResolvedValue(assistant({ text: "ok" }));
		await runEvalCompletion({ prompt: "q", model: "flash", system: "Be terse." }, { session: makeSession() });
		const ctx = spy.mock.calls[0]?.[1] as { systemPrompt?: string[] };
		expect(ctx.systemPrompt).toEqual(["Be terse."]);
	});

	it("forces a respond tool call and returns its arguments in structured mode", async () => {
		const spy = vi
			.spyOn(ai, "completeSimple")
			.mockResolvedValue(assistant({ toolCall: { name: "respond", arguments: { answer: 42 } } }));
		const result = await runEvalCompletion(
			{ prompt: "q", model: "flash", schema: { type: "object", properties: { answer: { type: "number" } } } },
			{ session: makeSession() },
		);

		expect(JSON.parse(result.text)).toEqual({ answer: 42 });
		expect(result.details.structured).toBe(true);

		const ctx = spy.mock.calls[0]?.[1] as { tools?: Array<{ name: string }> };
		const opts = spy.mock.calls[0]?.[2] as { toolChoice?: unknown };
		expect(ctx.tools?.[0]?.name).toBe("respond");
		expect(opts.toolChoice).toEqual({ type: "tool", name: "respond" });
	});

	it("falls back to JSON embedded in text when the model skips the respond tool", async () => {
		vi.spyOn(ai, "completeSimple").mockResolvedValue(assistant({ text: 'here: {"answer": 7}' }));
		const result = await runEvalCompletion(
			{ prompt: "q", model: "flash", schema: { type: "object" } },
			{ session: makeSession() },
		);
		expect(JSON.parse(result.text)).toEqual({ answer: 7 });
	});

	it("requests reasoning only for the deep and ultra lanes on a reasoning-capable model", async () => {
		const spy = vi.spyOn(ai, "completeSimple").mockResolvedValue(assistant({ text: "ok" }));
		const session = makeSession({ available: [FLASH, REASONING_DEEP] });

		await runEvalCompletion({ prompt: "q", model: "flash" }, { session });
		await runEvalCompletion({ prompt: "q", model: "deep" }, { session });
		await runEvalCompletion({ prompt: "q", model: "ultra" }, { session });

		const flashOpts = spy.mock.calls[0]?.[2] as { reasoning?: unknown };
		const deepOpts = spy.mock.calls[1]?.[2] as { reasoning?: unknown };
		const ultraOpts = spy.mock.calls[2]?.[2] as { reasoning?: unknown };
		expect(flashOpts.reasoning).toBeUndefined();
		expect(deepOpts.reasoning).toBe(Effort.High);
		expect(ultraOpts.reasoning).toBe(Effort.High);
	});

	it("does not request reasoning for the deep lane on a non-reasoning model", async () => {
		const spy = vi.spyOn(ai, "completeSimple").mockResolvedValue(assistant({ text: "ok" }));
		const result = await runEvalCompletion({ prompt: "q", model: "deep" }, { session: makeSession() });
		expect(result.text).toBe("ok");
		const opts = spy.mock.calls[0]?.[2] as { reasoning?: unknown };
		expect(opts.reasoning).toBeUndefined();
	});

	it("throws ToolError on invalid arguments", async () => {
		await expect(runEvalCompletion({ prompt: "" }, { session: makeSession() })).rejects.toBeInstanceOf(ToolError);
		await expect(
			runEvalCompletion({ prompt: "q", model: "huge" }, { session: makeSession() }),
		).rejects.toBeInstanceOf(ToolError);
	});

	it("throws ToolError when no model resolves for the tier", async () => {
		const session = makeSession({ available: [DEEP], roles: { flash: "missing/model" } });
		await expect(runEvalCompletion({ prompt: "q", model: "flash" }, { session })).rejects.toBeInstanceOf(ToolError);
	});

	it("throws ToolError when the resolved model has no API key", async () => {
		const session = makeSession({ apiKey: null });
		await expect(runEvalCompletion({ prompt: "q", model: "flash" }, { session })).rejects.toBeInstanceOf(ToolError);
	});

	it("maps error and aborted stop reasons to ToolError", async () => {
		vi.spyOn(ai, "completeSimple").mockResolvedValueOnce(assistant({ stopReason: "error", errorMessage: "boom" }));
		await expect(runEvalCompletion({ prompt: "q", model: "flash" }, { session: makeSession() })).rejects.toThrow(
			"boom",
		);

		vi.spyOn(ai, "completeSimple").mockResolvedValueOnce(assistant({ stopReason: "aborted" }));
		await expect(
			runEvalCompletion({ prompt: "q", model: "flash" }, { session: makeSession() }),
		).rejects.toBeInstanceOf(ToolError);
	});

	it("throws ToolError when plain mode produces no text", async () => {
		vi.spyOn(ai, "completeSimple").mockResolvedValue(assistant({ text: "" }));
		await expect(
			runEvalCompletion({ prompt: "q", model: "flash" }, { session: makeSession() }),
		).rejects.toBeInstanceOf(ToolError);
	});

	it("pauses the idle watchdog while a deep completion() request is in flight", async () => {
		// A oneshot completion emits no status until it returns; delegated model
		// time must be invisible to the eval timeout budget.
		vi.spyOn(ai, "completeSimple").mockImplementation(async () => {
			await Bun.sleep(200);
			return assistant({ text: "the answer" });
		});

		const ops: string[] = [];
		using idle = new IdleTimeout(60);
		const result = await runEvalCompletion(
			{ prompt: "q", model: "deep" },
			{
				session: makeSession(),
				signal: idle.signal,
				emitStatus: event => {
					ops.push(event.op);
					if (event.op === EVAL_TIMEOUT_PAUSE_OP) idle.pause();
					if (event.op === EVAL_TIMEOUT_RESUME_OP) idle.resume();
				},
			},
		);

		expect(result.text).toBe("the answer");
		expect(ops).toEqual([EVAL_TIMEOUT_PAUSE_OP, EVAL_TIMEOUT_RESUME_OP, "completion"]);
		expect(idle.signal.aborted).toBe(false);
	});
});

describe("completion() through eval runtimes", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	afterAll(async () => {
		await disposeAllVmContexts();
		await disposeAllKernelSessions();
	});

	it("exposes completion() in the JavaScript runtime", async () => {
		using tempDir = TempDir.createSync("@amaze-eval-completion-js-");
		const sessionFile = path.join(tempDir.path(), "session.jsonl");
		const sessionId = `js-completion:${crypto.randomUUID()}`;
		vi.spyOn(ai, "completeSimple").mockResolvedValue(assistant({ text: "hello from flash" }));

		const result = await executeJs('return await completion("hi", { model: "flash" });', {
			cwd: tempDir.path(),
			sessionId,
			session: makeSession(),
			sessionFile,
		});

		expect(result.exitCode).toBe(0);
		expect(result.output.trim()).toBe("hello from flash");
	});

	it("parses structured completion() output in the JavaScript runtime", async () => {
		using tempDir = TempDir.createSync("@amaze-eval-completion-js-struct-");
		const sessionFile = path.join(tempDir.path(), "session.jsonl");
		const sessionId = `js-completion-struct:${crypto.randomUUID()}`;
		vi.spyOn(ai, "completeSimple").mockResolvedValue(
			assistant({ toolCall: { name: "respond", arguments: { ok: true, n: 3 } } }),
		);

		const result = await executeJs(
			'const r = await completion("hi", { schema: { type: "object" } }); return JSON.stringify(r);',
			{ cwd: tempDir.path(), sessionId, session: makeSession(), sessionFile },
		);

		expect(result.exitCode).toBe(0);
		expect(JSON.parse(result.output.trim())).toEqual({ ok: true, n: 3 });
	});

	it("exposes completion() in the Python runtime", async () => {
		const tempDir = TempDir.createSync("@amaze-eval-completion-py-");
		try {
			const result = await runPythonCompletionInSubprocess({ structured: false, tempDir });
			expect(result.exitCode).toBe(0);
			expect(result.output.trim()).toBe("hello from python");
		} finally {
			tempDir.removeSync();
		}
	});

	it("parses structured completion() output in the Python runtime", async () => {
		const tempDir = TempDir.createSync("@amaze-eval-completion-py-struct-");
		try {
			const result = await runPythonCompletionInSubprocess({ structured: true, tempDir });
			expect(result.exitCode).toBe(0);
			expect(JSON.parse(result.output.trim())).toEqual({ ok: true });
		} finally {
			tempDir.removeSync();
		}
	});
});
