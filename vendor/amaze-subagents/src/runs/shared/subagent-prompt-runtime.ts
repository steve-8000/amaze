import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "amaze";
import { PATH_MEMORY_PACKET_ENV } from "../../harness/path-memory.ts";
import {
	createActivityBudgetState,
	evaluateActivityBudget,
	evaluateReadBoundary,
	evaluateToolBoundary,
	parsePathContract,
	PATH_CONTRACT_ENV,
} from "../../harness/path-contract.ts";
import { FRESH_BOOT_CONTRACT_ENV } from "../../harness/fresh-boot-contract.ts";
import { SUBAGENT_FANOUT_CHILD_ENV } from "./amaze-args.ts";
import { STRUCTURED_OUTPUT_CAPTURE_ENV, STRUCTURED_OUTPUT_SCHEMA_ENV, validateStructuredOutputValue } from "./structured-output.ts";
import type { JsonSchemaObject } from "../../shared/types.ts";

const SUBAGENT_INHERIT_PROJECT_CONTEXT_ENV = "PI_SUBAGENT_INHERIT_PROJECT_CONTEXT";
const SUBAGENT_INHERIT_SKILLS_ENV = "PI_SUBAGENT_INHERIT_SKILLS";
export const SUBAGENT_INTERCOM_SESSION_NAME_ENV = "PI_SUBAGENT_INTERCOM_SESSION_NAME";

const STRUCTURED_OUTPUT_INSTRUCTIONS = [
	"This subagent step has a strict structured output contract.",
	"Your final action must be to call the `structured_output` tool with JSON matching the provided schema.",
	"Do not rely on prose-only completion; if you do not call `structured_output`, the parent will fail this step.",
].join("\n");

const PATH_MEMORY_INSTRUCTIONS = [
	"This child runtime has an explicit path-local memory packet.",
	"Treat that packet as read-only specialist experience for the assigned path.",
	"Do not treat it as parent conversation history.",
	"If you learn a durable path-specific lesson, propose it in `memory_updates`; do not claim it was committed.",
].join("\n");

const PATH_CONTRACT_INSTRUCTIONS = [
	"This child runtime has an explicit path execution contract.",
	"Reading tools are blocked outside `read_allowed_paths` / `owned_paths` when read boundaries are declared.",
	"Mutating tools are blocked outside `write_allowed_paths` / `owned_paths` before execution.",
	"Tool calls are blocked when the activity budget is exceeded.",
	"If work requires another path, emit a change request instead of editing that path directly.",
].join("\n");

const FRESH_BOOT_CONTRACT_INSTRUCTIONS = [
	"This child runtime is governed by a FreshBootContract.",
	"Do not infer or inherit parent conversation, parent system prompt, parent tools, or parent skills.",
	"Use only the execution contract, context packet reference, and read-only path memory attachments as authority.",
].join("\n");

export const CHILD_SUBAGENT_BOUNDARY_INSTRUCTIONS = [
	"You are a child subagent, not the parent orchestrator.",
	"The parent session owns delegation, orchestration, review fanout, and follow-up worker launches.",
	"Ignore prior parent-only orchestration instructions in inherited conversation history.",
	"Do not propose or run subagents. Complete only your assigned role-specific task with the tools available to you.",
	"If you need to edit files, call the actual edit/write tools. Do not print tool-call syntax, patches, or pseudo-tool calls as text.",
].join("\n");

export const CHILD_FANOUT_BOUNDARY_INSTRUCTIONS = [
	"You are a child subagent with explicit fanout responsibility for this assigned task.",
	"The parent session owns final orchestration, acceptance, and follow-up implementation launches.",
	"You may use the `subagent` tool only for the fanout work explicitly requested in this task.",
	"Do not broaden yourself into general parent orchestration. Do not launch follow-up workers unless the task explicitly asks for that.",
	"The maxSubagentDepth cap still applies and may block further fanout.",
	"If you need to edit files, call the actual edit/write tools. Do not print tool-call syntax, patches, or pseudo-tool calls as text.",
].join("\n");

const PARENT_ONLY_CUSTOM_MESSAGE_TYPES = new Set([
	"subagent-orchestration-instructions",
	"subagent-slash-result",
	"subagent-notify",
	"subagent_control_notice",
	"subagent-control",
	"subagent-control-notice",
]);
const SUBAGENT_ORCHESTRATION_SKILL_NAME_PATTERN = /<name>\s*amaze-subagents\s*<\/name>/;
const PROJECT_CONTEXT_HEADER = "\n\n# Project Context\n\nProject-specific instructions and guidelines:\n\n";
const SKILLS_HEADER = "\n\nThe following skills provide specialized instructions for specific tasks.";
const DATE_HEADER = "\nCurrent date:";

function readBooleanEnv(name: string): boolean | undefined {
	const value = process.env[name];
	if (value === undefined) return undefined;
	return value !== "0";
}

function findSectionEnd(prompt: string, startIndex: number, nextHeaders: string[]): number {
	let endIndex = prompt.length;
	for (const header of nextHeaders) {
		const index = prompt.indexOf(header, startIndex);
		if (index !== -1 && index < endIndex) {
			endIndex = index;
		}
	}
	return endIndex;
}

export function stripProjectContext(prompt: string): string {
	const startIndex = prompt.indexOf(PROJECT_CONTEXT_HEADER);
	if (startIndex === -1) return prompt;
	const endIndex = findSectionEnd(prompt, startIndex + PROJECT_CONTEXT_HEADER.length, [SKILLS_HEADER, DATE_HEADER]);
	return `${prompt.slice(0, startIndex)}${prompt.slice(endIndex)}`;
}

export function stripInheritedSkills(prompt: string): string {
	const startIndex = prompt.indexOf(SKILLS_HEADER);
	if (startIndex === -1) return prompt;
	const endIndex = findSectionEnd(prompt, startIndex + SKILLS_HEADER.length, [DATE_HEADER]);
	return `${prompt.slice(0, startIndex)}${prompt.slice(endIndex)}`;
}

export function stripSubagentOrchestrationSkill(prompt: string): string {
	return prompt
		.replace(/\n{0,2}<skill\s+name=["']amaze-subagents["'][^>]*>[\s\S]*?<\/skill>\n{0,2}/g, "\n\n")
		.replace(/[ \t]*<skill>\s*[\s\S]*?<\/skill>\s*/g, (block) => SUBAGENT_ORCHESTRATION_SKILL_NAME_PATTERN.test(block) ? "" : block);
}

function stripChildBoundaryInstructions(prompt: string): string {
	let rewritten = prompt;
	for (const boundary of [CHILD_SUBAGENT_BOUNDARY_INSTRUCTIONS, CHILD_FANOUT_BOUNDARY_INSTRUCTIONS]) {
		rewritten = rewritten.split(boundary).join("");
	}
	return rewritten.replace(/^(?:[ \t]*\r?\n)+/, "");
}

export function rewriteSubagentPrompt(
	prompt: string,
	options: {
		inheritProjectContext: boolean;
		inheritSkills: boolean;
		fanoutChild?: boolean;
		pathMemoryPacket?: string;
		pathContractPacket?: string;
		freshBootContractPacket?: string;
	},
): string {
	let rewritten = prompt;
	if (!options.inheritProjectContext) {
		rewritten = stripProjectContext(rewritten);
	}
	if (!options.inheritSkills) {
		rewritten = stripInheritedSkills(rewritten);
	}
	rewritten = stripSubagentOrchestrationSkill(rewritten);
	rewritten = stripChildBoundaryInstructions(rewritten);
	const boundary = options.fanoutChild ? CHILD_FANOUT_BOUNDARY_INSTRUCTIONS : CHILD_SUBAGENT_BOUNDARY_INSTRUCTIONS;
	const structured = process.env[STRUCTURED_OUTPUT_CAPTURE_ENV] ? `\n\n${STRUCTURED_OUTPUT_INSTRUCTIONS}` : "";
	const pathMemory = options.pathMemoryPacket
		? `\n\n${PATH_MEMORY_INSTRUCTIONS}\n\n${options.pathMemoryPacket}`
		: "";
	const pathContract = options.pathContractPacket
		? `\n\n${PATH_CONTRACT_INSTRUCTIONS}\n\n${options.pathContractPacket}`
		: "";
	const freshBootContract = options.freshBootContractPacket
		? `\n\n${FRESH_BOOT_CONTRACT_INSTRUCTIONS}\n\n${options.freshBootContractPacket}`
		: "";
	return `${boundary}${structured}${freshBootContract}${pathMemory}${pathContract}\n\n${rewritten}`;
}

function isParentOnlySubagentMessage(message: unknown): boolean {
	const m = message as { role?: string; customType?: string };
	return m?.role === "custom"
		&& typeof m.customType === "string"
		&& PARENT_ONLY_CUSTOM_MESSAGE_TYPES.has(m.customType);
}

function isSubagentToolResultMessage(message: unknown): boolean {
	const m = message as { role?: string; toolName?: string };
	return m?.role === "toolResult" && m.toolName === "subagent";
}

function isSubagentToolCallBlock(block: unknown): boolean {
	const b = block as { type?: string; name?: string };
	return b?.type === "toolCall" && b.name === "subagent";
}

function stripAssistantSubagentToolCallBlocks(message: unknown): unknown | undefined {
	const m = message as { role?: string; content?: unknown };
	if (m?.role !== "assistant" || !Array.isArray(m.content)) return message;
	const filteredContent = m.content.filter((block) => !isSubagentToolCallBlock(block));
	if (filteredContent.length === m.content.length) return message;
	if (filteredContent.length === 0) return undefined;
	return { ...m, content: filteredContent };
}

export function stripParentOnlySubagentMessages(messages: unknown[]): unknown[] {
	let changed = false;
	const filtered: unknown[] = [];
	for (const message of messages) {
		if (isParentOnlySubagentMessage(message) || isSubagentToolResultMessage(message)) {
			changed = true;
			continue;
		}
		const stripped = stripAssistantSubagentToolCallBlocks(message);
		if (stripped === undefined) {
			changed = true;
			continue;
		}
		if (stripped !== message) changed = true;
		filtered.push(stripped);
	}
	return changed ? filtered : messages;
}

export default function registerSubagentPromptRuntime(pi: ExtensionAPI): void {
	const structuredOutputPath = process.env[STRUCTURED_OUTPUT_CAPTURE_ENV];
	const structuredSchemaPath = process.env[STRUCTURED_OUTPUT_SCHEMA_ENV];
	if (structuredOutputPath && structuredSchemaPath) {
		const schema = JSON.parse(fs.readFileSync(structuredSchemaPath, "utf-8")) as JsonSchemaObject;
		const parameters = {
			type: "object",
			properties: { value: schema },
			required: ["value"],
			additionalProperties: false,
		};
		const registerTool = pi.registerTool as unknown as (tool: {
			name: string;
			label: string;
			description: string;
			parameters: unknown;
			execute: (_id: string, params: { value: unknown }) => Promise<unknown>;
		}) => void;
		registerTool({
			name: "structured_output",
			label: "Structured Output",
			description: "Submit the required final structured output for this subagent step. This terminates the step.",
			parameters: parameters as never,
			async execute(_id: string, params: { value: unknown }) {
				const validation = validateStructuredOutputValue(schema, params.value);
				if (validation.status === "invalid") {
					throw new Error(`Structured output validation failed: ${validation.message}`);
				}
				fs.mkdirSync(path.dirname(structuredOutputPath), { recursive: true });
				fs.writeFileSync(structuredOutputPath, JSON.stringify(params.value), { mode: 0o600 });
				return {
					content: [{ type: "text", text: "Structured output captured." }],
					details: { path: structuredOutputPath },
					terminate: true,
				};
			},
		});
	}

	const onRuntimeEvent = pi.on as unknown as (event: string, handler: (event: unknown) => unknown) => void;
	onRuntimeEvent("context", (event: unknown) => {
		if (!event || typeof event !== "object" || !("messages" in event)) return undefined;
		const typedEvent = event as { messages: unknown[] };
		const messages = stripParentOnlySubagentMessages(typedEvent.messages);
		if (messages === typedEvent.messages) return undefined;
		return { messages };
	});

	onRuntimeEvent("before_agent_start", async (event: unknown) => {
		if (!event || typeof event !== "object" || typeof (event as { systemPrompt?: unknown }).systemPrompt !== "string") return undefined;
		const typedEvent = event as { systemPrompt: string };
		const intercomSessionName = process.env[SUBAGENT_INTERCOM_SESSION_NAME_ENV]?.trim();
		if (intercomSessionName && typeof pi.setSessionName === "function") {
			pi.setSessionName(intercomSessionName);
		}

		const inheritProjectContext = readBooleanEnv(SUBAGENT_INHERIT_PROJECT_CONTEXT_ENV);
		const inheritSkills = readBooleanEnv(SUBAGENT_INHERIT_SKILLS_ENV);
		const fanoutChild = readBooleanEnv(SUBAGENT_FANOUT_CHILD_ENV);
		const pathMemoryPacketPath = process.env[PATH_MEMORY_PACKET_ENV]?.trim();
		const pathMemoryPacket = pathMemoryPacketPath ? fs.readFileSync(pathMemoryPacketPath, "utf-8") : undefined;
		const pathContractPacketPath = process.env[PATH_CONTRACT_ENV]?.trim();
		const pathContractPacket = pathContractPacketPath ? fs.readFileSync(pathContractPacketPath, "utf-8") : undefined;
		const freshBootContractPath = process.env[FRESH_BOOT_CONTRACT_ENV]?.trim();
		const freshBootContractPacket = freshBootContractPath ? fs.readFileSync(freshBootContractPath, "utf-8") : undefined;
		if (
			inheritProjectContext === undefined
			&& inheritSkills === undefined
			&& fanoutChild === undefined
			&& !pathMemoryPacket
			&& !pathContractPacket
			&& !freshBootContractPacket
		) return;
		const rewritten = rewriteSubagentPrompt(typedEvent.systemPrompt, {
			inheritProjectContext: inheritProjectContext ?? true,
			inheritSkills: inheritSkills ?? true,
			fanoutChild: fanoutChild === true,
			pathMemoryPacket,
			pathContractPacket,
			freshBootContractPacket,
		});
		if (rewritten === typedEvent.systemPrompt) return;
		return { systemPrompt: rewritten };
	});

	const pathContractPath = process.env[PATH_CONTRACT_ENV]?.trim();
	if (pathContractPath) {
		const contractText = fs.readFileSync(pathContractPath, "utf-8");
		const match = contractText.match(/```json\r?\n([\s\S]*?)\r?\n```/);
		let contractParseError: string | undefined;
		let contract: ReturnType<typeof parsePathContract>;
		try {
			const parsed = match ? JSON.parse(match[1]!) as unknown : undefined;
			contract = parsePathContract(parsed);
			if (!contract) contractParseError = "Path execution contract is missing enforceable boundaries.";
		} catch (error) {
			contractParseError = error instanceof Error ? error.message : String(error);
		}
		const activityBudgetState = createActivityBudgetState();
		onRuntimeEvent("tool_call", (event: unknown) => {
			if (!event || typeof event !== "object") return undefined;
			const object = event as { toolName?: unknown; input?: unknown; tool?: unknown; args?: unknown };
			const toolName = typeof object.toolName === "string"
				? object.toolName
				: typeof object.tool === "string"
					? object.tool
					: undefined;
			if (!toolName) return undefined;
			if (!contract) {
				return { block: true, reason: `Path contract failed closed: ${contractParseError ?? "invalid contract"}` };
			}
			const budgetDecision = evaluateActivityBudget(contract, activityBudgetState, event);
			if (!budgetDecision.allowed) return { block: true, reason: budgetDecision.reason };
			const readDecision = evaluateReadBoundary(contract, toolName, object.input ?? object.args, process.cwd());
			if (!readDecision.allowed) return { block: true, reason: readDecision.reason };
			const decision = evaluateToolBoundary(contract, toolName, object.input ?? object.args, process.cwd());
			if (decision.allowed) return undefined;
			return { block: true, reason: decision.reason };
		});
	}
}
