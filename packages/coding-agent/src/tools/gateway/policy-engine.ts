import type { ToolDescriptor, ToolExecutionContext, ToolRiskLevel } from "../registry/tool-descriptor";
import type { PolicyDecision, PolicyGate } from "./tool-gateway";

export type RuntimePolicyVerdict = "ALLOW" | "DENY" | "ASK";

export type RuntimePolicyStateValue = string | number | boolean | null | RuntimePolicyStateValue[];
export type RuntimePolicyState = Record<string, RuntimePolicyStateValue>;

export type RuntimePolicyStateUpdate =
	| { key: string; action: "set"; value: RuntimePolicyStateValue }
	| { key: string; action: "increment"; value?: number }
	| { key: string; action: "delete" }
	| { key: string; action: "append"; value: RuntimePolicyStateValue };

export interface RuntimePolicyEvent {
	type: "tool_call";
	target: string;
	data: {
		name: string;
		arguments: unknown;
		descriptor: ToolDescriptor<any, any>;
		riskLevel: ToolRiskLevel;
	};
	context: {
		cwd?: string;
		toolCallId?: string;
		agentRole?: ToolExecutionContext["agentRole"];
	};
	sessionState: RuntimePolicyState;
}

export interface RuntimePolicyResponse {
	result: RuntimePolicyVerdict;
	reason?: string;
	code?: string;
	details?: Record<string, unknown>;
	stateUpdates?: RuntimePolicyStateUpdate[];
}

export type RuntimePolicyEvaluator = (event: RuntimePolicyEvent) => RuntimePolicyResponse | undefined;

export interface RuntimePolicyDescriptor<TParams = unknown> {
	id: string;
	name: string;
	description: string;
	paramsSchema?: unknown;
	factory(params: TParams): RuntimePolicyEvaluator;
}

export class RuntimePolicyRegistry {
	#descriptors = new Map<string, RuntimePolicyDescriptor<any>>();

	register<TParams>(descriptor: RuntimePolicyDescriptor<TParams>): void {
		if (this.#descriptors.has(descriptor.id)) {
			throw new Error(`RuntimePolicyRegistry: duplicate policy id "${descriptor.id}"`);
		}
		this.#descriptors.set(descriptor.id, descriptor);
	}

	get<TParams = unknown>(id: string): RuntimePolicyDescriptor<TParams> | undefined {
		return this.#descriptors.get(id);
	}

	list(): RuntimePolicyDescriptor<any>[] {
		return [...this.#descriptors.values()];
	}
}

export class RuntimePolicyEngine implements PolicyGate {
	#evaluators: RuntimePolicyEvaluator[];
	#state: RuntimePolicyState;

	constructor(evaluators: RuntimePolicyEvaluator[] = [], state: RuntimePolicyState = {}) {
		this.#evaluators = evaluators;
		this.#state = state;
	}

	get state(): RuntimePolicyState {
		return { ...this.#state };
	}

	check(descriptor: ToolDescriptor<any, any>, ctx: ToolExecutionContext, riskLevel: ToolRiskLevel): PolicyDecision {
		if (this.#evaluators.length === 0) return { allowed: true };

		const event: RuntimePolicyEvent = {
			type: "tool_call",
			target: descriptor.name,
			data: {
				name: descriptor.name,
				arguments: ctx.input,
				descriptor,
				riskLevel,
			},
			context: {
				...(ctx.cwd !== undefined ? { cwd: ctx.cwd } : {}),
				...(ctx.toolCallId !== undefined ? { toolCallId: ctx.toolCallId } : {}),
				...(ctx.agentRole !== undefined ? { agentRole: ctx.agentRole } : {}),
			},
			sessionState: this.#state,
		};

		for (const evaluator of this.#evaluators) {
			let response: RuntimePolicyResponse | undefined;
			try {
				response = evaluator(event);
			} catch (err) {
				return {
					allowed: false,
					reason: `runtime policy threw: ${err instanceof Error ? err.message : String(err)}`,
					code: "POLICY_EXCEPTION",
				};
			}
			if (!response) continue;
			applyStateUpdates(this.#state, response.stateUpdates ?? []);
			if (response.result === "ALLOW") continue;
			return {
				allowed: false,
				reason:
					response.reason ??
					(response.result === "ASK" ? "runtime policy requires approval" : "runtime policy denied tool call"),
				code: response.code ?? (response.result === "ASK" ? "POLICY_ASK_REQUIRED" : "POLICY_DENIED"),
				details: response.details,
			};
		}

		return { allowed: true };
	}
}

export class CompositePolicyGate implements PolicyGate {
	#gates: PolicyGate[];

	constructor(gates: PolicyGate[]) {
		this.#gates = gates;
	}

	check(descriptor: ToolDescriptor<any, any>, ctx: ToolExecutionContext, riskLevel: ToolRiskLevel): PolicyDecision {
		for (const gate of this.#gates) {
			const decision = gate.check(descriptor, ctx, riskLevel);
			if (!decision.allowed) return decision;
		}
		return { allowed: true };
	}
}

function applyStateUpdates(state: RuntimePolicyState, updates: RuntimePolicyStateUpdate[]): void {
	for (const update of updates) {
		if (update.action === "set") {
			state[update.key] = update.value;
			continue;
		}
		if (update.action === "delete") {
			delete state[update.key];
			continue;
		}
		if (update.action === "append") {
			const current = state[update.key];
			state[update.key] = Array.isArray(current) ? [...current, update.value] : [update.value];
			continue;
		}
		const current = state[update.key];
		const base = typeof current === "number" && Number.isFinite(current) ? current : 0;
		state[update.key] = base + (update.value ?? 1);
	}
}
