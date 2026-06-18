/**
 * Wraps an arbitrary inner component's rendered output in a bordered box.
 *
 * Used for tools whose result renderers are custom components (bash output with
 * inline images / truncation, edit diffs) so they get the same boxed UI as the
 * text-based tools without rewriting their internals. The inner component is kept
 * accessible via {@link inner} so callers can reuse it across render passes.
 *
 * Per-frame cost is absorbed by the outer ToolExecutionComponent cache; this also
 * memoizes its own output by (state, width, inner output).
 */
import type { Component } from "@steve-8000/amaze-tui";
import type { Theme } from "../modes/interactive/theme/theme.ts";
import { renderOutputBlock } from "./output-block.ts";
import type { State } from "./types.ts";

/** Status glyph shown in the box header so no box ever has an empty title. */
function stateIcon(state: State, theme: Theme): string {
	switch (state) {
		case "error":
			return theme.fg("error", "\u2718");
		case "warning":
			return theme.fg("warning", "\u26a0");
		case "running":
		case "pending":
			return theme.fg("accent", "\u25cf");
		default:
			return theme.fg("success", "\u2714");
	}
}

export class BoxWrapper implements Component {
	inner: Component;
	#theme: Theme;
	#state: State = "success";
	#header = "";
	#cacheWidth?: number;
	#cacheLines?: string[];
	#innerSig?: string;

	constructor(inner: Component, theme: Theme, header = "") {
		this.inner = inner;
		this.#theme = theme;
		this.#header = header;
	}

	setState(state: State): this {
		if (state !== this.#state) {
			this.#state = state;
			this.#cacheLines = undefined;
		}
		return this;
	}

	setHeader(header: string): this {
		if (header !== this.#header) {
			this.#header = header;
			this.#cacheLines = undefined;
		}
		return this;
	}

	invalidate(): void {
		this.inner.invalidate?.();
		this.#cacheLines = undefined;
	}

	render(width: number): string[] {
		// Inner renders into the box interior (border is "│ " + " │" ≈ 4 columns).
		const innerWidth = Math.max(1, width - 4);
		const innerLines = this.inner.render(innerWidth);
		const sig = `${this.#state}\u0000${this.#header}\u0000${innerLines.join("\n")}`;
		if (this.#cacheLines && this.#cacheWidth === width && this.#innerSig === sig) {
			return this.#cacheLines;
		}
		// Always render a header (status icon + label) so the top border is never blank.
		const label = this.#header || (this.#state === "error" ? "Failed" : "Done");
		const header = `${stateIcon(this.#state, this.#theme)} ${label}`;
		this.#cacheLines = renderOutputBlock(
			{ header, state: this.#state, sections: [{ lines: innerLines }], width },
			this.#theme,
		);
		this.#cacheWidth = width;
		this.#innerSig = sig;
		return this.#cacheLines;
	}
}
