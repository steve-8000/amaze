import { padding, type SelectItem, SelectList, type SgrMouseEvent, truncateToWidth, visibleWidth } from "@amaze/pi-tui";
import {
	getCurrentThemeName,
	getSelectListTheme,
	previewTheme,
	type SymbolPreset,
	setColorBlindMode,
	setSymbolPreset,
	theme,
} from "../../theme/theme";
import type { SetupScene, SetupSceneController, SetupSceneHost } from "./types";

type ThemeMode = "curated" | "all";

const CURATED_ITEMS: readonly SelectItem[] = [
	{
		value: "theme:erid",
		label: "Erid",
		description: "Amaze's fixed orbital theme",
	},
];

function fitLine(line: string, width: number): string {
	const truncated = truncateToWidth(line, width);
	return truncated + padding(Math.max(0, width - visibleWidth(truncated)));
}

function fillStyledLine(content: string, width: number): string {
	return content + padding(Math.max(0, width - visibleWidth(content)));
}

function renderMockStatusLine(width: number): string {
	const sep = theme.fg("statusLineSep", ` ${theme.sep.pipe} `);
	const left = [
		theme.fg("statusLineModel", `${theme.icon.model} sonnet`),
		theme.fg("statusLinePath", "~/project"),
		theme.fg("statusLineGitDirty", `${theme.icon.git} main +2`),
	].join(sep);
	const right = [
		theme.fg("statusLineContext", `${theme.icon.context} 42%`),
		theme.fg("statusLineCost", `${theme.icon.cost} 0.18`),
	].join(sep);
	const innerWidth = Math.max(1, width - 2);
	const leftWidth = visibleWidth(left);
	const rightWidth = visibleWidth(right);
	const gap = padding(Math.max(1, innerWidth - leftWidth - rightWidth - 2));
	return theme.bg("statusLineBg", fitLine(` ${left}${gap}${right} `, width));
}

function renderMockEditor(width: number): string[] {
	const box = theme.boxRound;
	const innerWidth = Math.max(1, width - 2);
	const horizontal = box.horizontal.repeat(innerWidth);
	const top = theme.fg("borderAccent", `${box.topLeft}${horizontal}${box.topRight}`);
	const bottom = theme.fg("borderMuted", `${box.bottomLeft}${horizontal}${box.bottomRight}`);
	const prompt = `${theme.fg("accent", ">")} ${theme.fg("text", "Ask Amaze, edit files, run tools")}${theme.inverse(" ")}`;
	const hint = theme.fg("dim", "enter send · shift+enter newline · / commands");
	return [
		top,
		`${theme.fg("borderAccent", box.vertical)}${fitLine(prompt, innerWidth)}${theme.fg("borderAccent", box.vertical)}`,
		`${theme.fg("borderMuted", box.vertical)}${fillStyledLine(hint, innerWidth)}${theme.fg("borderMuted", box.vertical)}`,
		bottom,
	];
}

function renderThemePreview(width: number): string[] {
	const previewWidth = Math.max(24, Math.min(width, 88));
	return [
		theme.bold("Preview"),
		`${theme.fg("success", `${theme.status.success} success`)}  ${theme.fg("warning", `${theme.status.warning} warning`)}  ${theme.fg("error", `${theme.status.error} error`)}  ${theme.fg("accent", "accent")}`,
		"",
		theme.fg("muted", "Status line"),
		renderMockStatusLine(previewWidth),
		theme.fg("muted", "Editor"),
		...renderMockEditor(previewWidth),
	];
}

class ThemeSceneController implements SetupSceneController {
	title = "Lock in Erid";
	subtitle = "Amaze ships one theme now. Enter keeps Erid; Esc skips this step.";
	#mode: ThemeMode = "curated";
	#selectList: SelectList;
	#loadingAllThemes = false;
	#message: string | undefined;
	#previewRequest = 0;
	#disposed = false;
	/** Render line where the select list began, or -1 while it is not shown. */
	#listRowStart = -1;
	readonly #originalTheme = getCurrentThemeName();
	readonly #originalSymbolPreset: SymbolPreset;
	readonly #originalColorBlindMode: boolean;

	constructor(private readonly host: SetupSceneHost) {
		this.#originalSymbolPreset = host.ctx.settings.get("symbolPreset");
		this.#originalColorBlindMode = host.ctx.settings.get("colorBlindMode");
		this.#selectList = this.#createSelectList(CURATED_ITEMS, this.#currentCuratedIndex());
	}

	dispose(): void {
		this.#disposed = true;
	}

	invalidate(): void {
		this.#selectList.invalidate();
	}

	handleInput(data: string): void {
		const quickIndex = data >= "1" && data <= "9" ? Number(data) - 1 : -1;
		if (quickIndex >= 0) {
			this.#selectList.setSelectedIndex(quickIndex);
			this.#previewByIndex(quickIndex);
			return;
		}
		this.#selectList.handleInput(data);
	}

	/** Wheel moves the highlight (live preview); hover lights the row under the pointer; click confirms it. */
	routeMouse(event: SgrMouseEvent, line: number, _col: number): void {
		if (event.wheel !== null) {
			this.#selectList.handleWheel(event.wheel);
			return;
		}
		const index = this.#listRowStart >= 0 ? this.#selectList.hitTest(line - this.#listRowStart) : undefined;
		if (event.motion) {
			this.#selectList.setHoverIndex(index ?? null);
			return;
		}
		if (event.leftClick && index !== undefined) {
			this.#selectList.clickItem(index);
		}
	}

	render(width: number): readonly string[] {
		const lines = [
			theme.fg("muted", "Erid previews live. Nothing is saved until you press Enter."),
			theme.fg("dim", "Esc skips this step"),
			"",
			...renderThemePreview(width),
			"",
		];
		if (this.#loadingAllThemes) {
			this.#listRowStart = -1;
			lines.push(theme.fg("dim", "Loading themes…"));
		} else {
			this.#listRowStart = lines.length;
			lines.push(...this.#selectList.render(width));
		}
		if (this.#message) {
			lines.push("", this.#message);
		}
		return lines;
	}

	#createSelectList(items: readonly SelectItem[], selectedIndex: number): SelectList {
		const list = new SelectList(items, Math.min(10, Math.max(1, items.length)), getSelectListTheme());
		list.setSelectedIndex(selectedIndex);
		list.onSelectionChange = item => {
			void this.#preview(item.value);
		};
		list.onSelect = item => {
			void this.#select(item.value);
		};
		list.onCancel = () => {
			if (this.#mode === "all") {
				this.#mode = "curated";
				this.#selectList = this.#createSelectList(CURATED_ITEMS, this.#currentCuratedIndex());
				this.host.requestRender();
				return;
			}
			this.#restorePreview();
			this.host.finish("skipped");
		};
		return list;
	}

	#currentCuratedIndex(): number {
		return 0;
	}

	#previewByIndex(index: number): void {
		const items = this.#mode === "curated" ? CURATED_ITEMS : undefined;
		const value = items?.[index]?.value;
		if (value) void this.#preview(value);
	}

	async #select(value: string): Promise<void> {
		await this.#commit(value);
		this.host.finish("done");
	}

	async #commit(value: string): Promise<void> {
		const themeName = this.#themeNameFromValue(value) ?? "erid";
		await this.#applyPreviewPresentation(this.#originalSymbolPreset, this.#originalColorBlindMode);
		this.host.ctx.settings.set("theme.dark", "erid");
		this.host.ctx.settings.set("theme.light", "erid");
		await previewTheme(themeName);
	}

	async #preview(value: string): Promise<void> {
		const request = ++this.#previewRequest;
		this.#message = undefined;

		let result: { success: boolean; error?: string } = { success: true };
		const themeName = this.#themeNameFromValue(value) ?? "erid";
		await this.#applyPreviewPresentation(this.#originalSymbolPreset, this.#originalColorBlindMode);
		result = await previewTheme(themeName);
		if (request !== this.#previewRequest || this.#disposed) return;
		if (!result.success) {
			this.#message = theme.fg("error", result.error ?? "Theme preview failed");
		}
		this.host.ctx.ui.invalidate();
		this.host.requestRender();
	}

	async #applyPreviewPresentation(symbolPreset: SymbolPreset, colorBlindMode: boolean): Promise<void> {
		await setSymbolPreset(symbolPreset);
		await setColorBlindMode(colorBlindMode);
	}

	#restorePreview(): void {
		void (async () => {
			await this.#applyPreviewPresentation(this.#originalSymbolPreset, this.#originalColorBlindMode);
			if (this.#originalTheme) {
				await previewTheme(this.#originalTheme);
			}
			this.host.ctx.ui.invalidate();
			this.host.requestRender();
		})();
	}

	#themeNameFromValue(value: string): string | undefined {
		return value.startsWith("theme:") ? value.slice("theme:".length) : undefined;
	}
}

export const themeSetupScene: SetupScene = {
	id: "theme",
	title: "Pick a theme",
	minVersion: 1,
	mount: host => new ThemeSceneController(host),
};
