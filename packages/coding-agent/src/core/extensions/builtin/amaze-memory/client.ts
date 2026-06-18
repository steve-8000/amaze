// Client for the Xenonite MCP service. amaze itself holds no durable memory
// engine; it calls Xenonite through the same HTTP MCP JSON-RPC contract used by
// external clients.
export interface MemoryItem {
	id?: string;
	text: string;
	score?: number;
	source?: "semantic" | "recent" | "sync" | "manual" | string;
	ts?: number;
	meta?: Record<string, unknown>;
}

export interface MemoryRecallResult {
	ok?: boolean;
	query?: string;
	context?: string;
	items?: MemoryItem[];
	totalCandidates?: number;
	semanticCount?: number;
	recentCount?: number;
}

export interface MemoryStoreResult {
	ok?: boolean;
	added?: number;
	items?: MemoryItem[];
	context?: string;
	skipped?: string[];
	error?: string;
	action?: "added" | "updated" | "rejected" | string;
	reason?: string;
	topicKey?: string;
}

export interface MemoryNamespaceOptions {
	namespace?: string;
	pathId?: string;
	memoryPath?: string;
}

function memoryPayloadScope(sessionId: string, options: MemoryNamespaceOptions = {}): Record<string, unknown> {
	if (!options.namespace) return { session_id: sessionId };
	return {
		session_id: options.namespace,
		namespace: options.namespace,
		memory_scope: "path",
		path_id: options.pathId,
		memory_path: options.memoryPath,
	};
}

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
		if (!res.ok) throw new Error(`xenonite-mcp ${path} -> ${res.status}`);
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

	private async mcpTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
		const data = (await this.post("/v1/mcp", {
			jsonrpc: "2.0",
			id: `amaze-memory-${Date.now()}`,
			method: "tools/call",
			params: { name, arguments: args },
		})) as {
			result?: { content?: Array<{ type?: string; text?: string }> };
			error?: { message?: string };
		};
		if (data.error) throw new Error(data.error.message ?? "Xenonite MCP error");
		const text = data.result?.content?.find((item) => item.type === "text")?.text ?? "{}";
		return JSON.parse(text) as T;
	}

	async syncTurn(_userContent: string, _assistantContent: string, _sessionId: string, _options: MemoryNamespaceOptions = {}): Promise<MemoryStoreResult> {
		return { ok: true, added: 0, items: [], skipped: [], reason: "auto_sync_disabled" };
	}

	async prefetch(query: string, sessionId: string, options: { topK?: number } & MemoryNamespaceOptions = {}): Promise<MemoryRecallResult> {
		return await this.mcpTool<MemoryRecallResult>("xenonite_memory_recall", {
			query,
			...memoryPayloadScope(sessionId, options),
			top_k: options.topK,
		});
	}

	async store(text: string, sessionId: string, options: MemoryNamespaceOptions & { source?: string } = {}): Promise<MemoryStoreResult> {
		return await this.mcpTool<MemoryStoreResult>("xenonite_memory_store", { text, source: options.source, ...memoryPayloadScope(sessionId, options) });
	}

	async systemPromptBlock(): Promise<string> {
		return "";
	}
}
