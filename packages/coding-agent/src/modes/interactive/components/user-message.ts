import { Box, Container, Markdown, type MarkdownTheme } from "@steve-8000/amaze-tui";
import { renderOutputBlock, trimBlankEdges } from "../../../tui/output-block.ts";
import { getMarkdownTheme, theme } from "../theme/theme.ts";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

/**
 * Component that renders a user message
 */
export class UserMessageComponent extends Container {
	private contentBox: Box;

	constructor(text: string, markdownTheme: MarkdownTheme = getMarkdownTheme()) {
		super();
		this.contentBox = new Box(0, 1, (content: string) => theme.bg("userMessageBg", content));
		this.contentBox.addChild(
			new Markdown(
				text,
				0,
				0,
				markdownTheme,
				{
					color: (content: string) => theme.fg("userMessageText", content),
				},
				{ preserveOrderedListMarkers: true },
			),
		);
		this.addChild(this.contentBox);
	}

	override render(width: number): string[] {
		const content = trimBlankEdges(super.render(Math.max(1, width - 2)));
		if (content.length === 0) {
			return content;
		}
		// User prompt rendered as an accent-bordered card.
		const lines = renderOutputBlock(
			{
				header: "📢 User Prompt",
				state: "success",
				borderColor: "warning",
				applyBg: false,
				sections: [{ lines: content }],
				width,
			},
			theme,
		);
		lines[0] = OSC133_ZONE_START + lines[0];
		lines[lines.length - 1] = OSC133_ZONE_END + OSC133_ZONE_FINAL + lines[lines.length - 1];
		return lines;
	}
}
