import { YAML } from "bun";
import { parseFrontmatter } from "@amaze/utils";

export type KnowledgeRegistryEntryStatus = "draft" | "active" | "inactive" | "archived";

export interface KnowledgeRegistryEntry {
	name: string;
	description: string;
	vertical?: string;
	knowledge?: {
		agencySourceId?: string;
		clientSourceId?: string;
	};
	tools: string[];
	approvals: string[];
	status: KnowledgeRegistryEntryStatus;
}

export interface KnowledgeRegistry {
	type?: string;
	version?: number;
	entries: KnowledgeRegistryEntry[];
	warnings: string[];
}

const VALID_STATUSES = new Set<KnowledgeRegistryEntryStatus>(["draft", "active", "inactive", "archived"]);

function normalizeStringArray(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.map(item => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
	}
	if (typeof value === "string") {
		return value
			.split(",")
			.map(item => item.trim())
			.filter(Boolean);
	}
	return [];
}

function normalizeKnowledge(value: unknown): KnowledgeRegistryEntry["knowledge"] | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const record = value as Record<string, unknown>;
	const knowledge: NonNullable<KnowledgeRegistryEntry["knowledge"]> = {};
	if (typeof record.agencySourceId === "string" && record.agencySourceId.trim()) {
		knowledge.agencySourceId = record.agencySourceId.trim();
	}
	if (typeof record.clientSourceId === "string" && record.clientSourceId.trim()) {
		knowledge.clientSourceId = record.clientSourceId.trim();
	}
	return Object.keys(knowledge).length > 0 ? knowledge : undefined;
}

function describeEntry(entry: unknown, index: number, label = "entry"): string {
	if (entry && typeof entry === "object" && !Array.isArray(entry)) {
		const name = (entry as Record<string, unknown>).name;
		if (typeof name === "string" && name.trim()) return `${label} ${name.trim()}`;
	}
	return `${label} at index ${index}`;
}

function normalizeEntry(entry: unknown, index: number, warnings: string[]): KnowledgeRegistryEntry | undefined {
	if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
		warnings.push(`Dropped ${describeEntry(entry, index)}: entry must be an object.`);
		return undefined;
	}

	const record = entry as Record<string, unknown>;
	const label = describeEntry(record, index);
	const name = typeof record.name === "string" ? record.name.trim() : "";
	const description = typeof record.description === "string" ? record.description.trim() : "";

	if (!name) {
		warnings.push(`Dropped ${label}: name is required.`);
		return undefined;
	}
	if (!description) {
		warnings.push(`Dropped ${label}: description is required.`);
		return undefined;
	}

	let status: KnowledgeRegistryEntryStatus = "draft";
	if (typeof record.status === "string" && record.status.trim()) {
		const normalizedStatus = record.status.trim() as KnowledgeRegistryEntryStatus;
		if (VALID_STATUSES.has(normalizedStatus)) {
			status = normalizedStatus;
		} else {
			warnings.push(`Defaulted ${label} status to draft: ${record.status} is not supported.`);
		}
	}

	return {
		name,
		description,
		vertical: typeof record.vertical === "string" && record.vertical.trim() ? record.vertical.trim() : undefined,
		knowledge: normalizeKnowledge(record.knowledge ?? record.brain),
		tools: normalizeStringArray(record.tools),
		approvals: normalizeStringArray(record.approvals),
		status,
	};
}

export function parseKnowledgeRegistryPage(markdown: string): KnowledgeRegistry {
	const { frontmatter } = parseFrontmatter(markdown, { source: "knowledge-registry", level: "off" });
	const warnings: string[] = [];
	const rawEntries = Array.isArray(frontmatter.entries) ? frontmatter.entries : [];

	if (frontmatter.entries !== undefined && !Array.isArray(frontmatter.entries)) {
		warnings.push("Ignored entries: expected an array.");
	}

	return {
		type: typeof frontmatter.type === "string" ? frontmatter.type : undefined,
		version: typeof frontmatter.version === "number" ? frontmatter.version : undefined,
		entries: rawEntries
			.map((entry, index) => normalizeEntry(entry, index, warnings))
			.filter((entry): entry is KnowledgeRegistryEntry => Boolean(entry)),
		warnings,
	};
}

export type AgencyAgentRegistryEntryStatus = KnowledgeRegistryEntryStatus;
export type AgencyAgentRegistryEntry = Omit<KnowledgeRegistryEntry, "knowledge"> & {
	brain?: KnowledgeRegistryEntry["knowledge"];
};
export interface AgencyAgentRegistry extends Omit<KnowledgeRegistry, "entries"> {
	agents: AgencyAgentRegistryEntry[];
}

function toAgencyWarning(warning: string): string {
	return warning
		.replace("Ignored entries:", "Ignored agents:")
		.replace("Dropped entry ", "Dropped agent ")
		.replace("Defaulted entry ", "Defaulted agent ");
}

export function parseAgencyAgentRegistryPage(markdown: string): AgencyAgentRegistry {
	const { frontmatter } = parseFrontmatter(markdown, { source: "agency-agent-registry", level: "off" });
	const adaptedFrontmatter = {
		...frontmatter,
		entries: frontmatter.agents,
		agents: undefined,
	};
	const registry = parseKnowledgeRegistryPage(`---\n${YAML.stringify(adaptedFrontmatter)}---\n`);
	return {
		type: registry.type,
		version: registry.version,
		agents: registry.entries.map(({ knowledge, ...entry }) => ({ ...entry, brain: knowledge })),
		warnings: registry.warnings.map(toAgencyWarning),
	};
}
