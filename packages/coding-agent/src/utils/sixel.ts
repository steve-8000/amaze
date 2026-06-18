/**
 * Sixel image detection stub. Code/output boxes render text only, so no line
 * carries an inline image mask.
 */
export function getSixelLineMask(lines: string[]): boolean[] {
	return lines.map(() => false);
}
