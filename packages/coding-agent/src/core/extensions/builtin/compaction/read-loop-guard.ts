type ReadInput = {
	path?: unknown;
	offset?: unknown;
	limit?: unknown;
};

type ReadRange = {
	path: string;
	start: number;
	end: number;
};

export class ReadLoopGuard {
	private readonly completedReads: ReadRange[] = [];

	beforeRead(input: unknown): string | undefined {
		const range = toReadRange(input);
		if (!range) return undefined;
		const existing = this.completedReads.find((seen) => overlaps(seen, range));
		if (!existing) return undefined;
		return `Blocked repeated read for ${range.path}:${formatRange(range)} because an identical or overlapping read already ran in this session. Use the previous evidence, request a non-overlapping range, or explain the new unresolved fact that requires a fresh read.`;
	}

	afterRead(input: unknown): void {
		const range = toReadRange(input);
		if (!range) return;
		if (!this.completedReads.some((seen) => sameRange(seen, range))) {
			this.completedReads.push(range);
		}
	}
}

function toReadRange(input: unknown): ReadRange | undefined {
	const value = input as ReadInput | undefined;
	if (!value || typeof value.path !== "string" || value.path.trim() === "") return undefined;
	const start = toPositiveInteger(value.offset) ?? 1;
	const limit = toPositiveInteger(value.limit);
	const end = limit === undefined ? Number.POSITIVE_INFINITY : start + Math.max(0, limit - 1);
	return {
		path: normalizePath(value.path),
		start,
		end,
	};
}

function toPositiveInteger(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
	const integer = Math.floor(value);
	return integer > 0 ? integer : undefined;
}

function normalizePath(path: string): string {
	return path.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\.\//, "");
}

function overlaps(left: ReadRange, right: ReadRange): boolean {
	return left.path === right.path && left.start <= right.end && right.start <= left.end;
}

function sameRange(left: ReadRange, right: ReadRange): boolean {
	return left.path === right.path && left.start === right.start && left.end === right.end;
}

function formatRange(range: ReadRange): string {
	return Number.isFinite(range.end) ? `${range.start}-${range.end}` : `${range.start}-EOF`;
}
