import type { Settings } from "../config/settings";
import { hermesBackend } from "./hermes-backend";
import { mem0Backend } from "./mem0-backend";
import { offBackend } from "./off-backend";
import type { MemoryBackend } from "./types";

export function resolveMemoryBackend(settings: Settings): MemoryBackend {
	switch (settings.get("memory.backend")) {
		case "mem0":
			return mem0Backend;
		case "hermes":
			return hermesBackend;
		default:
			return offBackend;
	}
}
