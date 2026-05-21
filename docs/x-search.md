# X Search

Amaze includes two built-in tools for X/Twitter investigation through xAI's Responses API `x_search` tool:

- `x_search` — current X posts, account-scoped queries, and direct status URL lookups.
- `x_search_deep` — long-post reconstruction and chunked retrieval when exact post text matters.

Use the dedicated `researcher` subagent for X/Twitter investigation when possible; it is configured for xAI/Grok in this project.

## Credentials

Credential resolution:

1. Stored `xai-oauth` / xAI Grok OAuth credential from the agent credential store.
2. Stored `xai` provider credential.
3. `XAI_API_KEY` fallback.

Relevant environment variables:

| Variable | Default / behavior |
| --- | --- |
| `XAI_API_KEY` | API-key fallback when no usable stored OAuth/provider credential exists. |
| `AMAZE_X_SEARCH_BASE_URL` | Overrides xAI API base URL. Falls back to `XAI_BASE_URL`, then `https://api.x.ai/v1`. |
| `AMAZE_X_SEARCH_MODEL` | Search model; defaults to `grok-4.3`. |
| `AMAZE_X_SEARCH_TIMEOUT_MS` | Request timeout; defaults to `180000`. |
| `AMAZE_X_SEARCH_RETRIES` | Retry count; defaults to `2`. |
| `AMAZE_X_SEARCH_DEEP_OUTPUT_DIR` | Default output directory for `x_search_deep` file mode; defaults to `./x-search-deep-results`. |

## `x_search`

Parameters:

| Parameter | Purpose |
| --- | --- |
| `query` | X/Twitter query or direct status URL. |
| `allowed_x_handles` | Optional allow-list of up to 10 handles, with or without `@`. Cannot be combined with `excluded_x_handles`. |
| `excluded_x_handles` | Optional block-list of handles. Cannot be combined with `allowed_x_handles`. |
| `from_date` / `to_date` | Date filters accepted by xAI `x_search`. |
| `enable_image_understanding` | Ask xAI to reason over images where available. |
| `enable_video_understanding` | Ask xAI to reason over video where available. |
| `return_full_text` | Return complete original post text when possible instead of a summary. |

Guidelines:

- Prefer `allowed_x_handles` when an answer must come from specific accounts.
- Use a direct X status URL when investigating one post.
- Set `return_full_text` when quotes or exact wording matter.

## `x_search_deep`

`x_search_deep` extends `x_search` with chunk controls:

| Parameter | Default | Purpose |
| --- | --- | --- |
| `chunk_size` | `900` | Characters requested per chunk. Range: 200-2000. |
| `max_chunks` | `12` | Maximum chunks. Range: 1-50. |
| `overlap_chars` | `0` | Overlap between adjacent chunks. Range: 0-200. |
| `output_mode` | `file` | `file` or `inline`. |
| `output_path` | generated under `AMAZE_X_SEARCH_DEEP_OUTPUT_DIR` | Markdown file path when `output_mode=file`. |

Use `x_search_deep` when:

- `x_search` returns truncation markers.
- A long post/thread must be reconstructed exactly.
- You need file output for review or citation.

File paths resolve relative to the current working directory unless absolute.
