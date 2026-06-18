/**
 * Shared types for TUI rendering components.
 */
import type { Theme } from "../modes/interactive/theme/theme.ts";

export type State = "pending" | "running" | "success" | "error" | "warning";

export interface TreeContext {
	index: number;
	isLast: boolean;
	depth: number;
	theme: Theme;
	prefix: string;
	continuePrefix: string;
}
