import type { AgentEvent, AgentMessage } from "@amaze/agent-core";
import type { Settings } from "../config/settings";
import type { AgentSession } from "../session/agent-session";
import type { MemoryBackend, MemoryBackendStartOptions } from "./types";

export type Mem0Memory = {
	id?: string;
	memory?: string;
	score?: number;
	metadata?: Record<string, unknown>;
};

type Mem0Response =
	| { results?: Mem0Memory[]; memories?: Mem0Memory[]; result?: unknown; count?: number }
	| Mem0Memory[]
	| Record<string, unknown>;

export type Mem0Config = {
	baseUrl: string;
	apiKey: string;
	userId: string;
	agentId: string;
	topK: number;
};

const PROMPT_MEMORY_LINE_CHAR_LIMIT = 1200;
const PROMPT_MEMORY_TOTAL_CHAR_LIMIT = 6000;

function textFromContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map(part => {
			if (typeof part === "string") return part;
			if (part && typeof part === "object" && "text" in part && typeof part.text === "string") return part.text;
			return "";
		})
		.filter(Boolean)
		.join("\n");
}

function textFromMessage(message: AgentMessage | { content?: unknown }): string {
	return textFromContent((message as { content?: unknown }).content).trim();
}

function unwrapMemories(response: Mem0Response): Mem0Memory[] {
	if (Array.isArray(response)) return response;
	if (!response || typeof response !== "object") return [];
	const shaped = response as { results?: unknown; memories?: unknown; result?: unknown };
	if (Array.isArray(shaped.results)) return shaped.results as Mem0Memory[];
	if (Array.isArray(shaped.memories)) return shaped.memories as Mem0Memory[];
	if (Array.isArray(shaped.result)) return shaped.result as Mem0Memory[];
	if (typeof shaped.result === "string") return [{ memory: shaped.result }];
	return [];
}

function truncatePromptMemoryLine(line: string): string {
	const trimmed = line.trim();
	if (trimmed.length <= PROMPT_MEMORY_LINE_CHAR_LIMIT) return trimmed;
	return `${trimmed.slice(0, PROMPT_MEMORY_LINE_CHAR_LIMIT).trimEnd()}… [truncated]`;
}

function formatLines(lines: string[]): string {
	if (lines.length === 0) return "";
	const body = lines.map(line => `- ${truncatePromptMemoryLine(line)}`).join("\n");
	if (body.length <= PROMPT_MEMORY_TOTAL_CHAR_LIMIT) return body;
	return `${body.slice(0, PROMPT_MEMORY_TOTAL_CHAR_LIMIT).trimEnd()}\n- [truncated]`;
}

function safeLimit(value: number): number {
	if (!Number.isFinite(value)) return 5;
	return Math.max(1, Math.min(50, Math.trunc(value)));
}

class Mem0RestClient {
	readonly #baseUrl: string;
	readonly #apiKey: string;

	constructor(config: Pick<Mem0Config, "baseUrl" | "apiKey">) {
		this.#baseUrl = config.baseUrl.replace(/\/+$/, "");
		this.#apiKey = config.apiKey;
	}

	async request(method: string, path: string, payload?: Record<string, unknown>): Promise<Mem0Response> {
		const response = await fetch(`${this.#baseUrl}${path}`, {
			method,
			headers: {
				"Content-Type": "application/json",
				"X-API-Key": this.#apiKey,
			},
			body: payload === undefined ? undefined : JSON.stringify(payload),
		});
		const raw = await response.text();
		if (!response.ok) {
			throw new Error(`Mem0 ${method} ${path} failed: ${response.status} ${raw}`);
		}
		if (!raw.trim()) return {};
		return JSON.parse(raw) as Mem0Response;
	}

	async add(content: string, config: Mem0Config, metadata: Record<string, unknown>, infer: boolean): Promise<void> {
		const normalized = content.trim();
		if (!normalized) return;
		if (await this.hasExactMemory(normalized, config)) return;
		await this.request("POST", "/memories", {
			messages: [{ role: "user", content: normalized }],
			user_id: config.userId,
			agent_id: config.agentId,
			metadata,
			infer,
		});
	}

	async list(config: Mem0Config): Promise<Mem0Memory[]> {
		const params = new URLSearchParams({ user_id: config.userId });
		const response = await this.request("GET", `/memories?${params.toString()}`);
		return unwrapMemories(response);
	}

	async search(query: string, config: Mem0Config): Promise<Mem0Memory[]> {
		const response = await this.request("POST", "/search", {
			query,
			filters: { user_id: config.userId },
			top_k: config.topK,
		});
		return unwrapMemories(response);
	}

	async addVerbatim(content: string, config: Mem0Config, metadata: Record<string, unknown>): Promise<void> {
		const normalized = content.trim();
		if (!normalized) return;
		if (await this.hasExactMemory(normalized, config)) return;
		await this.request("POST", "/memories", {
			messages: [{ role: "user", content: normalized }],
			user_id: config.userId,
			agent_id: config.agentId,
			metadata,
			infer: false,
		});
	}

	private async hasExactMemory(content: string, config: Mem0Config): Promise<boolean> {
		const normalized = content.trim();
		if (!normalized) return true;
		const memories = await this.list(config);
		return memories.some(memory => memory.memory?.trim() === normalized);
	}

	async clear(config: Mem0Config): Promise<void> {
		const memories = await this.list(config);
		for (const memory of memories) {
			if (memory.id) {
				await this.request("DELETE", `/memories/${encodeURIComponent(memory.id)}`);
			}
		}
	}
}

export const mem0Backend: MemoryBackend = {
	id: "mem0",

	async start(options: MemoryBackendStartOptions) {
		const config = readMem0Config(options.settings);
		if (!config) return;
		try {
			await clientFor(config).list(config);
		} catch (error) {
			console.debug("Mem0 memory backend startup failed", error);
		}
	},

	async buildDeveloperInstructions() {
		// Do not inject the full Mem0 profile into the stable base prompt. It can
		// grow without bound and every prompt rebuild pays for it. Current-turn
		// semantic recall still happens in beforeAgentStartPrompt via top_k search.
		return undefined;
	},

	async clear(_agentDir: string, _cwd: string, session?: AgentSession) {
		const config = session ? readMem0Config(session.settings) : undefined;
		if (!config) return;
		await clientFor(config).clear(config);
	},

	async enqueue(_agentDir: string, _cwd: string, session?: AgentSession) {
		const config = session ? readMem0Config(session.settings) : undefined;
		if (!config || !session) return;
		const messages = session.messages.slice(-12);
		const content = buildConversationCheckpoint(messages);
		await clientFor(config).add(
			content,
			config,
			{ amaze_memory_tier: "manual_checkpoint", session_id: session.sessionId },
			false,
		);
	},

	async beforeAgentStartPrompt(session: AgentSession, promptText: string) {
		const config = readMem0Config(session.settings);
		if (!config) return undefined;
		try {
			const memories = await mem0Search(session.settings, promptText);
			const body = formatLines(memories);
			if (!body) return undefined;
			return `# Mem0 Memory\n${body}`;
		} catch (error) {
			console.debug("Mem0 memory recall failed", error);
			return undefined;
		}
	},

	async preCompactionContext(messages: AgentMessage[], settings: Settings, session?: AgentSession) {
		const config = readMem0Config(settings);
		if (!config) return undefined;
		const checkpoint = buildConversationCheckpoint(messages.slice(-12));
		if (!checkpoint) return undefined;
		try {
			await clientFor(config).add(
				checkpoint,
				config,
				{ amaze_memory_tier: "compression_checkpoint", session_id: session?.sessionId },
				false,
			);
			return "Mem0 captured a pre-compaction checkpoint for this session.";
		} catch (error) {
			console.debug("Mem0 pre-compaction checkpoint failed", error);
			return undefined;
		}
	},

	async onTurnEnd(session: AgentSession, event: AgentEvent) {
		if (event.type !== "turn_end") return;
		const config = readMem0Config(session.settings);
		if (!config) return;
		const assistant = textFromMessage(event.message);
		const toolText = event.toolResults.map(textFromMessage).filter(Boolean).join("\n");
		const content = [assistant, toolText].filter(Boolean).join("\n\n");
		if (!content) return;
		try {
			await clientFor(config).add(
				content,
				config,
				{ amaze_memory_tier: "turn_sync", session_id: session.sessionId },
				false,
			);
		} catch (error) {
			console.debug("Mem0 turn sync failed", error);
		}
	},
};

export function readMem0Config(settings: Settings): Mem0Config | undefined {
	const baseUrl = settings.get("memory.mem0.baseUrl") || process.env.MEM0_BASE_URL;
	if (!baseUrl) return undefined;
	return {
		baseUrl,
		apiKey: settings.get("memory.mem0.apiKey") || process.env.MEM0_API_KEY || "local",
		userId: settings.get("memory.mem0.userId") || process.env.MEM0_USER_ID || "amaze-user",
		agentId: settings.get("memory.mem0.agentId") || process.env.MEM0_AGENT_ID || "amaze",
		topK: safeLimit(settings.get("memory.mem0.topK")),
	};
}

function clientFor(config: Mem0Config): Mem0RestClient {
	return new Mem0RestClient(config);
}

export async function mem0Profile(settings: Settings): Promise<string[]> {
	const config = readMem0Config(settings);
	if (!config) return [];
	const memories = await clientFor(config).list(config);
	return memories.map(memory => memory.memory?.trim()).filter((memory): memory is string => Boolean(memory));
}

export async function mem0Search(settings: Settings, query: string, topK?: number): Promise<string[]> {
	const config = readMem0Config(settings);
	if (!config || !query.trim()) return [];
	const memories = await clientFor({ ...config, topK: topK ? safeLimit(topK) : config.topK }).search(query, {
		...config,
		topK: topK ? safeLimit(topK) : config.topK,
	});
	return memories.map(memory => memory.memory?.trim()).filter((memory): memory is string => Boolean(memory));
}

export async function mem0Conclude(settings: Settings, conclusion: string): Promise<void> {
	const config = readMem0Config(settings);
	if (!config) throw new Error("Mem0 backend is not configured. Set memory.mem0.baseUrl or MEM0_BASE_URL.");
	await clientFor(config).addVerbatim(conclusion, config, { amaze_memory_tier: "explicit_conclusion" });
}

function buildConversationCheckpoint(messages: AgentMessage[]): string {
	const lines = messages
		.map(message => {
			const text = textFromMessage(message);
			if (!text) return "";
			return `${message.role}: ${text.slice(0, 1000)}`;
		})
		.filter(Boolean);
	return lines.length ? `Amaze memory checkpoint:\n${lines.join("\n")}` : "";
}
