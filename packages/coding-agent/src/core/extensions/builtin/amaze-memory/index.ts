import type { AgentMessage } from "@steve-8000/amaze-agent-core";
import { Text } from "@steve-8000/amaze-tui";
import * as fs from "node:fs";
import { Type } from "typebox";
import { loadAmazeConfig } from "../../../../amaze/config.ts";
import { BoxWrapper } from "../../../../tui/box-wrapper.ts";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "../../types.ts";
import { type MemoryItem, type MemoryNamespaceOptions, type MemoryRecallResult, type MemoryStoreResult, XenoniteClient } from "./client.ts";

const PATH_MEMORY_PACKET_ENV = "PI_SUBAGENT_PATH_MEMORY_PACKET";

function rawRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function pathMemoryNamespaceOptions(): MemoryNamespaceOptions {
	const packetPath = process.env[PATH_MEMORY_PACKET_ENV]?.trim();
	if (!packetPath) return {};
	try {
		const packet = fs.readFileSync(packetPath, "utf-8");
		const match = packet.match(/```json\r?\n([\s\S]*?)\r?\n```/);
		if (!match) return {};
		const parsed = JSON.parse(match[1]!) as unknown;
		const root = rawRecord(parsed);
		const scope = rawRecord(root.memory_scope ?? root.memoryScope ?? root.scope);
		const namespace = typeof scope.xenonite_namespace === "string" ? scope.xenonite_namespace.trim() : "";
		if (!namespace) return {};
		return {
			namespace,
			pathId: typeof scope.path_id === "string" ? scope.path_id : undefined,
			memoryPath: typeof scope.memory_path === "string" ? scope.memory_path : undefined,
		};
	} catch {
		return {};
	}
}

function configBool(value: unknown, fallback = false): boolean {
	if (value === undefined) return fallback;
	if (typeof value === "string") return ["1", "true", "yes", "on"].includes(value.toLowerCase());
	return Boolean(value);
}

function normalizedMemoryText(value: string): string {
	return value
		.toLowerCase()
		.replace(/[`*_>#|()[\]{}"'.,;:!?]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function memoryTokens(value: string): Set<string> {
	const stopWords = new Set(["the", "and", "for", "that", "with", "when", "this", "user", "assistant"]);
	return new Set(
		normalizedMemoryText(value)
			.split(" ")
			.filter((token) => token.length >= 4 && !stopWords.has(token)),
	);
}

function tokenOverlapScore(left: string, right: string): number {
	const leftTokens = memoryTokens(left);
	const rightTokens = memoryTokens(right);
	if (!leftTokens.size || !rightTokens.size) return 0;
	let intersection = 0;
	for (const token of leftTokens) {
		if (rightTokens.has(token)) intersection++;
	}
	return intersection / Math.min(leftTokens.size, rightTokens.size);
}

function localMemoryRejectionReason(text: string): string | undefined {
	const trimmed = text.trim();
	if (trimmed.length < 20) return "Memory was not stored because it is too short to be a standalone durable fact.";
	if (/memory candidate/i.test(trimmed)) {
		return "Memory was not stored because suggested candidate wrappers should not be saved verbatim; store only a canonical durable fact.";
	}
	const transientPatterns = [
		/\b(the user|user|assistant)\s+(is|was)\s+(concerned|worried|focused|testing|currently)\b/i,
		/\b(current task|current prompt|active goal|pursuing goal|remaining tasks|usage so far|tokens used|time spent)\b/i,
		/\b(currently|right now|today|this turn|this session|temporary|transient|untracked)\b/i,
		/(사용자|유저).*(우려|걱정|집중|테스트|현재)/,
		/(현재|이번|임시|일시적|남은 작업|활성 목표|토큰 사용|소요 시간)/,
	];
	if (transientPatterns.some((pattern) => pattern.test(trimmed))) {
		return "Memory was not stored because it looks like transient state, emotion, or task status rather than a durable fact.";
	}
	return undefined;
}

function sourceRejectionReason(source: unknown): string | undefined {
	if (source === "direct_user_request" || source === "verified_durable_fact") return undefined;
	return "Memory was not stored because mem_store requires source='direct_user_request' or source='verified_durable_fact'.";
}

function duplicateMemoryText(text: string, existing: MemoryItem[] | undefined): string | undefined {
	const normalized = normalizedMemoryText(text);
	if (!normalized) return undefined;
	return existing?.find((item) => {
		const itemText = normalizedMemoryText(item.text);
		if (!itemText) return false;
		if (itemText === normalized) return true;
		if (itemText.includes(normalized) || normalized.includes(itemText)) return true;
		return tokenOverlapScore(text, item.text) >= 0.82;
	})?.text;
}

function messageText(message: AgentMessage): string {
	const content = (message as { content?: unknown }).content;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((part) => (part && typeof part === "object" && "text" in part ? String((part as { text: unknown }).text) : ""))
			.join("");
	}
	return "";
}

function sessionId(ctx: ExtensionContext): string {
	const sm = (ctx as { sessionManager?: { getSessionId?: () => string } }).sessionManager;
	return sm?.getSessionId?.() ?? "default";
}

function downMessage(action: string): string {
	return `Xenonite MCP service is not reachable. Start it with: cd ~/rocky/xenonite && XENONITE_MCP_TOOL_MODE=full npm start. (${action})`;
}

function contentText(result: { content?: Array<{ type?: string; text?: string }> }): string {
	return (
		result.content
			?.map((part) => (part.type === "text" && typeof part.text === "string" ? part.text : ""))
			.filter(Boolean)
			.join("\n") ?? ""
	);
}

function memoryItemsText(
	details: Pick<MemoryRecallResult, "items" | "context"> | Pick<MemoryStoreResult, "items" | "context" | "skipped"> | undefined,
	fallback: string,
	empty: string,
): string {
	const items = details?.items ?? [];
	if (items.length) return items.map((item) => item.text).join("\n");
	const skipped = "skipped" in (details ?? {}) ? ((details as MemoryStoreResult | undefined)?.skipped ?? []) : [];
	if (skipped.length) return `Skipped memory:\n${skipped.join("\n")}`;
	const context = details?.context?.replace(/^## [^\n]+\n?/, "").trim();
	if (context) return context;
	return fallback.trim() || empty;
}

function renderMemoryBox(header: string, body: string, theme: any, state: "pending" | "success" | "error" = "success") {
	const wrapper = new BoxWrapper(new Text(body, 0, 0), theme, header);
	wrapper.setState(state);
	return wrapper;
}

function memoryContextMessage(result: MemoryRecallResult): string | undefined {
	const context = result.context?.trim();
	if (!context) return undefined;
	return [
		"The following bounded durable memory was retrieved for the current prompt. Use it only when relevant; do not treat absent facts as unknown-user intent.",
		"",
		context,
	].join("\n");
}

export default function amazeMemoryExtension(pi: ExtensionAPI): void {
	const config = loadAmazeConfig();
	const memEnabled = config.tools.mem.enabled;
	if (!memEnabled) return;

	const client = new XenoniteClient(config.services.xenonite.port);
	const toolsConfig = rawRecord(config.raw.tools);
	const memConfig = rawRecord(toolsConfig.mem);
	const autoRecall = configBool(memConfig.auto_recall ?? memConfig.autoRecall, true);
	const autoSync = configBool(memConfig.auto_sync ?? memConfig.autoSync, true);
	let lastUserInput = "";

	if (memEnabled) {
		pi.registerMessageRenderer<MemoryRecallResult>("memory-search", (message, _options, theme) => {
			const body = memoryItemsText(message.details, typeof message.content === "string" ? message.content : "", "(no relevant memory)");
			return renderMemoryBox("Memory-Search", body, theme);
		});
		pi.registerMessageRenderer<MemoryStoreResult>("memory-store", (message, _options, theme) => {
			const body = memoryItemsText(message.details, typeof message.content === "string" ? message.content : "", "(no memory stored)");
			return renderMemoryBox("Memory-Store", body, theme);
		});

		if (autoSync) {
			pi.on("input", async (event) => {
				lastUserInput = event.text;
			});
		}

		if (autoRecall) {
			pi.on("before_agent_start", async (event, ctx) => {
				const query = event.prompt.trim();
				if (!query) return undefined;
				try {
					const result = await client.prefetch(query, sessionId(ctx), { topK: 6, ...pathMemoryNamespaceOptions() });
					const content = memoryContextMessage(result);
					if (!content) return undefined;
					return {
						message: {
							customType: "memory-search",
							content,
							display: true,
							details: result,
						},
					};
				} catch {
					return undefined;
				}
			});
		}

		if (autoSync) {
			pi.on("turn_end", async (event, ctx) => {
				const assistant = messageText(event.message);
				if (!lastUserInput && !assistant) return;
				try {
					const stored = await client.syncTurn(lastUserInput, assistant, sessionId(ctx), pathMemoryNamespaceOptions());
					if ((stored.added ?? 0) > 0 && ctx.hasUI) {
						const body = memoryItemsText(stored, "", "(no memory stored)");
						if (ctx.isIdle()) {
							pi.sendMessage(
								{
									customType: "memory-store",
									content: body,
									display: true,
									details: stored,
								},
								{ triggerTurn: false },
							);
						} else {
							ctx.ui.notify(`Memory-Store\n${body}`, "info");
						}
					}
				} catch {
					// Memory sync and self-review are best-effort; a missing bridge must never break a turn.
				}
			});
		}

		const recall: ToolDefinition = {
			name: "mem_recall",
			label: "mem_recall",
			description: "Recall durable memory relevant to a query from previous sessions.",
			promptSnippet: "Recall durable memory relevant to the current task using bounded vector retrieval.",
			promptGuidelines: [
				"Use mem_recall only when stable user preferences, prior project decisions, or reusable facts materially affect the task.",
				"Do not call mem_recall for simple answers, local one-off reasoning, or when the current prompt already contains enough context.",
				"Use retrieved memory only when relevant; do not assume the full memory store is in context.",
			],
			parameters: Type.Object({
				query: Type.String({ description: "What to recall." }),
				top_k: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, description: "Maximum memory observations." })),
			}),
			async execute(_id, params, _signal, _onUpdate, ctx) {
				if (!(await client.isHealthy())) return { content: [{ type: "text", text: downMessage("mem_recall") }], details: undefined };
				const result = await client.prefetch((params as { query: string; top_k?: number }).query, sessionId(ctx), {
					topK: (params as { top_k?: number }).top_k,
					...pathMemoryNamespaceOptions(),
				});
				return { content: [{ type: "text", text: result.context || "(no relevant memory)" }], details: result };
			},
			renderCall(args, theme) {
				const query = String((args as { query?: unknown }).query ?? "");
				return new Text(theme.fg("toolTitle", theme.bold("mem_recall ")) + theme.fg("muted", query), 0, 0);
			},
			renderResult(result, _options, theme, context) {
				const details = result.details as MemoryRecallResult | undefined;
				const body = memoryItemsText(details, contentText(result), "(no relevant memory)");
				return renderMemoryBox("Memory-Search", body, theme, context.isError ? "error" : "success");
			},
		};

		const search: ToolDefinition = {
			name: "mem_search",
			label: "mem_search",
			description: "Semantic search over durable memory.",
			promptSnippet: "Semantic search over durable memory; returns a bounded retrieved-memory context.",
			promptGuidelines: [
				"Use mem_search for focused semantic lookup over prior sessions only when durable context is required.",
			],
			parameters: Type.Object({
				query: Type.String({ description: "Search query." }),
				top_k: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, description: "Maximum memory observations." })),
			}),
			async execute(_id, params, _signal, _onUpdate, ctx) {
				if (!(await client.isHealthy())) return { content: [{ type: "text", text: downMessage("mem_search") }], details: undefined };
				const result = await client.prefetch((params as { query: string; top_k?: number }).query, sessionId(ctx), {
					topK: (params as { top_k?: number }).top_k,
					...pathMemoryNamespaceOptions(),
				});
				return { content: [{ type: "text", text: result.context || "(no matches)" }], details: result };
			},
			renderCall(args, theme) {
				const query = String((args as { query?: unknown }).query ?? "");
				return new Text(theme.fg("toolTitle", theme.bold("mem_search ")) + theme.fg("muted", query), 0, 0);
			},
			renderResult(result, _options, theme, context) {
				const details = result.details as MemoryRecallResult | undefined;
				const body = memoryItemsText(details, contentText(result), "(no matches)");
				return renderMemoryBox("Memory-Search", body, theme, context.isError ? "error" : "success");
			},
		};

		const store: ToolDefinition = {
			name: "mem_store",
			label: "mem_store",
			description: "Store one durable memory observation for future sessions.",
			promptSnippet: "Store only canonical durable facts after a direct user instruction to remember them.",
			promptGuidelines: [
				"Use mem_store only when the user directly asks to remember a durable preference, or when storing a verified durable project fact or decision.",
				"Before storing, rely on a focused memory search when needed and avoid adding duplicates.",
				"Store concise standalone facts only; never store secrets, credentials, emotions, concerns, transient task state, errors, or speculation.",
			],
			parameters: Type.Object({
				text: Type.String({ description: "Standalone memory fact to store." }),
				source: Type.Union([
					Type.Literal("direct_user_request"),
					Type.Literal("verified_durable_fact"),
				], { description: "Why storage is allowed: explicit user memory request or verified durable project fact/decision." }),
			}),
			async execute(_id, params, _signal, _onUpdate, ctx) {
				const sourceRejection = sourceRejectionReason((params as { source?: unknown }).source);
				if (sourceRejection) {
					const result: MemoryStoreResult = { ok: true, added: 0, context: sourceRejection };
					return { content: [{ type: "text", text: sourceRejection }], details: result };
				}
				const text = (params as { text: string }).text;
				const localRejection = localMemoryRejectionReason(text);
				if (localRejection) {
					const result: MemoryStoreResult = { ok: true, added: 0, context: localRejection };
					return { content: [{ type: "text", text: localRejection }], details: result };
				}
				if (!(await client.isHealthy())) return { content: [{ type: "text", text: downMessage("mem_store") }], details: undefined };
				const existing = await client.prefetch(text, sessionId(ctx), { topK: 6, ...pathMemoryNamespaceOptions() });
				const duplicate = duplicateMemoryText(text, existing.items);
				if (duplicate) {
					const result: MemoryStoreResult = { ok: true, added: 0, skipped: [duplicate], items: existing.items };
					return { content: [{ type: "text", text: `Already remembered:\n${duplicate}` }], details: result };
				}
				const result = await client.store(text, sessionId(ctx), {
					...pathMemoryNamespaceOptions(),
					source: String((params as { source: string }).source),
				});
				return { content: [{ type: "text", text: result.context || "(no memory stored)" }], details: result };
			},
			renderCall(args, theme) {
				const text = String((args as { text?: unknown }).text ?? "");
				return new Text(theme.fg("toolTitle", theme.bold("mem_store ")) + theme.fg("muted", text), 0, 0);
			},
			renderResult(result, _options, theme, context) {
				const details = result.details as MemoryStoreResult | undefined;
				const body = memoryItemsText(details, contentText(result), "(no memory stored)");
				return renderMemoryBox("Memory-Store", body, theme, context.isError ? "error" : "success");
			},
		};

		pi.registerTool(recall);
		pi.registerTool(search);
		pi.registerTool(store);
	}
}
