import type { Settings } from "../config/settings";
import { nexusBackend } from "./nexus-backend";
import { offBackend } from "./off-backend";
import type { MemoryBackend } from "./types";

/**
 * Pick the active memory backend for a Settings instance.
 *
 * Selection rules (single source of truth — every memory consumer routes
 * through this):
 *   - `memory.backend === "nexus"`      → Nexus canonical local memory
 *   - everything else                   → no-op
 */
export function resolveMemoryBackend(settings: Settings): MemoryBackend {
	const id = settings.get("memory.backend");
	if (id === "nexus") return nexusBackend;

	return offBackend;
}
