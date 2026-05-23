export interface EscapeFts5QueryOptions {
	advanced?: boolean;
}

export function escapeFts5Query(query: string, opts?: EscapeFts5QueryOptions): string {
	if (opts?.advanced) return query;
	return `"${query.replace(/"/g, '""')}"`;
}
