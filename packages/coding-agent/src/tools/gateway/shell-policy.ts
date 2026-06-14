import type { RuntimePolicyDescriptor, RuntimePolicyEvaluator } from "./policy-engine";

const CMD_WRAPPERS = new Set(["sudo", "env", "command", "time", "nohup", "exec"]);
const SHELL_INTERPRETERS = new Set(["sh", "bash", "zsh", "dash", "ksh"]);
const MAX_SHELL_NESTING = 4;

export interface BlockWorkingDirChangesParams {
	blockCd?: boolean;
	blockWorktree?: boolean;
	allowedDirs?: string[];
	action?: "deny" | "ask";
	shellTools?: string[];
}

export interface ParsedShellInvocation {
	argv: string[];
	segment: string;
	ambiguous: boolean;
}

export function splitCommandSegments(command: string): string[] {
	const segments: string[] = [];
	let current = "";
	let quote: "'" | '"' | undefined;
	let escaped = false;
	for (let index = 0; index < command.length; index += 1) {
		const ch = command[index];
		const next = command[index + 1];
		if (escaped) {
			current += ch;
			escaped = false;
			continue;
		}
		if (ch === "\\" && quote !== "'") {
			current += ch;
			escaped = true;
			continue;
		}
		if (quote) {
			if (ch === quote) quote = undefined;
			current += ch;
			continue;
		}
		if (ch === "'" || ch === '"') {
			quote = ch;
			current += ch;
			continue;
		}
		if (ch === "\n" || ch === ";" || ch === "|" || (ch === "&" && next === "&")) {
			const trimmed = current.trim();
			if (trimmed) segments.push(trimmed);
			current = "";
			if ((ch === "&" && next === "&") || (ch === "|" && next === "|")) index += 1;
			continue;
		}
		current += ch;
	}
	const trimmed = current.trim();
	if (trimmed) segments.push(trimmed);
	return segments;
}

export function shellWords(segment: string): string[] | undefined {
	const words: string[] = [];
	let current = "";
	let quote: "'" | '"' | undefined;
	let escaped = false;
	for (const ch of segment) {
		if (escaped) {
			current += ch;
			escaped = false;
			continue;
		}
		if (ch === "\\" && quote !== "'") {
			escaped = true;
			continue;
		}
		if (quote) {
			if (ch === quote) quote = undefined;
			else current += ch;
			continue;
		}
		if (ch === "'" || ch === '"') {
			quote = ch;
			continue;
		}
		if (/\s/.test(ch)) {
			if (current.length > 0) {
				words.push(current);
				current = "";
			}
			continue;
		}
		current += ch;
	}
	if (escaped) current += "\\";
	if (quote) return undefined;
	if (current.length > 0) words.push(current);
	return words;
}

export function realInvocationTokens(tokens: string[]): string[] {
	let index = 0;
	while (index < tokens.length) {
		const token = tokens[index];
		if (CMD_WRAPPERS.has(token) || /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(token)) {
			index += 1;
			continue;
		}
		break;
	}
	return tokens.slice(index);
}

export function unwrapShellCommand(tokens: string[]): string | undefined {
	if (tokens.length === 0) return undefined;
	const head = basename(tokens[0]);
	if (SHELL_INTERPRETERS.has(head)) {
		const cIndex = tokens.indexOf("-c");
		return cIndex >= 0 && cIndex + 1 < tokens.length ? tokens[cIndex + 1] : undefined;
	}
	if (head === "eval") return tokens.length > 1 ? tokens.slice(1).join(" ") : undefined;
	return undefined;
}

export function parseShellInvocations(command: string, depth = 0): ParsedShellInvocation[] {
	if (depth > MAX_SHELL_NESTING) return [{ argv: [], segment: command, ambiguous: true }];
	const invocations: ParsedShellInvocation[] = [];
	for (const segment of splitCommandSegments(command)) {
		const words = shellWords(segment);
		if (!words) {
			invocations.push({ argv: [], segment, ambiguous: true });
			continue;
		}
		const argv = realInvocationTokens(words);
		const inner = unwrapShellCommand(argv);
		if (inner !== undefined) {
			invocations.push(...parseShellInvocations(inner, depth + 1));
			continue;
		}
		invocations.push({ argv, segment, ambiguous: false });
	}
	return invocations;
}

export function createBlockWorkingDirChangesPolicy(params: BlockWorkingDirChangesParams = {}): RuntimePolicyEvaluator {
	const blockCd = params.blockCd ?? true;
	const blockWorktree = params.blockWorktree ?? true;
	const allowedDirs = params.allowedDirs ?? [];
	const action = params.action ?? "deny";
	const shellTools = new Set(params.shellTools ?? ["bash"]);
	return event => {
		if (event.type !== "tool_call" || !shellTools.has(event.target)) return undefined;
		const command = (event.data.arguments as { command?: unknown } | undefined)?.command;
		if (typeof command !== "string") return undefined;
		for (const invocation of parseShellInvocations(command)) {
			if (invocation.ambiguous) {
				return verdict(action, "ambiguous shell command requires review", "SHELL_COMMAND_AMBIGUOUS", {
					segment: invocation.segment,
				});
			}
			const reason = classifyWorkingDirViolation(invocation.argv, { blockCd, blockWorktree, allowedDirs });
			if (reason) {
				return verdict(action, reason, "WORKING_DIR_CHANGE_BLOCKED", { argv: invocation.argv });
			}
		}
		return { result: "ALLOW" as const };
	};
}

export const blockWorkingDirChangesPolicyDescriptor: RuntimePolicyDescriptor<BlockWorkingDirChangesParams> = {
	id: "block-working-dir-changes",
	name: "Block working directory changes",
	description: "Blocks shell cd/pushd/popd, git -C, and git worktree management through chained or wrapped commands.",
	paramsSchema: {
		type: "object",
		properties: {
			blockCd: { type: "boolean" },
			blockWorktree: { type: "boolean" },
			allowedDirs: { type: "array", items: { type: "string" } },
			action: { enum: ["deny", "ask"] },
			shellTools: { type: "array", items: { type: "string" } },
		},
	},
	factory: createBlockWorkingDirChangesPolicy,
};

function classifyWorkingDirViolation(
	argv: string[],
	options: { blockCd: boolean; blockWorktree: boolean; allowedDirs: string[] },
): string | undefined {
	if (argv.length === 0) return undefined;
	const command = basename(argv[0]);
	if (options.blockCd && ["cd", "chdir", "pushd", "popd"].includes(command)) {
		const target = argv[1];
		if (target && isAllowedDir(target, options.allowedDirs)) return undefined;
		return `blocked shell working-directory command: ${command}`;
	}
	if (command !== "git") return undefined;
	if (options.blockCd && argv.includes("-C")) {
		const target = argv[argv.indexOf("-C") + 1];
		if (target && isAllowedDir(target, options.allowedDirs)) return undefined;
		return "blocked git -C working-directory switch";
	}
	if (options.blockWorktree && argv[1] === "worktree" && ["add", "move", "remove"].includes(argv[2] ?? "")) {
		return `blocked git worktree ${argv[2]}`;
	}
	return undefined;
}

function verdict(action: "deny" | "ask", reason: string, code: string, details?: Record<string, unknown>) {
	return {
		result: action === "ask" ? ("ASK" as const) : ("DENY" as const),
		reason,
		code,
		details,
	};
}

function basename(path: string): string {
	const normalized = path.replace(/\\/g, "/");
	return normalized.slice(normalized.lastIndexOf("/") + 1);
}

function isAllowedDir(target: string, allowedDirs: string[]): boolean {
	if (allowedDirs.length === 0) return false;
	const normalizedTarget = normalizePath(target);
	return allowedDirs.some(dir => {
		const normalizedDir = normalizePath(dir);
		return normalizedTarget === normalizedDir || normalizedTarget.startsWith(`${normalizedDir}/`);
	});
}

function normalizePath(path: string): string {
	return path.replace(/\\/g, "/").replace(/\/+$/g, "");
}
