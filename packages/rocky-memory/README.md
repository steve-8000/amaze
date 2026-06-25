# @amaze/pi-rocky-memory

Local SQLite memory engine for Amaze Agent agents.

This package is the Bun/TypeScript port of the RockyMemory memory engine. It provides:

- `RockyMemory`, a small facade for remember/recall/stats/sleep workflows.
- `BeamMemory`, the lower-level working/episodic memory engine.
- MCP tool definitions and a dispatcher for host integrations.
- Optional local ONNX embeddings through `fastembed` and optional OpenAI-compatible embedding/LLM endpoints.

The package does not bundle or download a local GGUF LLM. LLM paths are host-backend or OpenAI-compatible remote only; when no LLM is configured, deterministic heuristic paths are used.

## Basic use

```ts
import { RockyMemory } from "@amaze/pi-rocky-memory";

const memory = new RockyMemory({ dbPath: "./rocky-memory.db", bank: "project" });
const id = memory.remember("The deployment target is stable-cluster.", {
	source: "notes",
	importance: 0.8,
	veracity: "true",
});

const results = memory.recall("deployment target", 5);
console.log(id, results[0]?.content);

memory.close();
```

## Configuration

`RockyMemory` accepts LLM and embedding options directly. `ROCKY_MEMORY_*` environment variables remain fallbacks/defaults when the matching constructor option is omitted.

```ts
import { RockyMemory } from "@amaze/pi-rocky-memory";
import type { Model } from "@amaze/pi-ai";

const ftsOnly = new RockyMemory({ noEmbeddings: true });

const remoteEmbeddings = new RockyMemory({
	embeddingModel: "text-embedding-3-small",
	embeddingApiUrl: "https://api.openai.com/v1",
	embeddingApiKey: process.env.OPENAI_API_KEY,
});

const remoteLlm = new RockyMemory({
	llm: {
		baseUrl: "https://api.openai.com/v1",
		apiKey: process.env.OPENAI_API_KEY,
		model: "gpt-4.1-mini",
	},
	// Equivalent aliases: llmBaseUrl, llmApiKey, llmModel.
});

declare const smolModel: Model;
const piAiLlm = new RockyMemory({ llm: smolModel });
const dynamicLlm = new RockyMemory({
	llm: async (prompt, opts) => {
		const token = await getFreshOauthToken();
		return await completeWithPiAi(prompt, {
			token,
			maxTokens: opts?.maxTokens,
			temperature: opts?.temperature,
		});
	},
});
```

### Banks and host scoping

`RockyMemory` itself exposes banks directly through constructor options such as `bank`; it does not hard-code coding-agent project scoping.

The Amaze Agent coding-agent wrapper adds `rockyMemory.scoping` on top of those constructor options:

- `global`: one shared bank
- `per-project`: isolated project memory
- `per-project-tagged`: project-local writes plus global recall visibility

In `per-project-tagged`, the wrapper is responsible for combining project-local retention with global recall visibility. The package still just exposes banks plus constructor-level LLM and embedding options.

Common environment fallbacks:

- `ROCKY_MEMORY_DATA_DIR` / `ROCKY_MEMORY_DB_PATH`: default storage location.
- `ROCKY_MEMORY_NO_EMBEDDINGS=1`: force FTS-only recall.
- `ROCKY_MEMORY_EMBEDDING_MODEL`: defaults to `BAAI/bge-small-en-v1.5`.
- `ROCKY_MEMORY_EMBEDDING_API_URL` and `ROCKY_MEMORY_EMBEDDING_API_KEY`: OpenAI-compatible embedding endpoint.
- `ROCKY_MEMORY_LLM_ENABLED=1`, `ROCKY_MEMORY_LLM_BASE_URL`, `ROCKY_MEMORY_LLM_API_KEY`, `ROCKY_MEMORY_LLM_MODEL`: OpenAI-compatible LLM endpoint.

Local embeddings use the `fastembed` npm package. Its default `BGESmallENV15` model is 384-dimensional and uses the package's CLS pooling plus vector normalization path. Local GGUF LLMs are not available in this package.

## Commands

```sh
rockyMemory remember "Use stable-cluster for production deploys"
rockyMemory recall "production deploy target"
rockyMemory stats
rockyMemory sleep
```

## Tests

```sh
bun --cwd packages/rocky-memory test
bun --cwd packages/rocky-memory run check
```
