찾은 항목만 정리합니다.

**amaze**
- `README.md`
  - 설치/시작: `pnpm install`, `cd packages/coding-agent && npm link`
  - config 경로: `$AMAZE_CONFIG → ./amaze.toml → ~/.config/amaze/amaze.toml → ~/.amaze/amaze.toml`
  - 에이전트/서브에이전트 모델·권한: `~/.amaze/agent/models.json`, `~/.amaze/agent/settings.json`
- `README.amaze.md`
  - config 경로: `$AMAZE_CONFIG → ./amaze.toml → ~/.config/amaze/amaze.toml → ~/.amaze/amaze.toml`
  - 서브에이전트: `vendor/pi-subagents`, `agent_run`
- `amaze.toml`
  - config 경로 주석: `$AMAZE_CONFIG -> ./amaze.toml -> ~/.config/amaze/amaze.toml -> ~/.amaze/amaze.toml`
  - 서브에이전트 섹션: `[agents]`
  - 기본값들: `enabled = false`, `provider = "local"`, `default = "local"`
  - LLM/임베딩 provider 예시: `provider = "ollama"`, `model = "nomic-embed-text"`
- `src/config.mjs` (Xenonite/rocky 연동)
  - config 파일: `~/.config/xenonite/xenonite.toml`
  - LLM provider URL/model defaults:
    - `ROCKY_LLM_URL` / `t.llm_url` / `"http://127.0.0.1:7777/v1"`
    - `ROCKY_LLM_MODEL` / `t.llm_model` / `"mlx-community/gemma-4-12B-it-qat-4bit"`
  - embedding defaults:
    - `ROCKY_EMBED_URL` / `t.embed_url` / `"http://127.0.0.1:7778/v1"`
    - `ROCKY_EMBED_MODEL` / `t.embed_model` / `"default"`

**xenonite**
- `README.md`
  - install/run: `npm run mcp`, `xenonite mcp`, `npm run start`
  - tool mode default: `minimal`
  - tool mode example: `XENONITE_MCP_TOOL_MODE=standard npm run mcp`
- `src/config.mjs`
  - config path: `XENONITE_CONFIG ?? ~/.config/xenonite/xenonite.toml`
  - LLM/embedding defaults:
    - `ROCKY_LLM_URL ?? ... ?? "http://127.0.0.1:7777/v1"`
    - `ROCKY_LLM_MODEL ?? ... ?? "mlx-community/gemma-4-12B-it-qat-4bit"`
    - `ROCKY_EMBED_URL ?? ... ?? "http://127.0.0.1:7778/v1"`
    - `ROCKY_EMBED_MODEL ?? ... ?? "default"`

**README에 적을 핵심 문자열**
- `~/.amaze/agent/models.json`
- `~/.amaze/agent/settings.json`
- `~/.config/amaze/amaze.toml`
- `~/.config/xenonite/xenonite.toml`
- `mlx-community/gemma-4-12B-it-qat-4bit`
- `nomic-embed-text`
- `provider = "ollama"`
- `provider = "local"`