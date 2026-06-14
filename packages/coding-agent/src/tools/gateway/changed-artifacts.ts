/** Mutation artifact telemetry captured at the tool-gateway seam. */

import type { ToolExecutionContext } from "../registry/tool-descriptor";

export type ChangedArtifactOperation = "write" | "edit" | "delete" | "unknown" | "invalidate";

export interface ChangedArtifactEntry {
	id: string;
	tool: string;
	toolCallId: string;
	missionId?: string;
	taskId?: string;
	path?: string;
	operation: ChangedArtifactOperation;
	invalidatesWorkspace: boolean;
	ts: number;
}

export interface ChangedArtifactMutation {
	path?: string;
	operation: ChangedArtifactOperation;
	invalidatesWorkspace: boolean;
}

export interface ChangedArtifactSnapshotFilter {
	missionId?: string;
	taskId?: string;
	toolCallId?: string;
}

export interface ChangedArtifactRecordInput extends ChangedArtifactMutation {
	tool: string;
	toolCallId?: string;
	missionId?: string;
	taskId?: string | null;
	ts?: number;
}

/**
 * In-memory registry of successful workspace mutations observed by a session gateway.
 * The registry is intentionally decoupled from MissionStore; callers opt in by
 * passing an instance to SessionToolGateway and can snapshot it for tests or UI.
 */
export class ChangedArtifactRegistry {
	#entries: ChangedArtifactEntry[] = [];
	#nextId = 1;

	record(input: ChangedArtifactRecordInput): ChangedArtifactEntry {
		const ts = input.ts ?? Date.now();
		const entry: ChangedArtifactEntry = {
			id: `${ts}-${this.#nextId++}`,
			tool: input.tool,
			toolCallId: input.toolCallId ?? "",
			operation: input.operation,
			invalidatesWorkspace: input.invalidatesWorkspace,
			ts,
			...(input.missionId !== undefined ? { missionId: input.missionId } : {}),
			...(input.taskId != null ? { taskId: input.taskId } : {}),
			...(input.path !== undefined ? { path: input.path } : {}),
		};
		this.#entries.push(entry);
		return { ...entry };
	}

	snapshot(filter?: ChangedArtifactSnapshotFilter): ChangedArtifactEntry[] {
		const entries = !filter
			? this.#entries
			: this.#entries.filter(entry => {
					if (filter.missionId !== undefined && entry.missionId !== filter.missionId) return false;
					if (filter.taskId !== undefined && entry.taskId !== filter.taskId) return false;
					if (filter.toolCallId !== undefined && entry.toolCallId !== filter.toolCallId) return false;
					return true;
				});
		return entries.map(entry => ({ ...entry }));
	}

	clear(): void {
		this.#entries = [];
	}
}

export function extractChangedArtifactMutation(tool: string, input: unknown): ChangedArtifactMutation | undefined {
	const obj = input && typeof input === "object" ? (input as Record<string, unknown>) : undefined;
	const path = typeof obj?.path === "string" ? obj.path : undefined;

	switch (tool) {
		case "write":
			return withOptionalPath({ operation: "write", invalidatesWorkspace: false }, path);
		case "edit":
		case "ast_edit":
			return withOptionalPath({ operation: "edit", invalidatesWorkspace: false }, path);
		case "bash":
			return { operation: "invalidate", invalidatesWorkspace: true };
		default:
			return undefined;
	}
}

export function changedArtifactRecordFromContext(
	tool: string,
	ctx: ToolExecutionContext,
	mutation: ChangedArtifactMutation,
): ChangedArtifactRecordInput {
	const record: ChangedArtifactRecordInput = {
		tool,
		...mutation,
	};
	if (ctx.toolCallId !== undefined) record.toolCallId = ctx.toolCallId;
	if (ctx.mission?.missionId !== undefined) record.missionId = ctx.mission.missionId;
	if (ctx.mission?.taskId !== undefined) record.taskId = ctx.mission.taskId;
	return record;
}

function withOptionalPath(
	mutation: Omit<ChangedArtifactMutation, "path">,
	path: string | undefined,
): ChangedArtifactMutation {
	return path !== undefined ? { ...mutation, path } : mutation;
}
