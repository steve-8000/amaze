import type { OAuthController, OAuthLoginCallbacks } from "./oauth/types";
import type { ProviderDefinition } from "./types";

const PROVIDER_ID = "gemma-12b";
const AUTH_URL = "https://docs.vllm.ai/en/latest/serving/openai_compatible_server.html";
const DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:8000/v1";
const DEFAULT_LOCAL_TOKEN = "gemma-12b-local";

export async function loginGemma12B(options: OAuthController): Promise<string> {
	if (!options.onPrompt) {
		throw new Error(`${PROVIDER_ID} login requires onPrompt callback`);
	}
	options.onAuth?.({
		url: AUTH_URL,
		instructions: `Paste your Gemma 12B OpenAI-compatible API key if your server requires auth. Leave empty for local no-auth mode (default base URL: ${DEFAULT_LOCAL_BASE_URL}; set GEMMA_12B_BASE_URL to customize).`,
	});
	const apiKey = await options.onPrompt({
		message: "Paste your Gemma 12B API key (optional for local no-auth)",
		placeholder: DEFAULT_LOCAL_TOKEN,
		allowEmpty: true,
	});
	if (options.signal?.aborted) {
		throw new Error("Login cancelled");
	}
	const trimmed = apiKey.trim();
	return trimmed || DEFAULT_LOCAL_TOKEN;
}

export const gemma12BProvider = {
	id: PROVIDER_ID,
	name: "Gemma 12B (Local OpenAI-compatible)",
	envKeys: "GEMMA_12B_API_KEY",
	login: (cb: OAuthLoginCallbacks) => loginGemma12B(cb),
} as const satisfies ProviderDefinition;
