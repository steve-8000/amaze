export const SECTION_CONTEXT_CAPSULE_SCHEMA = "amaze.compaction.section-context-capsule.v1";

export interface SectionTodo {
	id?: string;
	content: string;
	status?: "pending" | "in_progress" | "completed" | "cancelled";
}

export interface SectionEvidence {
	kind: "file_read" | "file_changed" | "command" | "verification" | "decision" | "risk" | "memory";
	value: string;
	status?: "pass" | "fail" | "unknown";
}

export interface SectionContextCapsule {
	schema: typeof SECTION_CONTEXT_CAPSULE_SCHEMA;
	intent: string;
	currentGoal: string | null;
	activeTodos: SectionTodo[];
	decisions: string[];
	filesRead: string[];
	filesChanged: string[];
	commandsRun: SectionEvidence[];
	verification: SectionEvidence[];
	risks: string[];
	nextAction: string;
	memoryCandidates: string[];
	explorationSummary: string;
}

export interface SectionContextInput {
	intent?: string;
	currentGoal?: string | null;
	todos?: SectionTodo[];
	evidence?: SectionEvidence[];
	nextAction?: string;
	explorationNotes?: string[];
}

function unique(values: string[]): string[] {
	return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function compactNotes(notes: string[], maxChars: number): string {
	const joined = notes
		.map((note) => note.trim())
		.filter(Boolean)
		.join("\n");
	if (joined.length <= maxChars) return joined;
	return `${joined.slice(0, maxChars - 15).trimEnd()}\n...[compressed]`;
}

export function createSectionContextCapsule(input: SectionContextInput): SectionContextCapsule {
	const evidence = input.evidence ?? [];
	return {
		schema: SECTION_CONTEXT_CAPSULE_SCHEMA,
		intent: input.intent?.trim() || "unknown",
		currentGoal: input.currentGoal?.trim() || null,
		activeTodos: (input.todos ?? []).filter((todo) => todo.status !== "completed"),
		decisions: unique(evidence.filter((item) => item.kind === "decision").map((item) => item.value)),
		filesRead: unique(evidence.filter((item) => item.kind === "file_read").map((item) => item.value)),
		filesChanged: unique(evidence.filter((item) => item.kind === "file_changed").map((item) => item.value)),
		commandsRun: evidence.filter((item) => item.kind === "command"),
		verification: evidence.filter((item) => item.kind === "verification"),
		risks: unique(evidence.filter((item) => item.kind === "risk").map((item) => item.value)),
		nextAction: input.nextAction?.trim() || "continue from latest verified todo",
		memoryCandidates: unique(evidence.filter((item) => item.kind === "memory").map((item) => item.value)),
		explorationSummary: compactNotes(input.explorationNotes ?? [], 1200),
	};
}

export function renderSectionContextCapsule(capsule: SectionContextCapsule): string {
	return [
		`Intent: ${capsule.intent}`,
		`Goal: ${capsule.currentGoal ?? "none"}`,
		`Active todos: ${JSON.stringify(capsule.activeTodos)}`,
		`Files read: ${capsule.filesRead.join(", ") || "none"}`,
		`Files changed: ${capsule.filesChanged.join(", ") || "none"}`,
		`Verification: ${JSON.stringify(capsule.verification)}`,
		`Risks: ${capsule.risks.join("; ") || "none"}`,
		`Next action: ${capsule.nextAction}`,
		capsule.explorationSummary ? `Exploration summary:\n${capsule.explorationSummary}` : "",
	]
		.filter(Boolean)
		.join("\n");
}
