/**
 * Cached bordered-box component for tool result text.
 *
 * Wraps already-formatted output text in a `renderOutputBlock` border and caches
 * the rendered lines per (text, title, state, width) so the expensive box layout
 * runs only when inputs actually change — not on every TUI frame.
 */
import type { Component } from "@steve-8000/amaze-tui";
import type { Theme, ThemeColor } from "../modes/interactive/theme/theme.ts";
import { renderOutputBlock } from "./output-block.ts";
import type { State } from "./types.ts";

export class CachedTextBox implements Component {
	#text = "";
	#title?: string;
	#state: State = "success";
	#borderColor?: ThemeColor;
	#applyBg = true;
	#theme: Theme;
	#cacheWidth?: number;
	#cacheLines?: string[];
	#sig = "\u0000";

	constructor(theme: Theme) {
		this.#theme = theme;
	}

	/** Update box contents. Clears the render cache only when something changed. */
	set(opts: { text: string; title?: string; state?: State; borderColor?: ThemeColor; applyBg?: boolean }): this {
		const state = opts.state ?? "success";
		const applyBg = opts.applyBg ?? true;
		const sig = `${state}\u0000${opts.borderColor ?? ""}\u0000${applyBg ? 1 : 0}\u0000${opts.title ?? ""}\u0000${opts.text}`;
		if (sig !== this.#sig) {
			this.#text = opts.text;
			this.#title = opts.title;
			this.#state = state;
			this.#borderColor = opts.borderColor;
			this.#applyBg = applyBg;
			this.#sig = sig;
			this.#cacheLines = undefined;
		}
		return this;
	}

	invalidate(): void {
		this.#cacheLines = undefined;
	}

	render(width: number): string[] {
		if (this.#cacheLines && this.#cacheWidth === width) {
			return this.#cacheLines;
		}
		const contentLines = this.#text.length > 0 ? this.#text.split("\n") : [];
		this.#cacheLines = renderOutputBlock(
			{
				header: this.#title,
				state: this.#state,
				borderColor: this.#borderColor,
				applyBg: this.#applyBg,
				sections: [{ lines: contentLines }],
				width,
			},
			this.#theme,
		);
		this.#cacheWidth = width;
		return this.#cacheLines;
	}
}
