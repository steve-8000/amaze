import { loadExtensionFromFactory, createExtensionRuntime } from "../packages/coding-agent/dist/core/extensions/loader.js";
import { createEventBus } from "../packages/coding-agent/dist/core/event-bus.js";
import amazeTools from "../packages/coding-agent/dist/core/extensions/builtin/amaze-tools/index.js";

const ext = await loadExtensionFromFactory(
	amazeTools,
	process.cwd(),
	createEventBus(),
	createExtensionRuntime(),
	"<builtin:amaze-tools>",
);

console.log("tools:", [...ext.tools.keys()].sort());
console.log("commands:", [...ext.commands.keys()].sort());
console.log("event handlers:", [...ext.handlers.keys()].sort());
