/**
 * Mission ↔ memory bridge (workplan Lane J / §11).
 *
 * Opt-in, additive surface that connects Nexus memory to the Mission model:
 *   - {@link MissionMemoryBridge} — READ side: mission-scoped recall surfaced as
 *     Lane D mission memory objects at guidance authority.
 *   - {@link MemoryCurator} — WRITE side: gates durable promotion through Lane
 *     D's `canPromoteToDurable` rule.
 *
 * Nothing here is wired into the default memory path; a runtime constructs these
 * explicitly to bridge memory into a mission.
 */

export {
	type CommitFn,
	type CuratedWriteResult,
	type DurableWriteCandidate,
	MemoryCurator,
	type MemoryCuratorOptions,
} from "./memory-curator";
export {
	type BridgeRecallInput,
	MissionMemoryBridge,
	type MissionMemoryBridgeOptions,
	type MissionMemoryRecall,
	RECALL_AUTHORITY,
	RECALL_AUTHORITY_LABEL,
	type RecalledMemoryItem,
	type RecallFn,
	recallDefersTo,
} from "./mission-memory-bridge";
