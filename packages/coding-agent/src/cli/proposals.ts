import type { LearningProposal, LearningProposalType, ProposalStatus } from "../learning";
import { ProposalStore } from "../learning";

export interface ProposalsListArgs {
	db?: string;
	status?: ProposalStatus;
	type?: LearningProposalType;
}

export interface ProposalIdArgs {
	db?: string;
	id: string;
}

export interface ProposalApproveArgs extends ProposalIdArgs {
	reason?: string;
}

export interface ProposalRejectArgs extends ProposalIdArgs {
	reason: string;
}

const STATUSES: ProposalStatus[] = ["pending", "approved", "rejected", "applied", "rolled-back", "expired"];
const TYPES: LearningProposalType[] = ["memory", "skill", "rule", "settings"];

export function isProposalStatus(value: string | undefined): value is ProposalStatus {
	return STATUSES.includes(value as ProposalStatus);
}

export function isProposalType(value: string | undefined): value is LearningProposalType {
	return TYPES.includes(value as LearningProposalType);
}

export async function runProposalsListCommand(args: ProposalsListArgs): Promise<void> {
	withStore(args.db, store => {
		const proposals = listProposals(store, args);
		if (proposals.length === 0) {
			process.stdout.write("No proposals found.\n");
			return;
		}

		process.stdout.write(`${formatTable(proposals)}\n`);
	});
}

export async function runProposalsShowCommand(args: ProposalIdArgs): Promise<void> {
	withStore(args.db, store => {
		const proposal = requireProposal(store, args.id);
		process.stdout.write(`${JSON.stringify(proposal, null, 2)}\n`);
	});
}

export async function runProposalsApproveCommand(args: ProposalApproveArgs): Promise<void> {
	withStore(args.db, store => {
		const proposal = store.approve(args.id, args.reason);
		process.stdout.write(`approved ${proposal.id}\n`);
	});
}

export async function runProposalsRejectCommand(args: ProposalRejectArgs): Promise<void> {
	if (!args.reason.trim()) throw new Error("proposals reject requires --reason <reason>");
	withStore(args.db, store => {
		const proposal = store.reject(args.id, args.reason);
		process.stdout.write(`rejected ${proposal.id}\n`);
	});
}

export async function runProposalsDiffCommand(args: ProposalIdArgs): Promise<void> {
	withStore(args.db, store => {
		const proposal = requireProposal(store, args.id);
		if (proposal.type === "settings") {
			process.stdout.write(`${JSON.stringify(proposal.patch, null, 2)}\n`);
			return;
		}
		if (proposal.type === "skill") {
			process.stdout.write(`${proposal.bodyMarkdown}\n`);
			return;
		}
		throw new Error(`proposals diff only supports settings and skill proposals, got ${proposal.type}`);
	});
}

function withStore<T>(dbPath: string | undefined, callback: (store: ProposalStore) => T): T {
	const store = new ProposalStore(dbPath);
	try {
		return callback(store);
	} finally {
		store.close();
	}
}

function listProposals(store: ProposalStore, args: ProposalsListArgs): LearningProposal[] {
	if (args.status) {
		return filterByType(store.listByStatus(args.status), args.type);
	}
	if (args.type) {
		return store.listByType(args.type);
	}
	return STATUSES.flatMap(status => store.listByStatus(status));
}

function filterByType(proposals: LearningProposal[], type: LearningProposalType | undefined): LearningProposal[] {
	return type ? proposals.filter(proposal => proposal.type === type) : proposals;
}

function requireProposal(store: ProposalStore, id: string): LearningProposal {
	const proposal = store.get(id);
	if (!proposal) throw new Error(`Learning proposal not found: ${id}`);
	return proposal;
}

function formatTable(proposals: LearningProposal[]): string {
	const rows = proposals.map(proposal => [
		proposal.id,
		proposal.status,
		proposal.type,
		proposal.gate,
		new Date(proposal.createdAt).toISOString(),
		summarizeProposal(proposal),
	]);
	return renderRows([["id", "status", "type", "gate", "created", "summary"], ...rows]);
}

function summarizeProposal(proposal: LearningProposal): string {
	if (proposal.type === "memory") return proposal.content;
	if (proposal.type === "skill") return proposal.name;
	if (proposal.type === "rule") return proposal.expectedImpact;
	return proposal.reason;
}

function renderRows(rows: string[][]): string {
	const widths = rows[0].map((_, col) => Math.max(...rows.map(row => row[col].length)));
	return rows
		.map(row =>
			row
				.map((cell, col) => cell.padEnd(widths[col]))
				.join("  ")
				.trimEnd(),
		)
		.join("\n");
}
