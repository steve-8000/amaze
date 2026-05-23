const STATIC_MEMORY_OPEN_RE = /<nexus-memory-summary\b[^>]*>/gi;
const STATIC_MEMORY_CLOSE_RE = /<\/nexus-memory-summary>/gi;
const INSTRUCTIONS_FENCE_RE = /^```instructions\b[\s\S]*?^```\s*$/gim;
const SYSTEM_DIRECTIVE_LINE_RE = /^.*(?:^<system-directive\b|system-directive>\s*$).*$/gim;

export function stripStaticMemoryFences(input: string): string {
	let previous = input;
	while (true) {
		const next = previous.replace(STATIC_MEMORY_OPEN_RE, "").replace(STATIC_MEMORY_CLOSE_RE, "");
		if (next === previous) return next;
		previous = next;
	}
}

export function sanitizeStaticMemoryBody(input: string): string {
	return stripStaticMemoryFences(input)
		.replace(INSTRUCTIONS_FENCE_RE, "")
		.replace(SYSTEM_DIRECTIVE_LINE_RE, "")
		.trim();
}

export function wrapStaticMemoryBlock(body: string): string {
	return `<nexus-memory-summary>\n${sanitizeStaticMemoryBody(body)}\n</nexus-memory-summary>`;
}
