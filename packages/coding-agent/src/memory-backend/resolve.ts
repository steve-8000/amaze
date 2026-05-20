import type { Settings } from "../config/settings";
import { hindsightBackend } from "../hindsight";
import { localBackend } from "./local-backend";
import { offBackend } from "./off-backend";
import { rockeyBackend } from "./rockey-backend";
import type { MemoryBackend } from "./types";

/**
 * Pick the active memory backend for a Settings instance.
 *
 * Selection rules (single source of truth — every memory consumer routes
 * through this):
 *   - `memory.backend === "hindsight"`  → Hindsight remote memory
 *   - `memory.backend === "rockey"`     → Rockey canonical local memory
 *   - `memory.backend === "local"`      → legacy local summary pipeline
 *   - everything else                   → no-op
 *
 * `memories.enabled` remains accepted only as a legacy migration input. Once
 * a config is loaded, `memory.backend` is the sole runtime selector and
 * legacy local settings are upgraded to Rockey by config migration.
 */
export function resolveMemoryBackend(settings: Settings): MemoryBackend {
	const id = settings.get("memory.backend");
	if (id === "hindsight") return hindsightBackend;
	if (id === "rockey") return rockeyBackend;
	if (id === "local") return localBackend;
	return offBackend;
}
