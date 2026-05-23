import type { Settings } from "../config/settings";
import { hindsightBackend } from "../hindsight";
import { localBackend } from "./local-backend";
import { nexusBackend } from "./nexus-backend";
import { offBackend } from "./off-backend";
import { rockeyBackend } from "./rockey-backend";
import type { MemoryBackend } from "./types";

/**
 * Pick the active memory backend for a Settings instance.
 *
 * Selection rules (single source of truth — every memory consumer routes
 * through this):
 *   - `memory.backend === "nexus"`      → Nexus canonical local memory
 *   - `memory.backend === "hindsight"`  → Hindsight remote memory
 *   - `memory.backend === "rockey"`     → Rockey compatibility local memory
 *   - `memory.backend === "local"`      → legacy local summary pipeline
 *   - everything else                   → no-op
 */
export function resolveMemoryBackend(settings: Settings): MemoryBackend {
	const id = settings.get("memory.backend");
	if (id === "nexus") return nexusBackend;
	if (id === "hindsight") return hindsightBackend;
	if (id === "rockey") return rockeyBackend;
	if (id === "local") return localBackend;
	return offBackend;
}
