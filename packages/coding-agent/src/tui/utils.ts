/**
 * Shared helpers for tool-rendered UI components.
 */
import { visibleWidth } from "@steve-8000/amaze-tui";
import type { Theme, ThemeBg } from "../modes/interactive/theme/theme.ts";
import { padding } from "./compat.ts";
import type { State } from "./types.ts";

export { truncateToWidth } from "@steve-8000/amaze-tui";

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const U64_MASK = 0xffffffffffffffffn;

/**
 * Incremental render-cache key builder (FNV-1a 64-bit over a delimited buffer).
 *
 * Replaces the upstream `Bun.hash.xxHash64` chain with a Node-portable hash.
 * Only used to detect whether render inputs changed, so the exact algorithm is
 * irrelevant as long as it is deterministic and well-distributed.
 */
export class Hasher {
	#s = "";

	/** Feed a string. */
	str(s: string): this {
		this.#s += `\x01${s.length}\x01${s}`;
		return this;
	}

	/** Feed an unsigned 32-bit integer. */
	u32(n: number): this {
		this.#s += `\x02${n >>> 0}`;
		return this;
	}

	/** Feed a 64-bit bigint. */
	u64(n: bigint): this {
		this.#s += `\x03${n}`;
		return this;
	}

	/** Feed a boolean. */
	bool(b: boolean): this {
		this.#s += b ? "\x04" : "\x05";
		return this;
	}

	/** Feed a value that may be `undefined` or `null` (hashed as a sentinel). */
	optional(v: string | undefined | null): this {
		this.#s += v == null ? "\x06" : `\x07${v}`;
		return this;
	}

	/** Return the final hash digest. */
	digest(): bigint {
		let h = FNV_OFFSET;
		const s = this.#s;
		for (let i = 0; i < s.length; i++) {
			h ^= BigInt(s.charCodeAt(i));
			h = (h * FNV_PRIME) & U64_MASK;
		}
		return h;
	}
}

/** Render-cache entry used by tool renderers. */
export interface RenderCache {
	key: bigint;
	lines: string[];
}

export function buildTreePrefix(ancestors: boolean[], theme: Theme): string {
	return ancestors.map((hasNext) => (hasNext ? `${theme.tree.vertical}  ` : "   ")).join("");
}

export function getTreeBranch(isLast: boolean, theme: Theme): string {
	return isLast ? theme.tree.last : theme.tree.branch;
}

export function getTreeContinuePrefix(isLast: boolean, theme: Theme): string {
	return isLast ? "   " : `${theme.tree.vertical}  `;
}

export function padToWidth(text: string, width: number, bgFn?: (s: string) => string): string {
	if (width <= 0) return bgFn ? bgFn(text) : text;
	const paddingNeeded = Math.max(0, width - visibleWidth(text));
	const padded = paddingNeeded > 0 ? text + padding(paddingNeeded) : text;
	return bgFn ? bgFn(padded) : padded;
}

export function getStateBgColor(state: State): ThemeBg {
	if (state === "success") return "toolSuccessBg";
	if (state === "error") return "toolErrorBg";
	return "toolPendingBg";
}
