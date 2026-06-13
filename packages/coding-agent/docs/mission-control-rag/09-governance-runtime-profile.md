---
doc_id: mission-control-rag-09-governance-runtime-profile
domain: mission-control.agi-governance-runtime-profile
retrieval_tags:
  - agi-governance
  - runtime-profile
  - human-oversight
  - permission-gateway
  - continuation-policy
  - proposal-integrity
  - gbrain-dependency
  - local-llm-evidence
source_evidence:
  - .amaze/config.yml:39-47
  - .amaze/mcp.json:2-13
  - packages/coding-agent/src/mission/continuation/policy.ts:152-205
  - packages/coding-agent/src/config/settings-schema.ts:1353-1374
  - packages/coding-agent/src/config/settings-schema.ts:1865-1878
  - packages/coding-agent/src/config/settings-schema.ts:2408-2416
  - packages/coding-agent/src/learning/types.ts:37-55
  - packages/coding-agent/src/learning/eval/pipeline.ts:21-23
  - packages/coding-agent/src/learning/store.ts:8-9
  - packages/coding-agent/src/local-llm/types.ts:3-61
  - https://api.github.com/repos/steve-8000/amaze/commits/main?per_page=1
  - https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=OJ%3AL_202401689
  - https://airc.nist.gov/airmf-resources/airmf/5-sec-core/
  - https://www.nist.gov/itl/ai-risk-management-framework/nist-ai-rmf-playbook
planner_uses:
  - Retrieve before enabling AGI/autonomous runtime profiles, permission changes, continuation, proposal application, or external-memory dependencies.
  - Plan safety gates that preserve human oversight, explicit continuation, proposal integrity, and auditable evidence.
  - Separate current implementation evidence from governance targets and external compliance references.
---

# Governance runtime profile

Cross-references: [README](./README.md) defines the retrieval protocol; [01 Autonomy Objective Loop](./01-autonomy-objective-loop.md) covers autonomy flags and objective scheduling; [04 Verification Gates](./04-verification-gates.md) defines completion gates; [05 Memory, Learning, Continuation](./05-memory-learning-continuation.md) defines proposal and continuation safety; [06 Researcher Recency Provenance](./06-researcher-recency-provenance.md) governs current external facts; [07 AGI Gateway Supervisor](./07-agi-gateway-supervisor.md) covers gateway execution; [08 AGI Mission Persistence Bridge](./08-agi-mission-persistence-bridge.md) binds AGI sessions to MissionStore authority.

## Spec

Amaze's AGI mode must run under an explicit governance profile. The profile is not a product label; it is runtime policy that controls human oversight, continuation eligibility, tool permissions, proposal integrity, external-memory readiness, local-LLM role boundaries, and metadata hygiene.

The target governance profile must provide:

1. Human oversight, override, and stop controls for every AGI/autonomous mission.
2. Enforced tool gateway permissions for AGI/autonomous profiles; default allow-all settings are not acceptable for high-risk autonomous work.
3. Explicit-only continuation: no ambient, pasted, auto-promoted, or title-inferred mission may schedule hidden continuation.
4. Proposal artifact and hash enforcement before approval, apply, rollback, or autonomous continuation through proposal-gated work.
5. GBrain doctor checks and degraded fallback before AGI mode depends on external MCP memory.
6. Local LLM use limited to evidence-only summarization/compression; local output is not completion authority and must carry evidence refs.
7. Metadata cleanup so repo/source references reflect the active Amaze baseline and stale fork metadata does not enter plans.

## Source Evidence

- `.amaze/config.yml:39-47`: mission auto-approval is false and continuation is disabled because an ambiently promoted, misclassified mission caused a runaway continuation loop; comments say re-enable only after continuation is restricted to explicitly-created missions.
- `src/mission/continuation/policy.ts:152-205`: continuation policy rejects missing missions, terminal lifecycle states, user messages, proposal gates, budget caps, token caps, no-progress caps, and specifically excludes `mission.mode === "auto"` as `auto_mission_not_continuable`.
- `src/config/settings-schema.ts:1865-1878`: `tools.gateway.permissionMode` defaults to `allow-all`, with `enforce` available but not default.
- `src/config/settings-schema.ts:2408-2416`: `autonomy.enabled` defaults to false.
- `src/learning/types.ts:37-55` and `src/learning/eval/pipeline.ts:21-23`: evaluation reports include `patchHash`, but proposal types do not require a persisted immutable artifact pointer separate from mutable payload fields.
- `src/learning/store.ts:8-9`: proposal persistence still names a legacy proposals DB path for migration compatibility.
- `.amaze/mcp.json:2-13`: MCP schema points to `can1357/amaze`, and the `gbrain` MCP server is an external `gbrain serve` stdio command.
- `src/config/settings-schema.ts:1353-1374`: local LLM settings exist for summarization/compression prepasses and default disabled.
- `src/local-llm/types.ts:3-61`: local LLM output is modeled as evidence bundles with relevant files, claims, risks, unsupported items, and next reads; it does not model runtime authority.
- GitHub baseline checked 2026-06-13: `https://api.github.com/repos/steve-8000/amaze/commits/main?per_page=1` reported main SHA `20f0ce5f1f4c8efd2f3c88b901948b6ebac9edf2`, short `20f0ce5`, message `Restore local gbrain integration`, committed `2026-06-13T03:27:16Z`.

## External Governance Findings

- EU AI Act Article 14 requires effective human oversight for high-risk AI systems, including the ability for natural persons to understand capacities/limitations, monitor operation, correctly interpret outputs, decide not to use outputs, intervene, stop, or otherwise override the system. Checked 2026-06-13 at `https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=OJ%3AL_202401689`.
- NIST AI RMF Core uses Govern, Map, Measure, and Manage functions across the AI lifecycle, including ongoing monitoring and review. Checked 2026-06-13 at `https://airc.nist.gov/airmf-resources/airmf/5-sec-core/`.
- NIST AI RMF Playbook was updated 2026-06-10. Checked 2026-06-13 at `https://www.nist.gov/itl/ai-risk-management-framework/nist-ai-rmf-playbook`.

## Governance Model

### Human oversight and stop

AGI mode must expose operator-readable mission objective, criteria, current action, evidence refs, pending proposal, and continuation status. Operators must be able to pause, stop, override, reject completion, and force manual review without relying on hidden model state.

### Permission enforcement

`tools.gateway.permissionMode = "allow-all"` is acceptable for legacy permissive sessions only. AGI/autonomous profiles must require `enforce` or an equivalent in-memory policy override before tools with high-risk seams run. Permission decisions should be logged as evidence.

### Explicit-only continuation

The current repository already documents why continuation is disabled. Re-enabling must require explicit mission creation or explicit AGI mission binding from [08 AGI Mission Persistence Bridge](./08-agi-mission-persistence-bridge.md). Ambient auto missions must stay excluded.

### Proposal integrity

A proposal that can change settings, rules, skills, memory, source, or runtime behavior must have immutable artifact identity: artifact URI, canonical content hash, eval report hash, approval identity, and rollback snapshot refs. Apply must reject missing artifacts, mismatched hashes, stale eval reports, and legacy-only pointer records.

### GBrain dependency readiness

AGI mode may retrieve from GBrain only after a doctor check proves the configured MCP server exists, starts, and serves the expected source. If GBrain is unavailable, AGI mode must either run with an explicit degraded profile that excludes GBrain-derived claims or block before autonomous start. It must not silently treat missing external memory as empty truth.

### Local LLM evidence-only role

Local LLMs may summarize logs and compress context into evidence bundles. They must not approve proposals, satisfy acceptance criteria, mark missions complete, or replace Researcher for current external facts. Every local claim used for planning must carry evidence refs or remain in `unsupported`/`nextReads`.

### Metadata cleanup

Runtime metadata should identify the active repository and baseline. Stale schema URLs, fork pointers, or legacy names must be either migrated or explicitly marked as compatibility-only so planners do not anchor on the wrong upstream.

## Target TypeScript Sample: AGI profile policy

This is target/source sample code, not an existing implementation.

```ts
type RuntimeProfile = "interactive" | "agi-autonomous" | "agi-strict";

type PermissionMode = "allow-all" | "enforce";

export interface AgiRuntimePolicy {
	profile: RuntimeProfile;
	permissionMode: PermissionMode;
	continuation: {
		enabled: boolean;
		requiresExplicitMission: boolean;
		allowAutoMission: false;
	};
	humanOversight: {
		requirePause: boolean;
		requireStop: boolean;
		requireOverride: boolean;
		requireVisibleEvidence: boolean;
	};
	gbrain: {
		requireDoctorPass: boolean;
		fallback: "block" | "degraded-no-gbrain";
	};
	localLlm: {
		allowedRoles: Array<"log_summarizer" | "context_compressor">;
		completionAuthority: false;
		requireEvidenceRefs: true;
	};
}

export function policyForAgiProfile(input: {
	profile: RuntimeProfile;
	settingsPermissionMode: PermissionMode;
	missionMode: "auto" | "interactive" | "autonomous";
	explicitMission: boolean;
}): AgiRuntimePolicy {
	if (input.profile === "interactive") {
		return {
			profile: "interactive",
			permissionMode: input.settingsPermissionMode,
			continuation: { enabled: false, requiresExplicitMission: true, allowAutoMission: false },
			humanOversight: { requirePause: true, requireStop: true, requireOverride: true, requireVisibleEvidence: true },
			gbrain: { requireDoctorPass: false, fallback: "degraded-no-gbrain" },
			localLlm: { allowedRoles: ["log_summarizer", "context_compressor"], completionAuthority: false, requireEvidenceRefs: true },
		};
	}

	if (!input.explicitMission || input.missionMode === "auto") {
		throw new Error("AGI continuation requires an explicitly-created or explicitly-bound mission");
	}

	if (input.settingsPermissionMode !== "enforce") {
		throw new Error("AGI autonomous profiles require tools.gateway.permissionMode=enforce");
	}

	return {
		profile: input.profile,
		permissionMode: "enforce",
		continuation: { enabled: true, requiresExplicitMission: true, allowAutoMission: false },
		humanOversight: { requirePause: true, requireStop: true, requireOverride: true, requireVisibleEvidence: true },
		gbrain: { requireDoctorPass: true, fallback: input.profile === "agi-strict" ? "block" : "degraded-no-gbrain" },
		localLlm: { allowedRoles: ["log_summarizer", "context_compressor"], completionAuthority: false, requireEvidenceRefs: true },
	};
}
```

## Target TypeScript Sample: proposal integrity gate

This is target/source sample code, not an existing implementation.

```ts
export interface ProposalArtifactIdentity {
	proposalId: string;
	artifactUri: string;
	canonicalPatchHash: string;
	evalReportHash: string;
	approvedBy: string;
	approvedAt: number;
	rollbackRefs: string[];
}

export function assertProposalIntegrity(args: {
	proposal: LearningProposal;
	identity?: ProposalArtifactIdentity;
	currentPatchHash: string;
	currentEvalReportHash: string;
}): ProposalArtifactIdentity {
	const { proposal, identity } = args;

	if (!identity) throw new Error(`Proposal ${proposal.id} has no immutable artifact identity`);
	if (identity.proposalId !== proposal.id) throw new Error("Proposal artifact identity does not match proposal id");
	if (!identity.artifactUri.startsWith("proposal-artifact://")) throw new Error("Proposal artifact URI is not durable");
	if (identity.canonicalPatchHash !== args.currentPatchHash) throw new Error("Proposal patch hash changed after eval");
	if (identity.evalReportHash !== args.currentEvalReportHash) throw new Error("Proposal eval report changed after approval");
	if (!identity.approvedBy || identity.approvedAt <= 0) throw new Error("Proposal lacks human approval identity");
	if (identity.rollbackRefs.length === 0) throw new Error("Proposal lacks rollback snapshot refs");

	return identity;
}

export function canContinueProposalGatedMission(input: {
	needsProposal: boolean;
	proposal?: LearningProposal;
	identity?: ProposalArtifactIdentity;
	currentPatchHash: string;
	currentEvalReportHash: string;
}): boolean {
	if (!input.needsProposal) return true;
	if (!input.proposal || input.proposal.status !== "approved") return false;
	assertProposalIntegrity({
		proposal: input.proposal,
		identity: input.identity,
		currentPatchHash: input.currentPatchHash,
		currentEvalReportHash: input.currentEvalReportHash,
	});
	return true;
}
```

## AGI runtime acceptance criteria

- AGI/autonomous runtime startup fails closed unless human pause, stop, override, and visible-evidence controls are available.
- AGI/autonomous profiles enforce high-risk tool permissions; `allow-all` cannot be used for autonomous mutation or external side-effect work.
- Hidden continuation is enabled only for explicitly-created or explicitly-bound missions and remains disabled for ambient `auto` missions.
- Proposal-gated missions cannot continue or apply changes unless immutable artifact URI, patch hash, eval report hash, approval identity, and rollback refs match current state.
- GBrain dependency readiness is checked before AGI mode starts; failure either blocks strict mode or records an explicit degraded no-GBrain profile.
- Local LLM output is limited to evidence bundles for summarization/compression and never acts as verifier, proposal approver, Researcher replacement, or completion authority.
- Repo/source metadata is cleaned or marked compatibility-only so Mission Control plans use the active Amaze baseline (`20f0ce5` checked 2026-06-13) rather than stale fork pointers.
