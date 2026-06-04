import type { MemoryBackend } from "./types";

/** No-op memory backend. */
export const offBackend: MemoryBackend = {
	id: "off",
	async start() {},
	async buildDeveloperInstructions() {
		return undefined;
	},
	async clear() {},
	async enqueue() {},
};
