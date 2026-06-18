/**
 * Shared sharp-border chrome for fullscreen overlays.
 *
 * Mirrors the upstream oh-my-pi overlay box helpers while keeping the current
 * theme instance explicit, so extension-loaded overlays do not depend on a
 * shared module-global theme cache.
 */
import { truncateToWidth, visibleWidth } from "@steve-8000/amaze-tui";
import type { Theme } from "../theme/theme.ts";

function padding(width: number): string {
	return " ".repeat(Math.max(0, width));
}

/** Pad or truncate a possibly ANSI-styled string to exactly `width` columns. */
export function fit(text: string, width: number): string {
	if (width <= 0) return "";
	const w = visibleWidth(text);
	if (w === width) return text;
	if (w < width) return text + padding(width - w);
	const cut = truncateToWidth(text, width);
	const cw = visibleWidth(cut);
	return cw < width ? cut + padding(width - cw) : cut;
}

function paint(theme: Theme, s: string): string {
	return theme.fg("border", s);
}

/** Top border with an optional accent-colored title inset into the rule. */
export function topBorder(theme: Theme, width: number, title = ""): string {
	const box = theme.boxSharp;
	const inner = Math.max(0, width - 2);
	if (!title) return paint(theme, box.topLeft + box.horizontal.repeat(inner) + box.topRight);
	const shown = truncateToWidth(` ${title} `, Math.max(0, inner - 2));
	const fillWidth = Math.max(0, inner - 1 - visibleWidth(shown));
	return (
		paint(theme, box.topLeft + box.horizontal) +
		theme.bold(theme.fg("accent", shown)) +
		paint(theme, box.horizontal.repeat(fillWidth) + box.topRight)
	);
}

/** A horizontal rule with left/right tees, splitting overlay sections. */
export function divider(theme: Theme, width: number): string {
	const box = theme.boxSharp;
	return paint(theme, box.teeRight + box.horizontal.repeat(Math.max(0, width - 2)) + box.teeLeft);
}

export function bottomBorder(theme: Theme, width: number): string {
	const box = theme.boxSharp;
	return paint(theme, box.bottomLeft + box.horizontal.repeat(Math.max(0, width - 2)) + box.bottomRight);
}

/** Wrap pre-styled content in vertical borders with single-column insets. */
export function row(theme: Theme, content: string, width: number): string {
	const box = theme.boxSharp;
	return `${paint(theme, box.vertical)} ${fit(content, Math.max(0, width - 4))} ${paint(theme, box.vertical)}`;
}

function splitDividerCol(sidebarWidth: number): number {
	return sidebarWidth + 3;
}

/** Body content width for a two-column overlay of total `width`. */
export function splitBodyWidth(width: number, sidebarWidth: number): number {
	return Math.max(0, width - sidebarWidth - 7);
}

/** Top border carrying the title, split by a `┬` over the column divider. */
export function topBorderSplit(theme: Theme, width: number, title: string, sidebarWidth: number): string {
	const box = theme.boxSharp;
	const dividerCol = splitDividerCol(sidebarWidth);
	const leftLen = Math.max(0, dividerCol - 1);
	const rightLen = Math.max(0, width - 2 - dividerCol);
	let left: string;
	if (!title) {
		left = paint(theme, box.topLeft + box.horizontal.repeat(leftLen));
	} else {
		const shown = truncateToWidth(` ${title} `, Math.max(0, leftLen - 1));
		const fillWidth = Math.max(0, leftLen - 1 - visibleWidth(shown));
		left =
			paint(theme, box.topLeft + box.horizontal) +
			theme.bold(theme.fg("accent", shown)) +
			paint(theme, box.horizontal.repeat(fillWidth));
	}
	return left + paint(theme, box.teeDown + box.horizontal.repeat(rightLen) + box.topRight);
}

/** Section rule that closes the sidebar column with a `┴` over the divider. */
export function dividerSplit(theme: Theme, width: number, sidebarWidth: number): string {
	const box = theme.boxSharp;
	const dividerCol = splitDividerCol(sidebarWidth);
	const leftLen = Math.max(0, dividerCol - 1);
	const rightLen = Math.max(0, width - 2 - dividerCol);
	return paint(
		theme,
		box.teeRight + box.horizontal.repeat(leftLen) + box.teeUp + box.horizontal.repeat(rightLen) + box.teeLeft,
	);
}

/** A two-column content row: `│ sidebar │ body │`, each inset by one column. */
export function splitRow(theme: Theme, sidebar: string, body: string, width: number, sidebarWidth: number): string {
	const box = theme.boxSharp;
	const bodyWidth = splitBodyWidth(width, sidebarWidth);
	const bar = paint(theme, box.vertical);
	return `${bar} ${fit(sidebar, sidebarWidth)} ${bar} ${fit(body, bodyWidth)} ${bar}`;
}
