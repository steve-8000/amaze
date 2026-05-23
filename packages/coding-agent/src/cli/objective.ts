import { type Objective, type ObjectiveStatus, ObjectiveStore } from "../autonomy";
import { Settings } from "../config/settings";

export interface ObjectiveBaseArgs {
	db?: string;
}

export interface ObjectiveCreateArgs extends ObjectiveBaseArgs {
	title: string;
	metric: string;
	target: number;
	direction: "up" | "down";
	deadline?: number;
}

export interface ObjectiveIdArgs extends ObjectiveBaseArgs {
	id: string;
}

const STATUSES: ObjectiveStatus[] = ["active", "paused", "completed", "cancelled"];

export function isObjectiveDirection(value: string | undefined): value is "up" | "down" {
	return value === "up" || value === "down";
}

export function isObjectiveStatus(value: string | undefined): value is ObjectiveStatus {
	return STATUSES.includes(value as ObjectiveStatus);
}

export async function runObjectiveCreateCommand(args: ObjectiveCreateArgs): Promise<void> {
	withStore(args.db, store => {
		const objective = store.create({
			title: args.title,
			metricTargets: [
				{ metric: args.metric, target: args.target, direction: args.direction, deadline: args.deadline },
			],
			budget: {},
			guardrails: { requireHumanForApply: true, maxAutoSubgoalsPerDay: 1, forbiddenScopes: [] },
		});
		process.stdout.write(`${formatObjective(objective)}\n`);
	});
}

export async function runObjectiveListCommand(args: ObjectiveBaseArgs): Promise<void> {
	withStore(args.db, store => {
		process.stdout.write(`${formatTable(store.list())}\n`);
	});
}

export async function runObjectiveShowCommand(args: ObjectiveIdArgs): Promise<void> {
	withStore(args.db, store => {
		const objective = requireObjective(store, args.id);
		process.stdout.write(`${JSON.stringify(objective, null, 2)}\n`);
	});
}

export async function runObjectivePauseCommand(args: ObjectiveIdArgs): Promise<void> {
	updateStatus(args, "paused");
}

export async function runObjectiveCancelCommand(args: ObjectiveIdArgs): Promise<void> {
	updateStatus(args, "cancelled");
}

export async function runObjectiveSetEnabledCommand(enabled: boolean): Promise<void> {
	try {
		const settings = await Settings.init();
		settings.set("autonomy.enabled" as never, enabled as never);
		await settings.flush();
		process.stdout.write(`autonomy.enabled=${enabled}\n`);
	} catch (error) {
		process.stdout.write(
			`Unable to write autonomy.enabled automatically. Edit your Amaze config manually and set autonomy.enabled: ${enabled}.\n${error instanceof Error ? error.message : String(error)}\n`,
		);
	}
}

function updateStatus(args: ObjectiveIdArgs, status: ObjectiveStatus): void {
	withStore(args.db, store => {
		const objective = store.updateStatus(args.id, status);
		process.stdout.write(`${formatObjective(objective)}\n`);
	});
}

function withStore<T>(dbPath: string | undefined, callback: (store: ObjectiveStore) => T): T {
	const store = new ObjectiveStore(dbPath);
	try {
		return callback(store);
	} finally {
		store.close?.();
	}
}

function requireObjective(store: ObjectiveStore, id: string): Objective {
	const objective = store.get(id);
	if (!objective) throw new Error(`Objective not found: ${id}`);
	return objective;
}

function formatObjective(objective: Objective): string {
	const target = objective.metricTargets[0];
	return `${objective.id}\t${objective.status}\t${objective.title}\t${target.metric} ${target.direction} ${target.target}`;
}

function formatTable(objectives: Objective[]): string {
	if (objectives.length === 0) return "No objectives";
	return [
		["ID", "STATUS", "TITLE", "TARGET"],
		...objectives.map(objective => {
			const target = objective.metricTargets[0];
			return [
				objective.id,
				objective.status,
				objective.title,
				`${target.metric} ${target.direction} ${target.target}`,
			];
		}),
	]
		.map(row => row.join("\t"))
		.join("\n");
}
