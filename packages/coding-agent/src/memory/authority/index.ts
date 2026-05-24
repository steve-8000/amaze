/**
 * Memory authority types (workplan Lane D / §11).
 *
 * Pure types + pure functions for the memory authority hierarchy, the mission
 * memory object shape, and the durable-write promotion rule. No storage wiring.
 */

export {
	AUTHORITY_LEVELS,
	type Authority,
	compareAuthority,
	isAuthority,
	isMoreAuthoritative,
	rankAuthority,
} from "./authority-hierarchy";
export {
	canPromoteToDurable,
	type DurableWriteDecision,
	type DurableWriteInput,
	type DurableWriteSource,
} from "./durable-write-rule";
export type { MissionMemoryObject, MissionMemoryType } from "./mission-memory-object";
