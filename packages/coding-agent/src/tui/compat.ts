/**
 * Local compat shims for box/tool renderers ported from upstream.
 * Local `@steve-8000/amaze-tui` does not export these; code/output boxes only
 * need plain-text rendering, so image protocols are stubbed out.
 */
export function padding(n: number): string {
	return " ".repeat(Math.max(0, n));
}

export const ImageProtocol = {
	None: "none",
	Sixel: "sixel",
	ITerm: "iterm",
	Kitty: "kitty",
} as const;

const colorterm = process.env.COLORTERM ?? "";
export const TERMINAL = {
	trueColor: colorterm.includes("truecolor") || colorterm.includes("24bit"),
	imageProtocol: ImageProtocol.None as string,
};
