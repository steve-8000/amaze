#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { RockyMemory } from "./core/memory";
import { runDiagnostics } from "./diagnose";

type Scope = {
	kind?: "global" | "project" | "path";
	project_path?: string | null;
	path?: string | null;
};

type Request = {
	op: string;
	text?: string;
	content?: string | null;
	query?: string;
	id?: string | null;
	source?: string | null;
	tags?: string[];
	scope?: Scope;
	limit?: number;
	importance?: number | null;
	text_prefix?: string | null;
};

function scopeKey(scope: Scope | undefined): string {
	if (!scope || scope.kind === "global") return "global";
	if (scope.kind === "path") return `path:${scope.project_path ?? ""}:${scope.path ?? ""}`;
	return `project:${scope.project_path ?? ""}`;
}

function scopeMetadata(scope: Scope | undefined): Record<string, string | null> {
	return {
		kind: scope?.kind ?? "global",
		project_path: scope?.project_path ?? null,
		path: scope?.path ?? null,
	};
}

function bankFor(scope: Scope | undefined): string {
	const key = scopeKey(scope);
	if (key === "global") return "global";
	const digest = createHash("sha1").update(key).digest("hex").slice(0, 16);
	return `${scope?.kind ?? "project"}-${digest}`;
}

function sessionFor(scope: Scope | undefined): string {
	const key = scopeKey(scope);
	return createHash("sha1").update(key).digest("hex").slice(0, 16);
}

function cleanLimit(limit: number | undefined): number {
	return Math.max(1, Math.min(100, Math.floor(Number.isFinite(limit) ? Number(limit) : 8)));
}

function serialize(value: unknown): unknown {
	return JSON.parse(JSON.stringify(value, (_key, inner) => (typeof inner === "bigint" ? inner.toString() : inner)));
}

function itemFromResult(result: Record<string, unknown>, scope: Scope | undefined): Record<string, unknown> {
	return {
		...result,
		id: result.id,
		text: result.content ?? result.text ?? "",
		content: result.content ?? result.text ?? "",
		scope: scopeKey(scope),
		source: result.source,
		created_at: result.timestamp ?? result.created_at,
		updated_at: result.timestamp ?? result.updated_at,
		score: result.score,
	};
}

async function withMemory<T>(scope: Scope | undefined, fn: (memory: RockyMemory) => T | Promise<T>): Promise<T> {
	const memory = new RockyMemory({
		bank: bankFor(scope),
		sessionId: sessionFor(scope),
		channelId: scopeKey(scope),
	});
	try {
		const result = await fn(memory);
		await memory.flushExtractions();
		return result;
	} finally {
		memory.close();
	}
}

async function handle(request: Request): Promise<Record<string, unknown>> {
	const scope = request.scope;
	if (request.op === "store") {
		const text = request.text ?? request.content ?? "";
		const id = await withMemory(scope, memory =>
			memory.remember(text, {
				source: request.source ?? "amaze",
				metadata: { scope: scopeMetadata(scope), tags: request.tags ?? [] },
				scope: scope?.kind ?? "global",
				extractEntities: true,
			}),
		);
		return {
			ok: true,
			item: {
				id,
				text,
				content: text,
				source: request.source ?? "amaze",
				tags: request.tags ?? [],
				scope: scopeKey(scope),
			},
		};
	}

	if (request.op === "recall") {
		const query = request.query ?? "";
		const items = await withMemory(scope, memory => memory.recall(query, cleanLimit(request.limit)));
		return {
			ok: true,
			items: (serialize(items) as Record<string, unknown>[]).map(item => itemFromResult(item, scope)),
		};
	}

	if (request.op === "delete") {
		const id = request.id;
		if (!id) return { ok: false, error: "id is required", deleted: 0 };
		const deleted = await withMemory(scope, memory => (memory.forget(id) ? 1 : 0));
		return { ok: true, deleted };
	}

	if (request.op === "update") {
		const id = request.id;
		if (!id) return { ok: false, error: "id is required", updated: 0 };
		const updated = await withMemory(scope, memory =>
			memory.update(id, request.content ?? null, request.importance ?? null) ? 1 : 0,
		);
		return { ok: true, updated };
	}

	if (request.op === "invalidate") {
		const id = request.id;
		if (!id) return { ok: false, error: "id is required", invalidated: 0 };
		const invalidated = await withMemory(scope, memory => (memory.beam.invalidate(id) ? 1 : 0));
		return { ok: true, invalidated };
	}

	if (request.op === "stats") {
		const stats = await withMemory(scope, memory => memory.getStats());
		return { ok: true, stats: serialize(stats) };
	}

	if (request.op === "diagnose") {
		return { ok: true, diagnostics: serialize(runDiagnostics()) };
	}

	if (request.op === "optimize") {
		const result = await withMemory(scope, memory => memory.sleep(false));
		return { ok: true, ...(serialize(result) as Record<string, unknown>) };
	}

	return { ok: false, error: `unknown op: ${request.op}` };
}

const input = await Bun.stdin.text();
try {
	const request = JSON.parse(input) as Request;
	const response = await handle(request);
	Bun.stdout.write(`${JSON.stringify(response)}\n`);
} catch (error) {
	Bun.stdout.write(
		`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`,
	);
	process.exitCode = 1;
}
