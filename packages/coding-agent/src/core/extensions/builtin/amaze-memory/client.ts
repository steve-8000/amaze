// Client for the Xenonite service (unified memory + code engine). amaze itself
// holds no memory/skill logic or Python dependency; it calls Xenonite over HTTP.
export class XenoniteClient {
	private readonly base: string;

	constructor(port: number) {
		this.base = `http://127.0.0.1:${port}`;
	}

	private async post(path: string, body: unknown): Promise<unknown> {
		const res = await fetch(`${this.base}${path}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
		if (!res.ok) throw new Error(`hermes-bridge ${path} -> ${res.status}`);
		return res.json();
	}

	private async get(path: string): Promise<unknown> {
		const res = await fetch(`${this.base}${path}`);
		if (!res.ok) throw new Error(`hermes-bridge ${path} -> ${res.status}`);
		return res.json();
	}

	async isHealthy(): Promise<boolean> {
		try {
			await this.get("/health");
			return true;
		} catch {
			return false;
		}
	}

	async syncTurn(userContent: string, assistantContent: string, sessionId: string): Promise<void> {
		await this.post("/v1/memory/sync", { user_content: userContent, assistant_content: assistantContent, session_id: sessionId });
	}

	async prefetch(query: string, _sessionId: string): Promise<string> {
		const data = (await this.post("/v1/memory/recall", { query })) as { context?: string };
		return data.context ?? "";
	}

	async systemPromptBlock(): Promise<string> {
		const data = (await this.get("/v1/memory/system-prompt")) as { block?: string };
		return data.block ?? "";
	}

	async skillManage(args: Record<string, unknown>): Promise<string> {
		const data = (await this.post("/v1/skills/manage", args)) as { result?: string };
		return data.result ?? "";
	}

	async backgroundReview(messagesSnapshot: unknown[]): Promise<{ suggestion?: string }> {
		return (await this.post("/v1/review", { messages_snapshot: messagesSnapshot })) as { suggestion?: string };
	}
}
