import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { Text } from "@amaze/tui";
import { formatBytes, procmgr } from "@amaze/utils";
import * as z from "zod/v4";
import type { ToolDefinition } from "../../extensibility/extensions";
import type { Theme } from "../../modes/theme/theme";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateTail } from "../../session/streaming-output";
import { replaceTabs, shortenPath } from "../../tools/render-utils";
import * as git from "../../utils/git";
import { parseWorkDirDirtyPaths } from "../git";
import {
	EXPERIMENT_MAX_BYTES,
	EXPERIMENT_MAX_LINES,
	formatElapsed,
	formatNum,
	killTree,
	parseAsiLines,
	parseMetricLines,
	tryGitPrefix,
	tryGitStatus,
} from "../helpers";
import { buildExperimentState, selectNextParent } from "../state";
import { openAutoresearchStorageIfExists } from "../storage";
import type { AutoresearchToolFactoryOptions, EvalStage, RunDetails, RunExperimentProgressDetails } from "../types";
import { DEFAULT_HARNESS_COMMAND } from "./init-experiment";

const runExperimentSchema = z.object({
	timeout_seconds: z.number().describe("timeout in seconds (default 600)").optional(),
	stage: z.enum(["full", "smoke", "staged"] as const).describe("evaluation stage (default full)").optional(),
	smoke_command: z.string().describe("command to run before full benchmark when stage is staged").optional(),
});

interface ProcessExecutionResult {
	exitCode: number | null;
	killed: boolean;
	logPath: string;
	output: string;
}
interface RunStageExecution {
	full: ProcessExecutionResult;
	smoke?: ProcessExecutionResult;
}

interface ProgressSnapshot {
	elapsed: string;
	runDirectory: string;
	fullOutputPath: string;
	tailOutput: string;
	truncation?: RunExperimentProgressDetails["truncation"];
}

export function createRunExperimentTool(
	options: AutoresearchToolFactoryOptions,
): ToolDefinition<typeof runExperimentSchema, RunDetails | RunExperimentProgressDetails> {
	return {
		name: "run_experiment",
		label: "Run Experiment",
		description:
			"Run any benchmark command. Output is captured automatically; `METRIC name=value` and `ASI key=value` lines printed by the command are parsed.",
		parameters: runExperimentSchema,
		defaultInactive: true,
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const storage = await openAutoresearchStorageIfExists(ctx.cwd);
			const currentBranch = (await git.branch.current(ctx.cwd)) ?? null;
			const session = storage?.getActiveSessionForBranch(currentBranch) ?? null;
			if (!storage || !session) {
				return {
					content: [
						{
							type: "text",
							text: "Error: no active autoresearch session for the current branch. Call init_experiment first.",
						},
					],
				};
			}

			const stage: EvalStage = params.stage ?? "full";
			if (stage === "staged" && (!params.smoke_command || params.smoke_command.trim().length === 0)) {
				return {
					content: [{ type: "text", text: "Error: staged eval requires smoke_command." }],
				};
			}
			const runtime = options.getRuntime(ctx);

			const abandonedPriorRun = (() => {
				const pending = storage.getPendingRun(session.id);
				if (!pending) return null;
				storage.abandonPendingRuns(session.id);
				return pending.id;
			})();

			const resolvedCommand = DEFAULT_HARNESS_COMMAND;
			const smokeCommand = stage === "smoke" ? DEFAULT_HARNESS_COMMAND : stage === "staged" ? params.smoke_command?.trim() : undefined;
			const preRunStatus = await tryGitStatus(ctx.cwd);
			const workDirPrefix = await tryGitPrefix(ctx.cwd);
			const preRunDirtyPaths = parseWorkDirDirtyPaths(preRunStatus, workDirPrefix);
			const stateBeforeRun = buildExperimentState(session, storage.listLoggedRuns(session.id));
			const parent = selectNextParent(stateBeforeRun.results, session.currentSegment, session.direction, session.parentSelectionStrategy);

			const startedAt = Date.now();
			const insertedRun = storage.insertRun({
				sessionId: session.id,
				segment: session.currentSegment,
				command: resolvedCommand,
				logPath: "", // patched after we know the run id
				preRunDirtyPaths,
				startedAt,
				parentRunId: parent.runNumber,
				selectionStrategy: parent.strategy,
			});

			const runDirectory = path.join(storage.projectDir, "runs", String(insertedRun.id).padStart(4, "0"));
			const benchmarkLogPath = path.join(runDirectory, "benchmark.log");
			const smokeLogPath = path.join(runDirectory, "smoke.log");
			fs.mkdirSync(runDirectory, { recursive: true });
			storage.updateRunLogPath(insertedRun.id, benchmarkLogPath);

			runtime.lastRunDuration = null;
			runtime.lastRunAsi = null;
			runtime.lastRunArtifactDir = runDirectory;
			runtime.lastRunNumber = insertedRun.id;
			runtime.lastRunSummary = null;
			runtime.runningExperiment = {
				startedAt,
				command: resolvedCommand,
				runDirectory,
				runNumber: insertedRun.id,
			};
			options.dashboard.updateWidget(ctx, runtime);
			options.dashboard.requestRender();

			const timeoutMs = Math.max(0, Math.floor((params.timeout_seconds ?? 600) * 1000));
			let execution: RunStageExecution;
			try {
				execution = await executeRunStages({
					stage,
					smokeCommand,
					fullCommand: resolvedCommand,
					cwd: ctx.cwd,
					smokeLogPath,
					benchmarkLogPath,
					timeoutMs,
					signal,
					onProgress: details => {
						onUpdate?.({
							content: [{ type: "text", text: details.tailOutput }],
							details: {
								phase: "running",
								elapsed: details.elapsed,
								truncation: details.truncation,
								fullOutputPath: details.fullOutputPath,
								runDirectory: details.runDirectory,
							},
						});
					},
				});
			} finally {
				runtime.runningExperiment = null;
				options.dashboard.updateWidget(ctx, runtime);
				options.dashboard.requestRender();
			}
			const fullExecution = execution.full;

			const completedAt = Date.now();
			const durationMs = completedAt - startedAt;
			const durationSeconds = durationMs / 1000;
			runtime.lastRunDuration = durationSeconds;

			const llmTruncation = truncateTail(fullExecution.output, {
				maxBytes: EXPERIMENT_MAX_BYTES,
				maxLines: EXPERIMENT_MAX_LINES,
			});
			const displayTruncation = truncateTail(fullExecution.output, {
				maxBytes: DEFAULT_MAX_BYTES,
				maxLines: DEFAULT_MAX_LINES,
			});

			const parsedMetricsMap = parseMetricLines(fullExecution.output);
			const parsedMetrics = parsedMetricsMap.size > 0 ? Object.fromEntries(parsedMetricsMap.entries()) : null;
			const parsedPrimary = parsedMetricsMap.get(session.primaryMetric) ?? null;
			const parsedAsi = mergeStageAsi(execution.smoke, parseAsiLines(fullExecution.output), stage);
			runtime.lastRunAsi = parsedAsi;

			storage.markRunCompleted({
				runId: insertedRun.id,
				completedAt,
				durationMs,
				exitCode: fullExecution.exitCode,
				timedOut: fullExecution.killed,
				parsedPrimary,
				parsedMetrics,
				parsedAsi,
			});

			const passed = fullExecution.exitCode === 0 && !fullExecution.killed;
			const crashed = fullExecution.exitCode !== 0 || fullExecution.killed;
			const resultDetails: RunDetails = {
				runNumber: insertedRun.id,
				runDirectory,
				benchmarkLogPath,
				evalStage: stage,
				command: resolvedCommand,
				exitCode: fullExecution.exitCode,
				durationSeconds,
				passed,
				crashed,
				timedOut: fullExecution.killed,
				tailOutput: displayTruncation.content,
				parsedMetrics,
				parsedPrimary,
				parsedAsi,
				metricName: session.primaryMetric,
				metricUnit: session.metricUnit,
				preRunDirtyPaths,
				abandonedPriorRun,
				parentRunNumber: parent.runNumber,
				selectionStrategy: parent.strategy,
				truncation: llmTruncation.truncated ? llmTruncation : undefined,
				fullOutputPath: fullExecution.logPath,
			};
			await writeRunArtifacts(ctx.cwd, resultDetails, execution, smokeCommand ?? null, startedAt, completedAt);

			runtime.lastRunSummary = {
				command: resolvedCommand,
				durationSeconds,
				parsedAsi,
				parsedMetrics,
				parsedPrimary,
				passed,
				preRunDirtyPaths,
				runDirectory,
				runNumber: insertedRun.id,
				exitCode: fullExecution.exitCode,
				timedOut: fullExecution.killed,
			};
			runtime.autoResumeArmed = true;
			runtime.lastAutoResumePendingRunNumber = null;

			// Refresh state to reflect any prior abandonment changes (logged set unchanged).
			const refreshedSession = storage.getSessionById(session.id);
			if (refreshedSession) {
				runtime.state = buildExperimentState(refreshedSession, storage.listLoggedRuns(session.id));
			}
			options.dashboard.updateWidget(ctx, runtime);
			options.dashboard.requestRender();

			const headerLines: string[] = [];
			if (abandonedPriorRun !== null) {
				headerLines.push(`Note: abandoned prior pending run #${abandonedPriorRun} before starting this run.`);
			}
			const warningPrefix = headerLines.length > 0 ? `${headerLines.join("\n")}\n\n` : "";

			return {
				content: [
					{
						type: "text",
						text: warningPrefix + buildRunText(resultDetails, llmTruncation.content, runtime.state.bestMetric),
					},
				],
				details: resultDetails,
			};
		},
		renderCall(_args, _options, theme): Text {
			return new Text(
				`${theme.fg("toolTitle", theme.bold("run_experiment"))} ${theme.fg("muted", DEFAULT_HARNESS_COMMAND)}`,
				0,
				0,
			);
		},
		renderResult(result, options, theme): Text {
			if (isProgressDetails(result.details)) {
				const header = theme.fg("warning", `Running ${result.details.elapsed}...`);
				const preview = replaceTabs(result.content.find(part => part.type === "text")?.text ?? "");
				return new Text(preview ? `${header}\n${theme.fg("dim", preview)}` : header, 0, 0);
			}
			const details = result.details;
			if (!details || !isRunDetails(details)) {
				return new Text(replaceTabs(result.content.find(part => part.type === "text")?.text ?? ""), 0, 0);
			}
			const statusText = renderStatus(details, theme);
			if (!options.expanded && details.tailOutput.trim().length === 0) {
				return new Text(statusText, 0, 0);
			}
			const preview = replaceTabs(
				options.expanded ? details.tailOutput : details.tailOutput.split("\n").slice(-5).join("\n"),
			);
			const suffix =
				options.expanded && details.truncation && details.fullOutputPath
					? `\n${theme.fg("warning", `Full output: ${shortenPath(details.fullOutputPath)}`)}`
					: "";
			return new Text(preview ? `${statusText}\n${theme.fg("dim", preview)}${suffix}` : statusText, 0, 0);
		},
	};
}
async function writeRunArtifacts(
	cwd: string,
	details: RunDetails,
	execution: RunStageExecution,
	smokeCommand: string | null,
	startedAt: number,
	completedAt: number,
): Promise<void> {
	const metadata = {
		schema_version: 1,
		run_id: details.runNumber,
		parent_run_id: details.parentRunNumber,
		parent_selection_strategy: details.selectionStrategy,
		eval_stage: details.evalStage,
		command: details.command,
		smoke_command: smokeCommand,
		started_at: new Date(startedAt).toISOString(),
		completed_at: new Date(completedAt).toISOString(),
		duration_seconds: details.durationSeconds,
		exit_code: details.exitCode,
		timed_out: details.timedOut,
		passed: details.passed,
		crashed: details.crashed,
		logs: {
			benchmark: path.basename(details.benchmarkLogPath),
			smoke: execution.smoke ? "smoke.log" : null,
		},
	};
	const metrics = {
		schema_version: 1,
		primary_metric: details.metricName,
		primary_value: details.parsedPrimary,
		primary_unit: details.metricUnit,
		metrics: details.parsedMetrics ?? {},
		asi: details.parsedAsi ?? {},
	};
	await fs.promises.writeFile(path.join(details.runDirectory, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`);
	await fs.promises.writeFile(path.join(details.runDirectory, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`);
	await fs.promises.writeFile(path.join(details.runDirectory, "patch.diff"), await readWorktreeDiff(cwd));
}

async function readWorktreeDiff(cwd: string): Promise<string> {
	try {
		return await git.diff(cwd, { allowFailure: true });
	} catch {
		return "";
	}
}

async function executeRunStages(opts: {
	stage: EvalStage;
	smokeCommand?: string;
	fullCommand: string;
	cwd: string;
	smokeLogPath: string;
	benchmarkLogPath: string;
	timeoutMs: number;
	signal?: AbortSignal;
	onProgress?(details: ProgressSnapshot): void;
}): Promise<RunStageExecution> {
	if (opts.stage === "full") {
		return {
			full: await executeProcess({
				command: ["bash", "-lc", opts.fullCommand],
				cwd: opts.cwd,
				logPath: opts.benchmarkLogPath,
				timeoutMs: opts.timeoutMs,
				signal: opts.signal,
				onProgress: opts.onProgress,
			}),
		};
	}

	const smokeCommand = opts.smokeCommand ?? opts.fullCommand;
	const smoke = await executeProcess({
		command: ["bash", "-lc", smokeCommand],
		cwd: opts.cwd,
		logPath: opts.smokeLogPath,
		timeoutMs: opts.timeoutMs,
		signal: opts.signal,
		onProgress: opts.onProgress,
	});
	if (opts.stage === "smoke" || smoke.exitCode !== 0 || smoke.killed) {
		return { full: smoke, smoke: opts.stage === "staged" ? smoke : undefined };
	}

	const full = await executeProcess({
		command: ["bash", "-lc", opts.fullCommand],
		cwd: opts.cwd,
		logPath: opts.benchmarkLogPath,
		timeoutMs: opts.timeoutMs,
		signal: opts.signal,
		onProgress: opts.onProgress,
	});
	return { full, smoke };
}

function mergeStageAsi(
	smoke: ProcessExecutionResult | undefined,
	fullAsi: ReturnType<typeof parseAsiLines>,
	stage: EvalStage,
): ReturnType<typeof parseAsiLines> {
	const smokeAsi = smoke ? parseAsiLines(smoke.output) : null;
	if (!smokeAsi && !fullAsi && stage === "full") return null;
	return {
		...(smokeAsi ?? {}),
		...(fullAsi ?? {}),
		eval_stage: stage,
		smoke_passed: smoke ? smoke.exitCode === 0 && !smoke.killed : stage === "full" ? null : true,
	};
}

async function executeProcess(opts: {
	command: string[];
	cwd: string;
	logPath: string;
	timeoutMs: number;
	signal?: AbortSignal;
	onProgress?(details: ProgressSnapshot): void;
}): Promise<ProcessExecutionResult> {
	const { promise, resolve, reject } = Promise.withResolvers<ProcessExecutionResult>();
	const child = childProcess.spawn(opts.command[0] ?? "bash", opts.command.slice(1), {
		cwd: opts.cwd,
		env: procmgr.scrubProcessEnv(process.env),
		detached: true,
		stdio: ["ignore", "pipe", "pipe"],
	});

	const tailChunks: Buffer[] = [];
	let chunksBytes = 0;
	let killedByTimeout = false;
	let resolved = false;
	let writeStream: fs.WriteStream | undefined = fs.createWriteStream(opts.logPath);
	let forceKillTimeout: NodeJS.Timeout | undefined;

	const closeWriteStream = (): Promise<void> => {
		if (!writeStream) return Promise.resolve();
		const stream = writeStream;
		writeStream = undefined;
		return new Promise<void>((resolveClose, rejectClose) => {
			stream.end((error?: Error | null) => {
				if (error) {
					rejectClose(error);
					return;
				}
				resolveClose();
			});
		});
	};

	const cleanup = (): void => {
		if (progressTimer) clearInterval(progressTimer);
		if (timeoutHandle) clearTimeout(timeoutHandle);
		if (forceKillTimeout) clearTimeout(forceKillTimeout);
		opts.signal?.removeEventListener("abort", abortHandler);
	};

	const finish = (callback: () => void): void => {
		if (resolved) return;
		resolved = true;
		cleanup();
		callback();
	};

	const appendChunk = (data: Buffer): void => {
		writeStream?.write(data);
		tailChunks.push(data);
		chunksBytes += data.length;
		while (chunksBytes > DEFAULT_MAX_BYTES * 2 && tailChunks.length > 1) {
			const removed = tailChunks.shift();
			if (removed) chunksBytes -= removed.length;
		}
	};

	const snapshot = (): ProgressSnapshot => {
		const tail = truncateTail(Buffer.concat(tailChunks).toString("utf8"), {
			maxBytes: DEFAULT_MAX_BYTES,
			maxLines: DEFAULT_MAX_LINES,
		});
		return {
			elapsed: formatElapsed(Date.now() - startedAt),
			runDirectory: path.dirname(opts.logPath),
			fullOutputPath: opts.logPath,
			tailOutput: tail.content,
			truncation: tail.truncated ? tail : undefined,
		};
	};

	const killTreeWithEscalation = (): void => {
		if (!child.pid) return;
		killTree(child.pid);
		forceKillTimeout = setTimeout(() => {
			if (child.pid) killTree(child.pid, "SIGKILL");
		}, 1_000);
		forceKillTimeout.unref?.();
	};

	const startedAt = Date.now();
	const progressTimer = opts.onProgress
		? setInterval(() => {
				opts.onProgress?.(snapshot());
			}, 1000)
		: undefined;
	const timeoutHandle =
		opts.timeoutMs > 0
			? setTimeout(() => {
					killedByTimeout = true;
					killTreeWithEscalation();
				}, opts.timeoutMs)
			: undefined;

	const abortHandler = (): void => {
		killTreeWithEscalation();
	};
	if (opts.signal?.aborted) {
		abortHandler();
	} else {
		opts.signal?.addEventListener("abort", abortHandler, { once: true });
	}

	child.stdout?.on("data", data => {
		appendChunk(data);
	});
	child.stderr?.on("data", data => {
		appendChunk(data);
	});
	child.on("error", error => {
		void closeWriteStream().finally(() => {
			finish(() => reject(error));
		});
	});
	child.on("close", async code => {
		try {
			await closeWriteStream();
			if (opts.signal?.aborted) {
				finish(() => reject(new Error("aborted")));
				return;
			}
			const output = await fs.promises.readFile(opts.logPath, "utf8");
			finish(() =>
				resolve({
					exitCode: code,
					killed: killedByTimeout,
					logPath: opts.logPath,
					output,
				}),
			);
		} catch (error) {
			finish(() => reject(error));
		}
	});

	return promise;
}

function buildRunText(details: RunDetails, outputPreview: string, bestMetric: number | null): string {
	const lines: string[] = [];
	lines.push(`Run #${details.runNumber} directory: ${details.runDirectory}`);
	lines.push(`Eval stage: ${details.evalStage}`);
	if (details.parentRunNumber !== null) {
		lines.push(`Parent run: #${details.parentRunNumber} (${details.selectionStrategy})`);
	} else {
		lines.push(`Parent run: none (${details.selectionStrategy})`);
	}
	if (details.timedOut) {
		lines.push(`TIMEOUT after ${details.durationSeconds.toFixed(1)}s`);
	} else if (details.exitCode !== 0) {
		lines.push(`FAILED with exit code ${details.exitCode} in ${details.durationSeconds.toFixed(1)}s`);
	} else {
		lines.push(`PASSED in ${details.durationSeconds.toFixed(1)}s`);
	}
	if (bestMetric !== null) {
		lines.push(`Current baseline ${details.metricName}: ${formatNum(bestMetric, details.metricUnit)}`);
	}
	if (details.parsedPrimary !== null) {
		lines.push(`Parsed ${details.metricName}: ${details.parsedPrimary}`);
		lines.push(`Next log_experiment metric: ${details.parsedPrimary}`);
	}
	if (details.parsedMetrics) {
		const secondaryEntries = Object.entries(details.parsedMetrics)
			.filter(([name]) => name !== details.metricName)
			.map(([name, value]) => [name, value] as const);
		const secondary = secondaryEntries.map(([name, value]) => `${name}=${value}`);
		if (secondary.length > 0) {
			lines.push(`Parsed metrics: ${secondary.join(", ")}`);
			lines.push(`Next log_experiment metrics: ${JSON.stringify(Object.fromEntries(secondaryEntries))}`);
		}
	}
	if (details.parsedAsi) {
		lines.push(`Parsed ASI keys: ${Object.keys(details.parsedAsi).join(", ")}`);
	}
	lines.push("");
	lines.push(outputPreview);
	if (details.truncation && details.fullOutputPath) {
		lines.push("");
		lines.push(
			`Output truncated (${formatBytes(EXPERIMENT_MAX_BYTES)} limit). Full output: ${details.fullOutputPath}`,
		);
	}
	return lines.join("\n").trimEnd();
}

function renderStatus(details: RunDetails, theme: Theme): string {
	if (details.timedOut) {
		return theme.fg("error", `TIMEOUT ${details.durationSeconds.toFixed(1)}s`);
	}
	if (details.exitCode !== 0) {
		return theme.fg("error", `FAIL exit=${details.exitCode} ${details.durationSeconds.toFixed(1)}s`);
	}
	const metric =
		details.parsedPrimary !== null
			? ` ${details.metricName}=${formatNum(details.parsedPrimary, details.metricUnit)}`
			: "";
	return theme.fg("success", `PASS ${details.durationSeconds.toFixed(1)}s${metric}`);
}

function isRunDetails(value: unknown): value is RunDetails {
	if (typeof value !== "object" || value === null) return false;
	return "command" in value && "durationSeconds" in value;
}

function isProgressDetails(value: unknown): value is RunExperimentProgressDetails {
	if (typeof value !== "object" || value === null) return false;
	return "phase" in value && (value as { phase: unknown }).phase === "running";
}
