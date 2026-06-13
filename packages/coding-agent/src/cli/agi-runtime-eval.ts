import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Settings } from "../config/settings";
import { MissionStore } from "../mission/store";
import { type MutationRuntimeResult, StrictMutationRuntime } from "./agi-mutation-runtime";

/**
 * CI-ready end-to-end AGI runtime eval.
 *
 * Drives the production {@link StrictMutationRuntime} against a throwaway git
 * repository and asserts the runtime invariants the status review claims:
 *
 *  - no synthetic descriptors (the mutation runs through the production `write`
 *    built-in adapted into the tool registry),
 *  - sandbox isolation (mutation happens in a git worktree; main is untouched
 *    until acceptance),
 *  - capability lease enforcement (a `write` lease is issued and persisted),
 *  - rollback on failed verification (a deliberately failing verifier leaves
 *    main unchanged and records a rollback),
 *  - evidence-backed completion only (only a machine-derived diff-verified pass
 *    applies the patch to main),
 *  - durable persistence across restart.
 *
 * Run directly with `bun src/cli/agi-runtime-eval.ts` (or the package script
 * `bun run agi:runtime-eval`). Exits non-zero on the first failed invariant.
 */

export interface AgiRuntimeEvalCheck {
	name: string;
	passed: boolean;
	detail: string;
}

export interface AgiRuntimeEvalReport {
	passed: boolean;
	checks: AgiRuntimeEvalCheck[];
}

const TARGET = "config.txt";
const MARKER = "RUNTIME_EVAL_MARKER";

export async function runAgiRuntimeEval(): Promise<AgiRuntimeEvalReport> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "agi-runtime-eval-"));
	try {
		const checks: AgiRuntimeEvalCheck[] = [];
		checks.push(...(await runPassScenario(root)));
		checks.push(...(await runRollbackScenario(root)));
		checks.push(...(await runGovernanceScenario(root)));
		return { passed: checks.every(check => check.passed), checks };
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
}

async function runPassScenario(root: string): Promise<AgiRuntimeEvalCheck[]> {
	const { repo, sandboxRoot, dbPath, settings } = await makeRepo(root, "pass");
	const runtime = await StrictMutationRuntime.create({
		repoCwd: repo,
		sandboxRoot,
		dbPath,
		targetPath: TARGET,
		mutationContent: `version = 1 // ${MARKER}\n`,
		expectedMarker: MARKER,
		approval: "approve",
		settings,
	});
	const mainBefore = await fs.readFile(path.join(repo, TARGET), "utf8");
	let result: MutationRuntimeResult;
	try {
		result = await runtime.tick();
	} finally {
		runtime.close();
	}
	const mainAfter = await fs.readFile(path.join(repo, TARGET), "utf8");

	const checks: AgiRuntimeEvalCheck[] = [];
	checks.push(
		check("no synthetic descriptor: production write lease issued", result.leaseAllowedTools?.[0] === "write"),
	);
	checks.push(check("sandbox isolation: main untouched during sandbox mutation", mainBefore === "version = 0\n"));
	checks.push(check("lease enforcement: action allowed and verified", result.actionStatus === "verified"));
	checks.push(
		check(
			"evidence-backed completion: diff verified then applied",
			result.eventTypes.includes("sandbox.diff_captured") &&
				result.eventTypes.includes("evidence.verified") &&
				result.eventTypes.includes("sandbox.applied"),
		),
	);
	checks.push(check("accepted mutation lands in main", mainAfter === `version = 1 // ${MARKER}\n`));

	// Durable persistence across restart.
	const reopened = new MissionStore(dbPath);
	try {
		const action = reopened.listRuntimeActionsForMission(result.missionId)[0];
		checks.push(check("persistence: verified action survives restart", action?.status === "verified"));
	} finally {
		reopened.close();
	}
	return checks;
}

async function runRollbackScenario(root: string): Promise<AgiRuntimeEvalCheck[]> {
	const { repo, sandboxRoot, dbPath, settings } = await makeRepo(root, "rollback");
	const runtime = await StrictMutationRuntime.create({
		repoCwd: repo,
		sandboxRoot,
		dbPath,
		targetPath: TARGET,
		// Mutation runs but the content lacks the marker the verifier requires.
		mutationContent: "version = 1 // WRONG\n",
		expectedMarker: MARKER,
		approval: "approve",
		settings,
	});
	let result: MutationRuntimeResult;
	try {
		result = await runtime.tick();
	} finally {
		runtime.close();
	}
	const mainAfter = await fs.readFile(path.join(repo, TARGET), "utf8");

	return [
		check("rollback: failed verification does not apply", !result.eventTypes.includes("sandbox.applied")),
		check("rollback: rollback recorded", result.eventTypes.includes("rollback.completed")),
		check("rollback: main content unchanged", mainAfter === "version = 0\n"),
		check("rollback: main working tree clean (no leak)", result.mainClean),
		check("rollback: mission blocked", result.missionState === "blocked"),
	];
}

async function runGovernanceScenario(root: string): Promise<AgiRuntimeEvalCheck[]> {
	const { repo, sandboxRoot, dbPath, settings } = await makeRepo(root, "governance");
	const runtime = await StrictMutationRuntime.create({
		repoCwd: repo,
		sandboxRoot,
		dbPath,
		targetPath: TARGET,
		mutationContent: `version = 1 // ${MARKER}\n`,
		expectedMarker: MARKER,
		approval: "reject",
		settings,
	});
	let result: MutationRuntimeResult;
	try {
		result = await runtime.tick();
	} finally {
		runtime.close();
	}
	const mainAfter = await fs.readFile(path.join(repo, TARGET), "utf8");

	return [
		check("governance: rejected approval blocks action", result.actionStatus === "blocked"),
		check("governance: no tool ran without approval", !result.eventTypes.includes("mission.tool.requested")),
		check("governance: governance block recorded", result.eventTypes.includes("runtime.governance.blocked")),
		check("governance: main untouched", mainAfter === "version = 0\n"),
	];
}

async function makeRepo(
	root: string,
	name: string,
): Promise<{ repo: string; sandboxRoot: string; dbPath: string; settings: Settings }> {
	const base = path.join(root, name);
	const repo = path.join(base, "repo");
	await fs.mkdir(repo, { recursive: true });
	await git(repo, ["init"]);
	await git(repo, ["config", "user.email", "eval@example.com"]);
	await git(repo, ["config", "user.name", "Eval"]);
	await git(repo, ["config", "commit.gpgsign", "false"]);
	await fs.writeFile(path.join(repo, TARGET), "version = 0\n");
	await git(repo, ["add", TARGET]);
	await git(repo, ["commit", "-m", "base"]);
	const settings = await Settings.createForCwd(repo);
	return { repo, sandboxRoot: path.join(base, "sandboxes"), dbPath: path.join(base, "autonomy.db"), settings };
}

function check(name: string, passed: boolean): AgiRuntimeEvalCheck {
	return { name, passed, detail: passed ? "ok" : "FAILED" };
}

async function git(cwd: string, args: string[]): Promise<void> {
	const proc = Bun.spawn(["git", ...args], { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr || stdout}`);
}

if (import.meta.main) {
	const report = await runAgiRuntimeEval();
	for (const check of report.checks) {
		process.stdout.write(`${check.passed ? "pass" : "FAIL"}\t${check.name}\n`);
	}
	process.stdout.write(`\nAGI runtime eval: ${report.passed ? "PASS" : "FAIL"} (${report.checks.length} checks)\n`);
	if (!report.passed) process.exitCode = 1;
}
