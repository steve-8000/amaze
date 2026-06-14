import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

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

interface ManagedWorkspace extends SandboxWorkspace {
	repoCwd: string;
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

export class GitWorktreeSandboxManager implements SandboxManager {
	readonly #workspaces = new Map<string, ManagedWorkspace>();
	readonly #rootDir: string;
	readonly #now: () => number;

	constructor(input: { rootDir: string; now?: () => number }) {
		this.#rootDir = input.rootDir;
		this.#now = input.now ?? Date.now;
	}

	async create(input: {
		missionId: string;
		actionId: string;
		cwd: string;
		baselineRef?: string;
	}): Promise<SandboxWorkspace> {
		const baselineRef = input.baselineRef ?? (await git(input.cwd, ["rev-parse", "HEAD"])).trim();
		const id = safeId(`sandbox-${input.missionId}-${input.actionId}-${this.#now()}`);
		const workspaceCwd = path.join(this.#rootDir, id);
		await fs.mkdir(this.#rootDir, { recursive: true });
		await git(input.cwd, ["worktree", "add", "--detach", workspaceCwd, baselineRef]);
		const workspace: ManagedWorkspace = {
			id,
			missionId: input.missionId,
			actionId: input.actionId,
			mode: "isolated-worktree",
			cwd: workspaceCwd,
			baselineRef,
			repoCwd: input.cwd,
			createdAt: this.#now(),
		};
		this.#workspaces.set(workspace.id, workspace);
		return publicWorkspace(workspace);
	}

	async captureDiff(workspaceId: string): Promise<{ diffRef: string; contentHash: string }> {
		const workspace = this.#require(workspaceId);
		const diff = await git(workspace.cwd, ["diff", "--binary", workspace.baselineRef, "--"]);
		const contentHash = sha256(diff);
		const diffPath = path.join(this.#rootDir, `${workspace.id}-${contentHash}.patch`);
		await fs.writeFile(diffPath, diff, "utf8");
		return { diffRef: diffPath, contentHash };
	}

	async applyToMain(workspaceId: string): Promise<{ appliedRef: string; rollbackRef: string }> {
		const workspace = this.#require(workspaceId);
		// Preflight: the main repo must still sit on the baseline the sandbox forked from,
		// and its tracked tree must be clean, before we apply. This prevents the runtime
		// from silently overwriting unrelated work committed/staged since sandbox creation.
		const rollbackRef = (await git(workspace.repoCwd, ["rev-parse", "HEAD"])).trim();
		const baselineSha = (await git(workspace.repoCwd, ["rev-parse", workspace.baselineRef])).trim();
		if (rollbackRef !== baselineSha) {
			throw new Error(
				`sandbox apply preflight failed: main HEAD ${rollbackRef} drifted from baseline ${baselineSha}`,
			);
		}
		if (!(await this.#workingTreeClean(workspace.repoCwd))) {
			throw new Error("sandbox apply preflight failed: main repo working tree is not clean");
		}
		const diff = await git(workspace.cwd, ["diff", "--binary", workspace.baselineRef, "--"]);
		let appliedTreeHash = baselineSha;
		if (diff.trim()) {
			const patchPath = path.join(this.#rootDir, `${workspace.id}-apply.patch`);
			await fs.writeFile(patchPath, diff, "utf8");
			// Verify the patch applies cleanly before mutating the index/working tree.
			const check = await gitExitCode(workspace.repoCwd, ["apply", "--check", "--index", patchPath]);
			if (check !== 0) {
				throw new Error(`sandbox apply preflight failed: patch does not apply cleanly to main repo`);
			}
			await git(workspace.repoCwd, ["apply", "--index", patchPath]);
			appliedTreeHash = (await git(workspace.repoCwd, ["write-tree"])).trim();
		}
		return { appliedRef: `git-worktree://${workspace.id}#${appliedTreeHash}`, rollbackRef };
	}

	async rollback(input: { rollbackRef: string; reason: string }): Promise<void> {
		if (!input.rollbackRef || !input.reason) throw new Error("rollback requires rollbackRef and reason");
		for (const workspace of this.#workspaces.values()) {
			// Only reset when main HEAD still points at the rollback target. If HEAD has
			// advanced past it (new commits landed after apply), a hard reset would destroy
			// that history — refuse instead of clobbering it.
			const head = (await git(workspace.repoCwd, ["rev-parse", "HEAD"])).trim();
			const target = (await git(workspace.repoCwd, ["rev-parse", input.rollbackRef])).trim();
			if (head !== target) {
				throw new Error(`sandbox rollback refused: main HEAD ${head} advanced past rollback target ${target}`);
			}
			await git(workspace.repoCwd, ["reset", "--hard", input.rollbackRef]);
			return;
		}
		throw new Error(`No sandbox workspace available for rollback ref: ${input.rollbackRef}`);
	}

	async #workingTreeClean(repoCwd: string): Promise<boolean> {
		const unstaged = await gitExitCode(repoCwd, ["diff", "--quiet"]);
		const staged = await gitExitCode(repoCwd, ["diff", "--cached", "--quiet"]);
		return unstaged === 0 && staged === 0;
	}

	async dispose(workspaceId: string): Promise<void> {
		const workspace = this.#workspaces.get(workspaceId);
		if (!workspace) return;
		await git(workspace.repoCwd, ["worktree", "remove", "--force", workspace.cwd]);
		this.#workspaces.delete(workspaceId);
	}

	#require(workspaceId: string): ManagedWorkspace {
		const workspace = this.#workspaces.get(workspaceId);
		if (!workspace) throw new Error(`Sandbox workspace not found: ${workspaceId}`);
		return workspace;
	}
}

function publicWorkspace(workspace: ManagedWorkspace): SandboxWorkspace {
	return {
		id: workspace.id,
		missionId: workspace.missionId,
		actionId: workspace.actionId,
		mode: workspace.mode,
		cwd: workspace.cwd,
		baselineRef: workspace.baselineRef,
		createdAt: workspace.createdAt,
	};
}

function safeId(value: string): string {
	return value.replace(/[^a-zA-Z0-9_.-]/g, "-");
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

async function git(cwd: string, args: string[]): Promise<string> {
	return gitWithInput(cwd, args);
}

async function gitWithInput(cwd: string, args: string[]): Promise<string> {
	const proc = Bun.spawn(["git", ...args], {
		cwd,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr.trim() || stdout.trim()}`);
	return stdout;
}

/** Runs git and returns the raw exit code without throwing — used for `--quiet`/`--check` probes. */
async function gitExitCode(cwd: string, args: string[]): Promise<number> {
	const proc = Bun.spawn(["git", ...args], {
		cwd,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	const [, , exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return exitCode;
}
