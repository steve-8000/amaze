export const LIVE_API_TESTS_FLAG = "AMAZE_ENABLE_LIVE_API_TESTS";
export const LOCAL_LLM_LIVE_TEST_FLAG = "AMAZE_ENABLE_LOCAL_LLM";
export const OPENROUTER_LIVE_TEST_FLAG = "AMAZE_ENABLE_OPENROUTER_LIVE";

const OAUTH_LIVE_TEST_FLAGS = {
	anthropic: "AMAZE_ENABLE_ANTHROPIC_OAUTH_LIVE",
	"github-copilot": "AMAZE_ENABLE_GITHUB_COPILOT_LIVE",
} as const;

export function isLiveApiTestEnabled(providerFlag: string): boolean {
	return process.env[LIVE_API_TESTS_FLAG] === "1" || process.env[providerFlag] === "1";
}

export function getLiveEnvApiKey(apiKeyEnvName: string, providerFlag: string): string | undefined {
	if (!isLiveApiTestEnabled(providerFlag)) return undefined;
	const apiKey = process.env[apiKeyEnvName]?.trim();
	return apiKey ? apiKey : undefined;
}

export function isOAuthLiveApiTestEnabled(provider: string): boolean {
	if (process.env[LIVE_API_TESTS_FLAG] === "1") return true;
	return process.env[getOAuthLiveTestFlag(provider) ?? ""] === "1";
}

function getOAuthLiveTestFlag(provider: string): string | undefined {
	return OAUTH_LIVE_TEST_FLAGS[provider as keyof typeof OAUTH_LIVE_TEST_FLAGS];
}
