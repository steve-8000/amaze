import * as fs from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";
import type { MissionEvent } from "./events";

export type ReadMissionEventsOptions = {
	baseDir?: string;
};

export async function readMissionEvents(
	missionId: string,
	opts: ReadMissionEventsOptions = {},
): Promise<MissionEvent[]> {
	const baseDir = opts.baseDir ?? path.join(process.env.HOME || homedir(), ".amaze", "observability", "missions");
	const filePath = path.join(baseDir, `${missionId}.jsonl`);
	let content: string;
	try {
		content = await fs.readFile(filePath, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}

	const events: MissionEvent[] = [];
	for (const line of content.split("\n")) {
		if (line.trim() === "") continue;
		events.push(JSON.parse(line) as MissionEvent);
	}
	return events;
}
