import type { MissionIntent } from "../policy/intent";

export interface MissionLifecycleTemplate {
	intent: MissionIntent;
	allowDirectTaskCompletion: boolean;
	requireDecisionRecord: boolean;
	requireRegressionContract: boolean;
	requireProposalBeforeMutation: boolean;
	requireVerification: boolean;
}

export const LIFECYCLE_TEMPLATES: Record<MissionIntent, MissionLifecycleTemplate> = {
	conversation: {
		intent: "conversation",
		allowDirectTaskCompletion: true,
		requireDecisionRecord: false,
		requireRegressionContract: false,
		requireProposalBeforeMutation: false,
		requireVerification: false,
	},
	question_answering: {
		intent: "question_answering",
		allowDirectTaskCompletion: true,
		requireDecisionRecord: false,
		requireRegressionContract: false,
		requireProposalBeforeMutation: false,
		requireVerification: false,
	},
	repo_exploration: {
		intent: "repo_exploration",
		allowDirectTaskCompletion: true,
		requireDecisionRecord: false,
		requireRegressionContract: false,
		requireProposalBeforeMutation: false,
		requireVerification: false,
	},
	code_change: {
		intent: "code_change",
		allowDirectTaskCompletion: true,
		requireDecisionRecord: false,
		requireRegressionContract: false,
		requireProposalBeforeMutation: false,
		requireVerification: true,
	},
	architecture_change: {
		intent: "architecture_change",
		allowDirectTaskCompletion: false,
		requireDecisionRecord: true,
		requireRegressionContract: true,
		requireProposalBeforeMutation: true,
		requireVerification: true,
	},
	runtime_refactor: {
		intent: "runtime_refactor",
		allowDirectTaskCompletion: false,
		requireDecisionRecord: true,
		requireRegressionContract: true,
		requireProposalBeforeMutation: true,
		requireVerification: true,
	},
	release_hardening: {
		intent: "release_hardening",
		allowDirectTaskCompletion: false,
		requireDecisionRecord: true,
		requireRegressionContract: true,
		requireProposalBeforeMutation: false,
		requireVerification: true,
	},
	external_side_effect: {
		intent: "external_side_effect",
		allowDirectTaskCompletion: false,
		requireDecisionRecord: true,
		requireRegressionContract: false,
		requireProposalBeforeMutation: true,
		requireVerification: true,
	},
};

export function templateFor(intent: MissionIntent): MissionLifecycleTemplate {
	return LIFECYCLE_TEMPLATES[intent];
}
