import * as fs from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";
import { EventBus, type SessionEvent } from "../observability";

export interface ObserveTailArgs {
	filter?: string;
}

export interface ObserveExportArgs {
	session: string;
	since?: number;
	filter?: string;
	baseDir?: string;
}

export function runObserveTailCommand(args: ObserveTailArgs = {}): void {
	const bus = new EventBus();
	bus.subscribe(event => {
		if (matchesFilter(event, args.filter)) {
			process.stdout.write(`${JSON.stringify(event)}\n`);
		}
	});
}

export async function runObserveExportCommand(args: ObserveExportArgs): Promise<void> {
	if (!args.session) {
		throw new Error("observe export requires --session <id>");
	}

	const filePath = path.join(observabilityBaseDir(args.baseDir), "sessions", `${args.session}.jsonl`);
	let text: string;
	try {
		text = await fs.readFile(filePath, "utf8");
	} catch (error) {
		if (isNotFound(error)) return;
		throw error;
	}

	for (const line of text.split(/\r?\n/)) {
		if (line.length === 0) continue;
		const event = JSON.parse(line) as SessionEvent;
		if (args.since !== undefined && event.ts < args.since) continue;
		if (!matchesFilter(event, args.filter)) continue;
		process.stdout.write(`${line}\n`);
	}
}

function observabilityBaseDir(baseDir?: string): string {
	return (
		baseDir ??
		process.env.AMAZE_OBSERVABILITY_DIR ??
		path.join(process.env.HOME || homedir(), ".amaze", "observability")
	);
}

function matchesFilter(event: SessionEvent, filter?: string): boolean {
	return !filter || event.type === filter;
}

function isNotFound(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
