import { descriptorFromAgentTool } from "../agi/agent-tool-adapter";
import type { CapabilityLease } from "../agi/capability-lease";
import { EvidenceVerifier } from "../agi/evidence-verifier";
import { AgiGovernance } from "../agi/governance";
import { buildMissionTimeline } from "../agi/observability";
import { RegistryRoleExecutor, type RoleExecutor } from "../agi/role-executor";
import { AgiRuntime, type AgiRuntimeDeps, type AgiRuntimePlanner } from "../agi/runtime";
import { AgiGatewayStore, buildAgiControlState } from "../agi/store";
import { AgiSupervisor, createFailClosedAgiCompletionVerifier } from "../agi/supervisor";
import { renderAgiStatusText, runAgiTui } from "../agi/tui";
import type { ContractiblePlanStep, ObjectiveContract, RuntimeAction } from "../autonomy";
import { ObjectiveScheduler } from "../autonomy/scheduler";
import { ObjectiveStore } from "../autonomy/store";
import { Settings } from "../config/settings";
import { MissionRuntimeImpl } from "../mission/core/mission-runtime";
import { MissionStore } from "../mission/store";
import { SessionManager } from "../session/session-manager";
import { createTools, type ToolSession } from "../tools";
import { SessionToolGateway } from "../tools/gateway/session-gateway";
import { ToolRegistry } from "../tools/registry/tool-registry";

export interface AgiCommandArgs {
	action?: string;
	session?: string;
	db?: string;
	cwd?: string;
	tickMs?: number;
	once?: boolean;
	mission?: string;
	objective?: string;
	objectiveContract?: string;
	criteria?: string[];
	legacyTrustSelfReport?: boolean;
	lease?: string;
	reason?: string;
	profile?: string;
}

export async function runAgiCommand(args: AgiCommandArgs = {}): Promise<void> {
	const action = args.action ?? "tui";
	if (action === "tui") {
		await runAgiTui({
			dbPath: args.db,
			cwd: args.cwd,
			tickMs: args.tickMs,
			legacyTrustSelfReport: args.legacyTrustSelfReport,
		});
		return;
	}

	if (
		action === "timeline" ||
		action === "leases" ||
		action === "evidence" ||
		action === "audit-export" ||
		action === "emergency-stop" ||
		action === "revoke-lease"
	) {
		await runMissionControlPlaneCommand(action, args);
		return;
	}

	const store = new AgiGatewayStore(args.db);
	try {
		if (action === "status") {
			process.stdout.write(renderAgiStatusText(store.listSessions(), store.overallScore()));
			return;
		}
		if (action === "events") {
			const sessionId = args.session ? resolveMonitoredSession(store, args.session).sessionId : undefined;
			for (const event of store.listEvents(sessionId)) {
				process.stdout.write(
					`${event.sessionId}\t${event.type}\t${event.createdAt}\t${JSON.stringify(event.payload)}\n`,
				);
			}
			return;
		}
		if (action === "actions") {
			const sessionId = args.session ? resolveMonitoredSession(store, args.session).sessionId : undefined;
			for (const item of store.listActions(sessionId)) {
				process.stdout.write(
					`${item.sessionId}\t${item.status}\t${item.actionType}\t${item.createdAt}\t${JSON.stringify(item.result ?? {})}\n`,
				);
			}
			return;
		}
		if (action === "add") {
			if (!args.session) throw new Error("agi add requires --session <id-or-path>");
			const session = await resolveSession(args.session, args.cwd ?? process.cwd());
			const attached = store.addSession({
				sessionId: session.id,
				sessionPath: session.path,
				cwd: session.cwd,
				title: session.title,
				missionId: args.mission,
				objective: args.objective,
				objectiveContractId: args.objectiveContract,
				criteria: args.criteria,
			});
			process.stdout.write(
				`${attached.sessionId}\t${attached.state}\t${attached.score}/100\t${attached.sessionPath}\n`,
			);
			return;
		}
		if (action === "run") {
			const supervisor = new AgiSupervisor({
				store,
				tickMs: args.tickMs,
				completionVerifier: args.legacyTrustSelfReport ? undefined : createFailClosedAgiCompletionVerifier(),
			});
			if (args.once) {
				const result = await supervisor.tick();
				process.stdout.write(`AGI Gateway score: ${result.score}/100\n`);
				return;
			}
			const handle = supervisor.start();
			await handle.done;
			process.stdout.write(`AGI Gateway score: ${store.overallScore()}/100\n`);
			return;
		}
		if (action === "runtime") {
			if (args.profile !== undefined && args.profile !== "strict-supervised") {
				throw new Error("agi runtime supports --profile strict-supervised");
			}
			const result = await runStrictSupervisedRuntime(args);
			process.stdout.write(
				`AGI strict-supervised runtime: observed=${result.missionsObserved} queued=${result.actionsQueued} allowed=${result.actionsAllowed} blocked=${result.actionsBlocked} completed=${result.missionsCompleted} missionBlocked=${result.missionsBlocked}\n`,
			);
			return;
		}

		if (!args.session) throw new Error(`agi ${action} requires --session <id-or-path>`);
		const monitored = resolveMonitoredSession(store, args.session);
		if (action === "pause") {
			const updated = store.updateSession(monitored.sessionId, {
				state: "paused",
				score: monitored.score,
				completionState: monitored.completionState,
				controlState: buildAgiControlState({
					...monitored.controlState,
					waitReason: "Paused by operator.",
					blockedReason: undefined,
					activeActionId: undefined,
				}),
			});
			process.stdout.write(`${updated.sessionId}\t${updated.state}\n`);
			return;
		}
		if (action === "resume") {
			const updated = store.updateSession(monitored.sessionId, {
				state: "watching",
				score: monitored.score,
				completionState: monitored.completionState,
				controlState: buildAgiControlState({
					...monitored.controlState,
					waitReason: undefined,
					blockedReason: undefined,
					activeActionId: undefined,
					nextRetryAt: undefined,
				}),
			});
			process.stdout.write(`${updated.sessionId}\t${updated.state}\n`);
			return;
		}
		if (action === "unblock") {
			const updated = store.updateSession(monitored.sessionId, {
				state: "watching",
				score: monitored.score,
				completionState: monitored.completionState,
				controlState: buildAgiControlState({
					...monitored.controlState,
					retryCount: 0,
					failureCount: monitored.controlState.failureCount,
					waitReason: undefined,
					blockedReason: undefined,
					activeActionId: undefined,
					nextRetryAt: undefined,
				}),
				lastError: null,
			});
			process.stdout.write(`${updated.sessionId}\t${updated.state}\n`);
			return;
		}
		if (action === "remove") {
			const removed = store.removeSession(monitored.sessionId);
			process.stdout.write(`${monitored.sessionId}\t${removed ? "removed" : "missing"}\n`);
			return;
		}

		throw new Error(`Unknown agi action: ${action}`);
	} finally {
		store.close();
	}
}

async function runMissionControlPlaneCommand(action: string, args: AgiCommandArgs): Promise<void> {
	if (!args.mission && action !== "revoke-lease") throw new Error(`agi ${action} requires --mission <id>`);
	const missionStore = new MissionStore(args.db);
	try {
		if (action === "timeline") {
			for (const event of buildMissionTimeline({ missionId: args.mission as string, store: missionStore })) {
				process.stdout.write(
					`${event.ts}\t${event.missionId}\t${event.type}\t${event.actor}\t${event.actionId ?? ""}\t${event.leaseId ?? ""}\t${event.summary}\t${event.evidenceRefs.join(",")}\n`,
				);
			}
			return;
		}
		if (action === "leases") {
			for (const actionRecord of missionStore.listRuntimeActionsForMission(args.mission as string)) {
				if (actionRecord.lease) {
					process.stdout.write(`${actionRecord.lease.leaseId}\t${actionRecord.id}\t${actionRecord.status}\n`);
				}
			}
			return;
		}
		if (action === "evidence") {
			for (const event of missionStore.listRuntimeEvents(args.mission as string)) {
				if (event.evidenceRefs.length > 0 || event.type === "evidence.verified") {
					process.stdout.write(`${event.occurredAt}\t${event.type}\t${event.evidenceRefs.join(",")}\n`);
				}
			}
			return;
		}
		if (action === "audit-export") {
			for (const event of missionStore.listRuntimeEvents(args.mission as string)) {
				process.stdout.write(`${JSON.stringify(event)}\n`);
			}
			return;
		}
		if (action === "emergency-stop") {
			const stopped = missionStore.recordAgiEmergencyStop(
				args.mission as string,
				args.reason ?? "operator emergency stop",
			);
			process.stdout.write(`${stopped.missionId}\tstopped\t${stopped.reason ?? ""}\n`);
			return;
		}
		if (action === "revoke-lease") {
			if (!args.lease) throw new Error("agi revoke-lease requires --lease <id>");
			const revoked = missionStore.revokeCapabilityLease(args.lease, args.reason ?? "operator revoked");
			process.stdout.write(`${revoked.id}\t${revoked.status}\t${revoked.revokedReason ?? ""}\n`);
			return;
		}
		throw new Error(`Unknown AGI control-plane action: ${action}`);
	} finally {
		missionStore.close();
	}
}

async function runStrictSupervisedRuntime(args: AgiCommandArgs) {
	const missionStore = new MissionStore(args.db);
	const objectiveStore = new ObjectiveStore(args.db);
	const missionRuntime = new MissionRuntimeImpl({
		store: missionStore,
		autonomyProfile: "strict",
	});
	try {
		const scheduler = new ObjectiveScheduler({
			store: objectiveStore,
			missionRuntime,
			classifyContinuation: ({ missionId }) =>
				missionId ? { kind: "continue", reason: "missing_requirements" } : { kind: "none", reason: "no_mission" },
			findMissionForObjective: objective => missionStore.getPreferredMission({ objectiveId: objective.id })?.id,
			resumeMission: () => undefined,
			holdObjective: () => undefined,
			now: Date.now,
		});
		const runtime = new AgiRuntime({
			scheduler,
			objectives: objectiveStore,
			missionRuntime,
			compilerModel: new StrictSupervisedCompilerModel(),
			planner: new StrictSupervisedPlanner(),
			leaseIssuer: new StrictSupervisedLeaseIssuer(),
			toolGateway: new SessionToolGateway({
				permissionMode: "lease",
				leaseDeps: {
					getMission: missionId => missionRuntime.tryGet(missionId),
					getProposal: proposalId => missionStore.getProposal(proposalId),
					now: Date.now,
				},
			}),
			verifier: new EvidenceVerifier({ missionStore }),
			store: missionStore,
			governance: new AgiGovernance({ store: missionStore }),
			executor: await createStrictSupervisedRoleExecutor(args),
		} satisfies AgiRuntimeDeps);
		return await runtime.tick();
	} finally {
		missionRuntime.close();
		objectiveStore.close();
		missionStore.close();
	}
}

class StrictSupervisedCompilerModel {
	async compile(input: {
		goal: string;
		criteria: string[];
		constraints: string[];
		mode?: string;
	}): Promise<ObjectiveContract> {
		const criteria = input.criteria.length > 0 ? input.criteria : ["Runtime action is planned and governed."];
		const acceptanceCriteria = criteria.map((description, index) => ({
			id: `criterion-${index + 1}`,
			description,
			required: true,
			evidenceKinds: ["runtime_metric" as const],
			ownerRole: "Verifier" as const,
			verification: "deterministic" as const,
		}));
		return {
			id: stableId("contract", [input.goal, ...criteria, ...input.constraints, input.mode ?? "supervised"]),
			objective: input.goal,
			nonGoals: ["Do not mutate the workspace from the runtime entrypoint without a role executor."],
			acceptanceCriteria,
			requiredEvidence: Object.fromEntries(
				acceptanceCriteria.map(criterion => [criterion.id, criterion.evidenceKinds]),
			),
			scopeGuard: {
				include: ["**"],
				exclude: [],
				allowedCommands: [],
				forbiddenActions: ["deploy", "operate-infrastructure"],
			},
			budgetGuard: { maxRuntimeActions: 1, maxRetriesPerAction: 0, maxParallelActions: 1 },
			autonomyMode: input.mode === "manual" ? "manual" : "supervised",
			risk: "medium",
			freshnessPolicy: { researchRequired: false },
			rolePolicy: {
				capabilities: [
					{
						role: "Planner",
						modelRole: "Planner",
						canRead: true,
						canWriteRepository: false,
						canRunCommands: false,
						canOperateInfrastructure: false,
						canApproveCompletion: false,
						allowedTools: ["read"],
					},
					{
						role: "Verifier",
						modelRole: "Verifier",
						canRead: true,
						canWriteRepository: false,
						canRunCommands: false,
						canOperateInfrastructure: false,
						canApproveCompletion: true,
						allowedTools: ["read"],
					},
				],
				defaultRoleByStepKind: { observe: "Planner", verify: "Verifier", default: "Planner" },
				requireReviewerForRisk: ["high", "critical"],
				requireSecurityFor: [],
				requireSreFor: [],
			},
		};
	}
}

class StrictSupervisedPlanner implements AgiRuntimePlanner {
	async planMission(input: { mission: { id: string; objective: string }; contract: ObjectiveContract }): Promise<{
		id: string;
		steps: ContractiblePlanStep[];
	}> {
		return {
			id: stableId("plan", [input.mission.id, input.contract.id]),
			steps: [
				{
					id: "strict-supervised-observe",
					kind: "observe",
					description: `Queue governed runtime observation for mission objective: ${input.mission.objective}`,
					roleHint: "Planner",
					requiresWrite: false,
					requiresCommands: false,
					requiresInfrastructure: false,
					acceptanceCriteria: input.contract.acceptanceCriteria.map(criterion => criterion.id),
					requiredEvidence: ["runtime_metric"],
				},
			],
		};
	}
}

class StrictSupervisedLeaseIssuer {
	issue(input: { mission: { id: string }; contract: ObjectiveContract; action: RuntimeAction }): CapabilityLease {
		const capability = input.contract.rolePolicy.capabilities.find(item => item.role === input.action.role);
		const allowedTool =
			capability?.allowedTools.find(tool => tool === "read") ?? capability?.allowedTools[0] ?? "read";
		const issuedAt = Date.now();
		return {
			leaseId: stableId("lease", [input.action.id, String(issuedAt)]),
			missionId: input.action.missionId,
			objectiveContractId: input.action.objectiveContractId,
			planId: input.action.planId,
			planStepId: input.action.stepId,
			actionId: input.action.id,
			mode: "dry-run",
			actorRole: input.action.role,
			allowedTools: [allowedTool],
			allowedRisk: "MEDIUM",
			mutationScope: {
				allowedPaths: input.action.scopeGuard.include,
				deniedPaths: input.action.scopeGuard.exclude,
				allowedServices: [],
				allowedDataClasses: [],
			},
			budget: {
				maxToolCalls: 1,
				maxRetries: input.action.budgetGuard.maxRetriesPerAction,
				timeoutMs: 30_000,
			},
			sandbox: { mode: "none", rollbackRefs: [] },
			evidenceContract: { requiredEventTypes: ["tool.requested", "tool.completed"], requiredEvidenceRefs: [] },
			issuedAt,
			expiresAt: issuedAt + 15 * 60_000,
		};
	}
}

async function createStrictSupervisedRoleExecutor(args: AgiCommandArgs): Promise<RoleExecutor> {
	const cwd = args.cwd ?? process.cwd();
	const settings = await Settings.createForCwd(cwd);
	const session = createStrictRuntimeToolSession(cwd, settings);
	const tools = await createTools(session, strictRuntimeToolNames());
	const registry = new ToolRegistry();
	registry.registerAll(tools.map(tool => descriptorFromAgentTool(tool)));

	return new RegistryRoleExecutor({
		registry,
		buildInput: ({ action, mission }) => ({
			path: ".",
			actionId: action.id,
			missionId: mission.id,
			objective: mission.objective,
			instruction: action.instruction,
		}),
		buildContext: ({ action, lease, sandboxWorkspace }) => ({
			cwd: sandboxWorkspace?.cwd ?? cwd,
			capabilityLease: lease,
			actionId: action.id,
			planStepId: action.stepId,
			mutationScope: lease.mutationScope.allowedPaths,
			agentRole: "orchestrator",
		}),
	});
}

function strictRuntimeToolNames(): string[] {
	return ["read"];
}

function createStrictRuntimeToolSession(cwd: string, settings: Settings): ToolSession {
	return {
		cwd,
		hasUI: false,
		skipPythonPreflight: true,
		enableLsp: false,
		settings,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
	};
}

function stableId(prefix: string, parts: string[]): string {
	let hash = 0x811c9dc5;
	for (const part of parts.join("\0")) {
		hash ^= part.charCodeAt(0);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return `${prefix}-${hash.toString(36)}`;
}

function resolveMonitoredSession(store: AgiGatewayStore, sessionArg: string) {
	const normalized = sessionArg.toLowerCase();
	const session = store
		.listSessions()
		.find(
			candidate => candidate.sessionId.toLowerCase().startsWith(normalized) || candidate.sessionPath === sessionArg,
		);
	if (!session) throw new Error(`Monitored AGI session not found: ${sessionArg}`);
	return session;
}

async function resolveSession(sessionArg: string, cwd: string) {
	if (sessionArg.includes("/") || sessionArg.includes("\\") || sessionArg.endsWith(".jsonl")) {
		const manager = await SessionManager.open(sessionArg);
		const header = manager.getHeader();
		const sessionPath = manager.getSessionFile() ?? sessionArg;
		return {
			id: manager.getSessionId(),
			path: sessionPath,
			cwd: manager.getCwd(),
			title: header?.title,
		};
	}

	const sessions = await SessionManager.listAll();
	const localFirst = sessions.sort((a, b) => {
		const aLocal = a.cwd === cwd ? 0 : 1;
		const bLocal = b.cwd === cwd ? 0 : 1;
		if (aLocal !== bLocal) return aLocal - bLocal;
		return b.modified.getTime() - a.modified.getTime();
	});
	const normalized = sessionArg.toLowerCase();
	const match = localFirst.find(session => session.id.toLowerCase().startsWith(normalized));
	if (!match) throw new Error(`Session "${sessionArg}" not found.`);
	return match;
}
