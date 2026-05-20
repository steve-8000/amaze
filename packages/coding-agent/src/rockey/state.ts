import { logger } from "@amaze/utils";
import type { AgentSession } from "../session/agent-session";
import { indexCurrentRockeySession } from "./session-search";
import { RockeyStore } from "./store";
import type { RockeyMemoryCategory } from "./types";

const CORRECTION_STRONG_PATTERNS: RegExp[] = [
	/\b(no|wrong|incorrect)\b/i,
	/\bactually\b/i,
	/\bdo not\b/i,
	/\bdon't\b/i,
	/\bnever\b/i,
	/\bremember\b/i,
];

const CORRECTION_NEGATIVE_PATTERNS: RegExp[] = [/\bno problem\b/i, /\bnot wrong\b/i, /\bno worries\b/i];

interface RockeySessionStateOptions {
	session: AgentSession;
	agentDir: string;
	autoCaptureCorrections: boolean;
	indexSessions: boolean;
}

export class RockeySessionState {
	readonly #session: AgentSession;
	readonly #store: RockeyStore;
	readonly #autoCaptureCorrections: boolean;
	readonly #agentDir: string;
	#unsubscribe?: () => void;
	readonly #indexSessions: boolean;
	#lastCorrectionText?: string;

	constructor(options: RockeySessionStateOptions) {
		this.#session = options.session;
		this.#agentDir = options.agentDir;
		this.#store = new RockeyStore({ agentDir: options.agentDir, cwd: options.session.sessionManager.getCwd() });
		this.#autoCaptureCorrections = options.autoCaptureCorrections;
		this.#indexSessions = options.indexSessions;
	}

	attach(): void {
		this.#unsubscribe?.();
		this.#unsubscribe = this.#session.subscribe(event => {
			if (event.type === "message_end" && event.message.role === "user") {
				if (!this.#autoCaptureCorrections) return;
				const text = extractUserMessageText(event.message);
				if (text && isCorrection(text)) this.#lastCorrectionText = text;
				return;
			}
			if (event.type !== "agent_end") return;
			if (this.#lastCorrectionText) {
				const correction = this.#lastCorrectionText;
				this.#lastCorrectionText = undefined;
				void this.#saveCorrection(correction);
			}
			if (this.#indexSessions) void this.#indexCurrentSession();
		});
	}

	dispose(): void {
		this.#unsubscribe?.();
		this.#unsubscribe = undefined;
		this.#store.close();
	}

	async #saveCorrection(text: string): Promise<void> {
		const directive = extractCorrectionDirective(text);
		if (!directive) return;
		try {
			const result = this.#store.add({
				target: "failure",
				content: directive,
				category: "correction",
				failureReason: "User corrected the agent",
			});
			if (result.success) await this.#store.renderArtifacts();
		} catch (err) {
			logger.debug("Rockey correction capture failed", { error: String(err) });
		}
	}

	async #indexCurrentSession(): Promise<void> {
		try {
			await indexCurrentRockeySession(this.#agentDir, this.#session.sessionManager.getSessionFile());
		} catch (err) {
			logger.debug("Rockey session indexing failed", { error: String(err) });
		}
	}
}

export function isCorrection(text: string): boolean {
	for (const pattern of CORRECTION_NEGATIVE_PATTERNS) {
		if (pattern.test(text)) return false;
	}
	return CORRECTION_STRONG_PATTERNS.some(pattern => pattern.test(text));
}

export function extractCorrectionDirective(text: string): string {
	return text
		.replace(/^(no|wrong|incorrect|actually|stop|don'?t|never|remember)[,.\s!]+/i, "")
		.replace(/^(please\s+)?/i, "")
		.trim();
}

export function extractUserMessageText(message: { content: unknown }, maxLength = 1000): string | null {
	const content = message.content;
	if (typeof content === "string") return content.slice(0, maxLength);
	if (!Array.isArray(content)) return null;
	const parts: string[] = [];
	for (const block of content) {
		if (!block || typeof block !== "object") continue;
		const maybeText = block as { type?: unknown; text?: unknown };
		if (maybeText.type === "text" && typeof maybeText.text === "string") parts.push(maybeText.text);
	}
	const text = parts.join("\n").trim();
	return text ? text.slice(0, maxLength) : null;
}

export function normalizeRockeyCategory(value: string | undefined): RockeyMemoryCategory | undefined {
	switch (value) {
		case "failure":
		case "correction":
		case "insight":
		case "preference":
		case "convention":
		case "tool-quirk":
			return value;
		default:
			return undefined;
	}
}
