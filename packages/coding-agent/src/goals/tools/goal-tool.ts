import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@amaze/agent-core";
import type { Component } from "@amaze/tui";
import { Text } from "@amaze/tui";
import { formatNumber, prompt } from "@amaze/utils";
import * as z from "zod/v4";
import type { RenderResultOptions } from "../../extensibility/custom-tools/types";
import type { Theme, ThemeColor } from "../../modes/theme/theme";
import goalDescription from "../../prompts/tools/goal.md" with { type: "text" };
import { formatDuration } from "../../slash-commands/helpers/format";
import type { ToolSession } from "../../tools";
import { formatErrorMessage, TRUNCATE_LENGTHS } from "../../tools/render-utils";
import { ToolError } from "../../tools/tool-errors";
import { renderStatusLine, truncateToWidth } from "../../tui";
import { completionBudgetReport, GoalAcceptanceFailureError, remainingTokens } from "../runtime";
import type { Goal, GoalStatus, GoalToolDetails } from "../state";

const acceptanceCriterionSchema = z.object({
	id: z.string(),
	description: z.string(),
	check: z.discriminatedUnion("type", [
		z.object({ type: z.literal("scope-include"), globs: z.array(z.string()) }),
		z.object({ type: z.literal("scope-exclude"), globs: z.array(z.string()) }),
		z.object({ type: z.literal("file-exists"), path: z.string() }),
		z.object({
			type: z.literal("command-exit"),
			command: z.string(),
			expected: z.number().int(),
			cwd: z.string().optional(),
			timeoutMs: z.number().int().positive().optional(),
		}),
		z.object({
			type: z.literal("command-output"),
			command: z.string(),
			expected: z.number().int().optional(),
			cwd: z.string().optional(),
			timeoutMs: z.number().int().positive().optional(),
			stdoutPattern: z.string().optional(),
			stderrPattern: z.string().optional(),
			mustNotMatch: z.array(z.string()).optional(),
		}),
		z.object({
			type: z.literal("lsp-clean"),
			file: z.string().optional(),
			maxWarnings: z.number().int().nonnegative().optional(),
		}),
		z.object({
			type: z.literal("llm-judged"),
			question: z.string(),
			candidate: z.string(),
		}),
		z.object({ type: z.literal("manual"), description: z.string() }),
	]),
});

const goalSchema = z.object({
	op: z.enum(["create", "get", "update", "complete"]).describe("goal operation"),
	objective: z.string().describe("goal objective").optional(),
	token_budget: z.number().int().describe("token budget").optional(),
	// `update` op: partial patch of design answers (scope/constraints/approach/acceptance, or
	// any caller-defined keys). Keys with empty-string value are removed from the goal's
	// designAnswers; other keys are merged into existing answers without clobbering.
	design_answers: z.record(z.string(), z.string()).describe("design interview answers (partial merge)").optional(),
	// `update` op: structured acceptance criteria. Pass full list to REPLACE existing
	// criteria (no merge — id collisions in a merge are too fragile). Empty array clears.
	acceptance_criteria: z
		.array(acceptanceCriterionSchema)
		.describe("structured criteria checked by closing audit verifier (replaces existing)")
		.optional(),
	// `complete` op: skip closing audit and force completion. Logged for force-rate
	// telemetry; high rates indicate criteria mis-calibration.
	force: z.boolean().describe("force complete, skip closing audit").optional(),
});

export type GoalToolInput = z.infer<typeof goalSchema>;

export interface GoalToolResponse {
	goal: Goal | null;
	remainingTokens: number | null;
	completionBudgetReport: string | null;
	closingAuditNote?: string;
}

export function buildGoalToolResponse(
	goal: Goal | null | undefined,
	options?: { includeCompletionReport?: boolean },
): GoalToolResponse {
	const resolvedGoal = goal ?? null;
	return {
		goal: resolvedGoal,
		remainingTokens: remainingTokens(resolvedGoal),
		completionBudgetReport:
			options?.includeCompletionReport && resolvedGoal?.status === "complete"
				? completionBudgetReport(resolvedGoal)
				: null,
	};
}

function validateCreateParams(params: GoalToolInput): { objective: string; tokenBudget?: number } {
	const objective = params.objective?.trim();
	if (!objective) {
		throw new ToolError("objective is required when op=create");
	}
	const tokenBudget = params.token_budget;
	if (tokenBudget !== undefined && (!Number.isInteger(tokenBudget) || tokenBudget <= 0)) {
		throw new ToolError("token_budget must be a positive integer when provided");
	}
	return { objective, tokenBudget };
}

export class GoalTool implements AgentTool<typeof goalSchema, GoalToolDetails> {
	readonly name = "goal";
	readonly label = "Goal";
	readonly description = prompt.render(goalDescription);
	readonly parameters = goalSchema;
	readonly strict = true;
	readonly intent = "omit" as const;
	readonly #session: ToolSession;

	constructor(session: ToolSession) {
		this.#session = session;
	}

	async execute(
		_toolCallId: string,
		params: GoalToolInput,
		_signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<GoalToolDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<GoalToolDetails>> {
		const runtime = this.#session.getGoalRuntime?.();
		if (!runtime) {
			throw new ToolError("Goal mode is not active.");
		}

		let response: GoalToolResponse;
		if (params.op === "create") {
			const created = await runtime.createGoal(validateCreateParams(params));
			response = buildGoalToolResponse(created.goal);
		} else if (params.op === "get") {
			const state = this.#session.getGoalModeState?.();
			response = buildGoalToolResponse(state?.enabled ? state.goal : null);
		} else if (params.op === "update") {
			const updated = await runtime.updateGoal({
				objective: params.objective,
				tokenBudget: params.token_budget,
				designAnswers: params.design_answers,
				acceptanceCriteria: params.acceptance_criteria,
			});
			if (!updated) {
				throw new ToolError("Cannot update: no active goal.");
			}
			response = buildGoalToolResponse(updated);
		} else {
			const telemetry = this.#session.getV3Telemetry?.();
			try {
				const { goal: completed, verdict } = await runtime.completeGoalFromTool({ force: params.force });
				response = buildGoalToolResponse(completed, { includeCompletionReport: true });
				// V3 telemetry: closing audit completion (force vs natural pass). When force=true
				// the verdict is undefined (verification was skipped); record as forced regardless.
				telemetry?.recordClosingAudit({
					passed: !params.force,
					forced: !!params.force,
					uncertainCount: verdict?.uncertainCount ?? 0,
				});
				// Per-criterion result counts feed the verifier dashboard so operators can see
				// which check types carry the work and which fail most often. The CriterionResult
				// itself lacks the check.type, so we look up by id on the completed goal's list.
				for (const r of verdict?.results ?? []) {
					const criterion = completed.acceptanceCriteria?.find(c => c.id === r.id);
					if (criterion) telemetry?.recordVerifierResult(criterion.check.type, r.status);
				}
				if (verdict && verdict.uncertainCount > 0) {
					response = {
						...response,
						closingAuditNote: `${verdict.uncertainCount} criterion(s) flagged uncertain (manual review).`,
					};
				}
			} catch (error) {
				if (error instanceof GoalAcceptanceFailureError) {
					// Failed closing audit also counts as a completion attempt for force-rate math.
					telemetry?.recordClosingAudit({
						passed: false,
						forced: false,
						uncertainCount: error.verdict.uncertainCount,
					});
					throw new ToolError(error.message);
				}
				throw error;
			}
		}
		let text: string;
		if (response.goal) {
			text = `Goal: ${response.goal.objective}\nStatus: ${response.goal.status}\nTokens: ${response.goal.tokensUsed} used`;
			if (response.goal.tokenBudget !== undefined) {
				text += ` / ${response.goal.tokenBudget} budget`;
			}
			if (response.remainingTokens !== null) {
				text += `\nRemaining tokens: ${response.remainingTokens}`;
			}
			if (response.completionBudgetReport) {
				text += `\n\n${response.completionBudgetReport}`;
			}
		} else {
			text = "No active goal.";
		}
		return {
			content: [{ type: "text", text }],
			details: {
				op: params.op,
				goal: response.goal,
				remainingTokens: response.remainingTokens,
				completionBudgetReport: response.completionBudgetReport,
			},
		};
	}
}

function describeOp(op: string | undefined): string {
	switch (op) {
		case "create":
			return "set";
		case "update":
			return "update";
		case "complete":
			return "complete";
		case "get":
			return "check";
		default:
			return op ?? "?";
	}
}

function goalBadgeColor(status: GoalStatus): ThemeColor {
	switch (status) {
		case "complete":
			return "success";
		case "budget-limited":
			return "warning";
		case "paused":
		case "dropped":
			return "muted";
		default:
			return "accent";
	}
}

interface GoalRenderArgs {
	op?: GoalToolInput["op"];
	objective?: string;
	token_budget?: number;
}

export const goalToolRenderer = {
	renderCall(args: GoalRenderArgs, _options: RenderResultOptions, uiTheme: Theme): Component {
		const description = describeOp(args.op);
		const meta: string[] = [];
		const trimmedObjective = args.objective?.trim();
		if (args.op === "create" && trimmedObjective) {
			const objective = truncateToWidth(trimmedObjective, TRUNCATE_LENGTHS.TITLE);
			meta.push(uiTheme.italic(uiTheme.fg("muted", `"${objective}"`)));
		}
		if (args.op === "create" && args.token_budget !== undefined) {
			meta.push(`budget ${formatNumber(args.token_budget)}`);
		}
		const text = renderStatusLine({ icon: "pending", title: "Goal", description, meta }, uiTheme);
		return new Text(text, 0, 0);
	},

	renderResult(
		result: { content: Array<{ type: string; text?: string }>; details?: GoalToolDetails; isError?: boolean },
		_options: RenderResultOptions,
		uiTheme: Theme,
		args?: GoalRenderArgs,
	): Component {
		const fallbackText = result.content?.find(c => c.type === "text")?.text ?? "";
		const details = result.details;
		const op = details?.op ?? args?.op;
		const description = describeOp(op);

		if (result.isError) {
			const header = renderStatusLine({ icon: "error", title: "Goal", description }, uiTheme);
			const body = formatErrorMessage(fallbackText || "Goal tool failed", uiTheme);
			return new Text([header, body].join("\n"), 0, 0);
		}

		const goal = details?.goal ?? null;
		if (!goal) {
			const header = renderStatusLine({ icon: "warning", title: "Goal", description }, uiTheme);
			const body = uiTheme.fg("muted", "No active goal.");
			return new Text([header, body].join("\n"), 0, 0);
		}

		const lines: string[] = [];
		lines.push(
			renderStatusLine(
				{
					icon: "success",
					title: "Goal",
					description,
					badge: { label: goal.status, color: goalBadgeColor(goal.status) },
				},
				uiTheme,
			),
		);

		const objectiveText = truncateToWidth(goal.objective.trim(), TRUNCATE_LENGTHS.LONG);
		lines.push(`  ${uiTheme.italic(uiTheme.fg("muted", `"${objectiveText}"`))}`);

		const used = formatNumber(goal.tokensUsed);
		const tokensLine =
			goal.tokenBudget !== undefined
				? `${used} / ${formatNumber(goal.tokenBudget)} tokens (${formatNumber(Math.max(0, goal.tokenBudget - goal.tokensUsed))} left)`
				: `${used} tokens`;
		lines.push(`  ${uiTheme.fg("dim", tokensLine)}`);

		if (goal.timeUsedSeconds > 0) {
			lines.push(`  ${uiTheme.fg("dim", `${formatDuration(goal.timeUsedSeconds * 1000)} elapsed`)}`);
		}

		const report = details?.completionBudgetReport;
		if (report) {
			lines.push("");
			lines.push(uiTheme.italic(uiTheme.fg("muted", report)));
		}

		return new Text(lines.join("\n"), 0, 0);
	},

	mergeCallAndResult: true,
};
