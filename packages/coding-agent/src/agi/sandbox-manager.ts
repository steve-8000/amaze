export interface SandboxWorkspace {
	id: string;
	missionId: string;
	actionId: string;
	mode: "isolated-worktree" | "remote-sandbox";
	cwd: string;
	baselineRef: string;
	createdAt: number;
}

export interface SandboxManager {
	create(input: { missionId: string; actionId: string; cwd: string; baselineRef?: string }): Promise<SandboxWorkspace>;
	captureDiff(workspaceId: string): Promise<{ diffRef: string; contentHash: string }>;
	applyToMain(workspaceId: string): Promise<{ appliedRef: string; rollbackRef: string }>;
	rollback(input: { rollbackRef: string; reason: string }): Promise<void>;
	dispose(workspaceId: string): Promise<void>;
}

export class InMemorySandboxManager implements SandboxManager {
	readonly #workspaces = new Map<string, SandboxWorkspace>();
	readonly #now: () => number;

	constructor(input: { now?: () => number } = {}) {
		this.#now = input.now ?? Date.now;
	}

	async create(input: {
		missionId: string;
		actionId: string;
		cwd: string;
		baselineRef?: string;
	}): Promise<SandboxWorkspace> {
		const workspace: SandboxWorkspace = {
			id: `sandbox-${input.missionId}-${input.actionId}`,
			missionId: input.missionId,
			actionId: input.actionId,
			mode: "isolated-worktree",
			cwd: input.cwd,
			baselineRef: input.baselineRef ?? "HEAD",
			createdAt: this.#now(),
		};
		this.#workspaces.set(workspace.id, workspace);
		return workspace;
	}

	async captureDiff(workspaceId: string): Promise<{ diffRef: string; contentHash: string }> {
		this.#require(workspaceId);
		return { diffRef: `sandbox-diff://${workspaceId}`, contentHash: workspaceId };
	}

	async applyToMain(workspaceId: string): Promise<{ appliedRef: string; rollbackRef: string }> {
		this.#require(workspaceId);
		return { appliedRef: `sandbox-applied://${workspaceId}`, rollbackRef: `rollback://${workspaceId}` };
	}

	async rollback(input: { rollbackRef: string; reason: string }): Promise<void> {
		if (!input.rollbackRef || !input.reason) throw new Error("rollback requires rollbackRef and reason");
	}

	async dispose(workspaceId: string): Promise<void> {
		this.#workspaces.delete(workspaceId);
	}

	#require(workspaceId: string): SandboxWorkspace {
		const workspace = this.#workspaces.get(workspaceId);
		if (!workspace) throw new Error(`Sandbox workspace not found: ${workspaceId}`);
		return workspace;
	}
}
