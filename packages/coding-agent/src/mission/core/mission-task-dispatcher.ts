import type { Mission } from "./mission";
import type { MissionTask } from "./mission-task";

export interface DispatchContext {
	scopeGuard: Mission["scopeGuard"];
	evidenceRefs: Mission["evidenceRefs"];
	recordAttempt: (taskId: string, attempt: "success" | "failure", note?: string) => void;
}

export interface MissionTaskDispatchResult {
	completedTaskIds: string[];
	failedTaskIds: string[];
	blocked: boolean;
}

interface MissionTaskRunnerLike {
	run(
		options: {
			cwd: string;
			agent: { name: string; description: string; systemPrompt: string; source: "bundled" };
			task: string;
			description: string;
			index: number;
			id: string;
			persistArtifacts: true;
		},
		task: MissionTask,
	): Promise<{ evidenceRefs: string[]; task: MissionTask; result: { error?: string } }>;
}

type MissionTaskRunnerFactory = (task: MissionTask) => MissionTaskRunnerLike;

function defaultRunnerFactory(task: MissionTask): MissionTaskRunnerLike {
	return {
		async run() {
			throw new Error(
				`Mission task ${task.id} requires an injected dispatcher runner; no default subagent runner is available in this runtime path.`,
			);
		},
	};
}

export class MissionTaskDispatcher {
	readonly #runnerFactory: MissionTaskRunnerFactory;

	constructor(runnerFactory: MissionTaskRunnerFactory = defaultRunnerFactory) {
		this.#runnerFactory = runnerFactory;
	}

	async run(tasks: Mission["tasks"], ctx: DispatchContext): Promise<MissionTaskDispatchResult> {
		const completedTaskIds: string[] = [];
		const failedTaskIds: string[] = [];
		let blocked = false;

		for (const task of tasks) {
			try {
				const runner = this.#runnerFactory(task);
				const result = await runner.run(
					{
						cwd: process.cwd(),
						agent: {
							name: task.assignedAgent ?? "Builder",
							description: task.title,
							systemPrompt: "Execute the assigned mission task.",
							source: "bundled",
						},
						task: task.objective ?? task.title,
						description: task.title,
						index: 0,
						id: task.id,
						persistArtifacts: true,
					},
					task,
				);
				if (result.evidenceRefs.length > 0) ctx.evidenceRefs.push(...result.evidenceRefs);
				if (result.task.status === "completed") {
					completedTaskIds.push(task.id);
					ctx.recordAttempt(task.id, "success");
				} else if (result.task.status === "blocked") {
					blocked = true;
					ctx.recordAttempt(task.id, "failure", result.result.error ?? "Task blocked");
				} else {
					failedTaskIds.push(task.id);
					ctx.recordAttempt(task.id, "failure", result.result.error);
				}
			} catch (error) {
				failedTaskIds.push(task.id);
				ctx.recordAttempt(task.id, "failure", error instanceof Error ? error.message : String(error));
			}
		}

		return { completedTaskIds, failedTaskIds, blocked };
	}
}
