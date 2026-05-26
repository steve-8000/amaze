import type { TodoItem, TodoPhase } from "../tools/todo-write";

export type ReminderTodo = { content: string; status: "pending" | "in_progress" };
export type ReminderPhase = { name: string; tasks: ReminderTodo[] };

/**
 * Reduce todo phases to the incomplete (pending / in_progress) rows, grouped by phase.
 * Empty phases are dropped so callers can render the result directly.
 */
export function collectIncompleteByPhase(phases: TodoPhase[]): ReminderPhase[] {
	return phases
		.map(phase => ({
			name: phase.name,
			tasks: phase.tasks
				.filter(
					(task): task is TodoItem & { status: "pending" | "in_progress" } =>
						task.status === "pending" || task.status === "in_progress",
				)
				.map(task => ({ content: task.content, status: task.status })),
		}))
		.filter(phase => phase.tasks.length > 0);
}

/**
 * Determine the subset of incomplete todos the agent can actually advance with `todo_write`.
 *
 * When a mission is active, every phase other than `Execution` is a mission-projection
 * synthetic slot (Frame / Decision / Regression / Verification). Those rows advance only
 * through user-invoked mission slash commands (`/mission decision record`, `/mission verify`,
 * `/mission complete`) — the agent has no tool to close them. Reminders on such rows are
 * therefore noise and the caller should suppress them and reset its retry counter.
 *
 * Without an active mission, all incomplete rows are agent-actionable.
 */
export function selectAgentActionableTodos(
	incompleteByPhase: ReminderPhase[],
	hasActiveMission: boolean,
): ReminderTodo[] {
	if (!hasActiveMission) {
		return incompleteByPhase.flatMap(phase => phase.tasks);
	}
	return incompleteByPhase.filter(phase => phase.name === "Execution").flatMap(phase => phase.tasks);
}
