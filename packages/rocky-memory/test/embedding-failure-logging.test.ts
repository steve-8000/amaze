import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { logger } from "@amaze/pi-utils";
import "./setup";
import {
	embed,
	resetEmbeddingProviderForTests,
	setLocalModelInitializerForTests,
} from "@amaze/pi-rocky-memory/core/embeddings";
import { withRockyMemoryRuntimeOptions } from "@amaze/pi-rocky-memory/core/runtime-options";

const ENV_KEYS = [
	"NODE_ENV",
	"BUN_ENV",
	"ROCKY_MEMORY_NO_EMBEDDINGS",
	"ROCKY_MEMORY_EMBEDDING_MODEL",
	"ROCKY_MEMORY_EMBEDDING_API_URL",
	"ROCKY_MEMORY_EMBEDDING_API_KEY",
	"OPENROUTER_BASE_URL",
	"OPENROUTER_API_KEY",
	"OPENAI_API_KEY",
] as const;

type EnvKey = (typeof ENV_KEYS)[number];

/** Force the local-fastembed path: not a test runtime, local model, no API config. */
async function withLocalModelEnv<T>(fn: () => Promise<T>): Promise<T> {
	const snapshot: Partial<Record<EnvKey, string>> = {};
	for (const key of ENV_KEYS) {
		const value = process.env[key];
		if (value !== undefined) snapshot[key] = value;
		delete process.env[key];
	}
	process.env.ROCKY_MEMORY_EMBEDDING_MODEL = "BAAI/bge-small-en-v1.5";
	resetEmbeddingProviderForTests();
	try {
		return await fn();
	} finally {
		for (const key of ENV_KEYS) {
			const value = snapshot[key];
			if (value === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = value;
			}
		}
		resetEmbeddingProviderForTests();
	}
}

afterEach(() => {
	resetEmbeddingProviderForTests();
});

describe("embedding failure logging (#2322)", () => {
	it("logs local model load failures at debug level with model context", async () => {
		const debugSpy = spyOn(logger, "debug").mockImplementation(() => {});
		const warnSpy = spyOn(logger, "warn").mockImplementation(() => {});
		try {
			await withLocalModelEnv(async () => {
				setLocalModelInitializerForTests(async () => {
					throw new Error("onnx init blew up");
				});

				expect(await embed(["hello"])).toBeNull();

				expect(debugSpy).toHaveBeenCalledWith(
					"rockyMemory: local embedding model failed to load",
					expect.objectContaining({
						model: expect.any(String),
						error: expect.stringContaining("onnx init blew up"),
					}),
				);
				expect(warnSpy).not.toHaveBeenCalledWith(
					"rockyMemory: local embedding model failed to load",
					expect.anything(),
				);
			});
		} finally {
			debugSpy.mockRestore();
			warnSpy.mockRestore();
		}
	});

	it("escalates the same failure to warn when runtime debug is enabled", async () => {
		const debugSpy = spyOn(logger, "debug").mockImplementation(() => {});
		const warnSpy = spyOn(logger, "warn").mockImplementation(() => {});
		try {
			await withLocalModelEnv(async () => {
				setLocalModelInitializerForTests(async () => {
					throw new Error("onnx init blew up again");
				});

				expect(await withRockyMemoryRuntimeOptions({ debug: true }, () => embed(["hello"]))).toBeNull();

				expect(warnSpy).toHaveBeenCalledWith(
					"rockyMemory: local embedding model failed to load",
					expect.objectContaining({ error: expect.stringContaining("onnx init blew up again") }),
				);
				expect(debugSpy).not.toHaveBeenCalledWith(
					"rockyMemory: local embedding model failed to load",
					expect.anything(),
				);
			});
		} finally {
			debugSpy.mockRestore();
			warnSpy.mockRestore();
		}
	});
});
