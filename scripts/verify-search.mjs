import { loadExtensionFromFactory, createExtensionRuntime } from "../packages/coding-agent/dist/core/extensions/loader.js";
import { createEventBus } from "../packages/coding-agent/dist/core/event-bus.js";
import amazeSearch from "../packages/coding-agent/dist/core/extensions/builtin/amaze-search/index.js";
const ext = await loadExtensionFromFactory(amazeSearch, process.cwd(), createEventBus(), createExtensionRuntime(), "<builtin:amaze-search>");
console.log("count:", ext.tools.size);
console.log("tools:", [...ext.tools.keys()].join(", "));
