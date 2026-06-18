import type { Theme } from "../../../../modes/interactive/theme/theme.ts";
import { CachedTextBox } from "../../../../tui/cached-text-box.ts";
import type { ExtensionAPI, ExtensionContext } from "../../types.ts";
import { TASK_MANAGEMENT_SECTION } from "./prompt.ts";
import { getLatestTodosFromBranchEntries, isIncompleteTodo, sanitizeTodoText, type TodoItem } from "./state.ts";
import { registerTodoReadTool } from "./tools/todoread.ts";
import { registerTodoWriteTool } from "./tools/todowrite.ts";

const TODO_WIDGET_MAX_ROWS = 12;

/** Colored status glyph for a todo row. */
function todoMarker(status: TodoItem["status"], theme: Theme): string {
	switch (status) {
		case "completed":
			return theme.fg("success", "\u2714");
		case "in_progress":
			return theme.fg("accent", "\u25cf");
		case "cancelled":
			return theme.fg("dim", "\u2718");
		default:
			return theme.fg("muted", "\u25cb");
	}
}

/** Build the boxed, color-coded todo sidebar component (or undefined when empty/all done). */
function buildTodoWidget(todos: TodoItem[], theme: Theme): CachedTextBox | undefined {
	if (todos.length === 0 || !todos.some(isIncompleteTodo)) {
		return undefined;
	}
	const total = todos.length;
	const done = todos.filter((todo) => todo.status === "completed").length;
	const rows = todos.slice(0, TODO_WIDGET_MAX_ROWS).map((todo) => {
		const text = sanitizeTodoText(todo.content);
		const label =
			todo.status === "completed" || todo.status === "cancelled"
				? theme.fg("dim", text)
				: todo.status === "in_progress"
					? theme.bold(text)
					: text;
		return `${todoMarker(todo.status, theme)} ${label}`;
	});
	if (total > TODO_WIDGET_MAX_ROWS) {
		rows.push(theme.fg("muted", `\u2026 ${total - TODO_WIDGET_MAX_ROWS} more`));
	}
	// Distinct border color (theme-safe) so the todo sidebar reads differently from
	// the tool/welcome boxes, with no background fill for a lighter look.
	return new CachedTextBox(theme).set({
		title: `Todo ${done}/${total}`,
		text: rows.join("\n"),
		borderColor: "borderAccent",
		applyBg: false,
	});
}

function getLatestTodos(ctx: ExtensionContext): TodoItem[] {
	return getLatestTodosFromBranchEntries(ctx.sessionManager.getBranch());
}

export default function todotoolsExtension(pi: ExtensionAPI): void {
	let currentTodos: TodoItem[] = [];

	const getCurrentTodos = (): TodoItem[] => currentTodos;

	const setCurrentTodos = (todos: TodoItem[]): void => {
		currentTodos = todos;
	};

	const syncWidget = (ctx: ExtensionContext): void => {
		if (currentTodos.length === 0 || !currentTodos.some(isIncompleteTodo)) {
			ctx.ui.setWidget("todo-sidebar", undefined);
			return;
		}
		const todos = currentTodos;
		ctx.ui.setWidget("todo-sidebar", (_tui, theme) => buildTodoWidget(todos, theme) ?? new CachedTextBox(theme));
	};

	const syncFromSession = (ctx: ExtensionContext): void => {
		currentTodos = getLatestTodos(ctx);
		syncWidget(ctx);
	};

	pi.on("session_start", async (_event, ctx) => {
		syncFromSession(ctx);
	});

	// Re-sync the bottom widget from session state on every event that can change
	// the todo entry stream, so the sidebar never drifts from the persisted todos.
	pi.on("session_tree", async (_event, ctx) => {
		syncFromSession(ctx);
	});

	pi.on("session_compact", async (_event, ctx) => {
		syncFromSession(ctx);
	});

	// Guarantee the sidebar matches the latest persisted todos at the end of every
	// agent turn (catches any completion that didn't go through a direct widget sync).
	pi.on("agent_end", async (_event, ctx) => {
		syncFromSession(ctx);
	});

	pi.on("before_agent_start", async (event) => {
		return {
			systemPrompt: `${event.systemPrompt}\n${TASK_MANAGEMENT_SECTION}`,
		};
	});

	registerTodoWriteTool(pi, { getCurrentTodos, setCurrentTodos, syncWidget });
	registerTodoReadTool(pi, getCurrentTodos);
}

export { TASK_MANAGEMENT_SECTION } from "./prompt.ts";
export {
	getLatestTodosFromBranchEntries,
	getTodoMarker,
	getTodoResultLines,
	getTodoWidgetLines,
	isIncompleteTodo,
	isTerminalTodoStatus,
	isTodoItem,
	isTodoItemArray,
	sanitizeTodoText,
	TODO_STATE_ENTRY_TYPE,
	type TodoItem,
} from "./state.ts";
