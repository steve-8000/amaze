import { loadExtensionFromFactory, createExtensionRuntime } from "../packages/coding-agent/dist/core/extensions/loader.js";
import { createEventBus } from "../packages/coding-agent/dist/core/event-bus.js";
import amazeSearch from "../packages/coding-agent/dist/core/extensions/builtin/amaze-search/index.js";
const ext = await loadExtensionFromFactory(amazeSearch, process.cwd(), createEventBus(), createExtensionRuntime(), "<builtin:amaze-search>");
const tool = ext.tools.get("index_health").definition;
const res = await tool.execute("t1", {}, undefined, undefined, { cwd: process.cwd() });
console.log("RESULT TYPE:", typeof res.content[0].text);
console.log(String(res.content[0].text).slice(0, 400));
