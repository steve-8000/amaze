import { Settings } from "@steve-z8k/pi-coding-agent/config/settings";
import { buildSystemPrompt } from "@steve-z8k/pi-coding-agent/system-prompt";
import { createTools, type Tool, type ToolSession } from "@steve-z8k/pi-coding-agent/tools";

await Settings.init({ inMemory: true, cwd: process.cwd() });
const settings = Settings.isolated({});

const session: ToolSession = {
	cwd: process.cwd(),
	hasUI: false,
	getSessionFile: () => null,
	getSessionSpawns: () => "*",
	settings,
} as ToolSession;

const tools = await createTools(session);
const toolsMap = new Map<string, Tool>(tools.map(tool => [tool.name, tool]));

const built = await buildSystemPrompt({
	tools: toolsMap as never,
	toolNames: tools.map(tool => tool.name),
	inlineToolDescriptors: false,
	nativeTools: true,
	cwd: process.cwd(),
	skills: [],
	contextFiles: [],
	workspaceTree: { rootPath: process.cwd(), rendered: "", truncated: false, totalLines: 0, agentsMdFiles: [] },
});

const parts = built.systemPrompt;
for (const [index, part] of parts.entries()) {
	if (index > 0) {
		console.log("");
	}
	console.log(`--- system prompt part ${index + 1}/${parts.length} ---`);
	console.log(part);
}
