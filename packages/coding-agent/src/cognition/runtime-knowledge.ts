import type { Settings } from "../config/settings";
import { KnowledgeStore } from "../memory/knowledge-store";
import { OkfStore } from "../okf/store";
import type { LearnerMemory } from "./learner";

export interface RuntimeKnowledgeHandle {
	knowledge: KnowledgeStore | OkfStore | LearnerMemory;
	persistLearnedHeuristics: boolean;
	invalidateStale(root: string): void;
	close(): void;
}

const DISABLED_KNOWLEDGE: LearnerMemory = {
	query: () => [],
	record: () => {
		throw new Error("Knowledge runtime is disabled");
	},
};

export function openRuntimeKnowledge(settings: Settings): RuntimeKnowledgeHandle {
	if (settings.get("knowledge.enabled") !== true) {
		return disabledRuntimeKnowledge();
	}
	const provider = settings.get("knowledge.provider");
	if (provider === "none") {
		return disabledRuntimeKnowledge();
	}
	if (provider === "okf") {
		const store = new OkfStore(settings.get("knowledge.okfPath"));
		return {
			knowledge: store,
			persistLearnedHeuristics: true,
			invalidateStale: () => {},
			close: () => {},
		};
	}
	const store = new KnowledgeStore();
	return {
		knowledge: store,
		persistLearnedHeuristics: true,
		invalidateStale: root => {
			store.invalidateStale(root);
		},
		close: () => {
			store.close();
		},
	};
}

function disabledRuntimeKnowledge(): RuntimeKnowledgeHandle {
	return {
		knowledge: DISABLED_KNOWLEDGE,
		persistLearnedHeuristics: false,
		invalidateStale: () => {},
		close: () => {},
	};
}
