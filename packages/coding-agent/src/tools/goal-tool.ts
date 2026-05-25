import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@amaze/agent-core";
import type { Component } from "@amaze/tui";
import { Text } from "@amaze/tui";
import { formatNumber, prompt } from "@amaze/utils";
import * as z from "zod/v4";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import { completionBudgetReport, GoalAcceptanceFailureError, remainingTokens } from "../mission/core/objective-runtime";
import type { Goal, GoalStatus, GoalToolDetails } from "../mission/core/objective-state";
import type { Theme, ThemeColor } from "../modes/theme/theme";
import goalDescription from "../prompts/tools/goal.md" with { type: "text" };
import { formatDuration } from "../slash-commands/helpers/format";
import { renderStatusLine, truncateToWidth } from "../tui";
import type { ToolSession } from ".";
import { formatErrorMessage, TRUNCATE_LENGTHS } from "./render-utils";
import { ToolError } from "./tool-errors";

const goalSchema = z
	.object({
		op: z.enum(["get", "complete", "block"]).describe("Goal operation to perform."),
		goal_id: z
			.string()
			.min(1, "goal_id must not be empty.")
			.optional()
			.describe("The current goal id from the rendered <goal> block or goal({op:'get'})."),
	})
	.superRefine((params, ctx) => {
		if ((params.op === "complete" || params.op === "block") && params.goal_id === undefined) {
			ctx.addIssue({
				code: "custom",
				message: "goal_id is required for complete and block operations.",
				path: ["goal_id"],
			});
		}
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
		if (params.op === "get") {
			const state = this.#session.getGoalModeState?.();
			response = buildGoalToolResponse(state?.enabled ? state.goal : null);
		} else if (params.op === "block") {
			const goalId = requireMutationGoalId(params);
			const blocked = await runtime.blockGoalFromTool({ expectedGoalId: goalId });
			response = buildGoalToolResponse(blocked);
		} else if (params.op === "complete") {
			const goalId = requireMutationGoalId(params);
			const telemetry = this.#session.getV3Telemetry?.();
			try {
				const { goal: completed, verdict } = await runtime.completeGoalFromTool({
					expectedGoalId: goalId,
				});
				response = buildGoalToolResponse(completed, { includeCompletionReport: true });
				telemetry?.recordClosingAudit({
					passed: true,
					forced: false,
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
		} else {
			throw new ToolError(`Unsupported goal operation: ${(params as { op?: unknown }).op ?? "unknown"}`);
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

function requireMutationGoalId(params: GoalToolInput): string {
	if (params.op !== "complete" && params.op !== "block") {
		throw new ToolError(`Unsupported goal operation: ${(params as { op?: unknown }).op ?? "unknown"}`);
	}
	if (typeof params.goal_id !== "string" || params.goal_id.length === 0) {
		throw new ToolError(`goal_id is required for ${params.op} operations.`);
	}
	return params.goal_id;
}

function describeOp(op: string | undefined): string {
	switch (op) {
		case "block":
			return "block";
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
		case "blocked":
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
}

export const goalToolRenderer = {
	renderCall(args: GoalRenderArgs, _options: RenderResultOptions, uiTheme: Theme): Component {
		const description = describeOp(args.op);
		const meta: string[] = [];
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
