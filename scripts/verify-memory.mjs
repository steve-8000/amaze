import { loadExtensionFromFactory, createExtensionRuntime } from "../packages/coding-agent/dist/core/extensions/loader.js";
import { createEventBus } from "../packages/coding-agent/dist/core/event-bus.js";
import amazeMemory from "../packages/coding-agent/dist/core/extensions/builtin/amaze-memory/index.js";
const ext = await loadExtensionFromFactory(amazeMemory, process.cwd(), createEventBus(), createExtensionRuntime(), "<builtin:amaze-memory>");
console.log("tools:", [...ext.tools.keys()]);
const recall = ext.tools.get("mem_recall");
if (recall) {
  const r = await recall.definition.execute("t1", { query: "favorite color" }, undefined, undefined, { cwd: process.cwd() });
  console.log("mem_recall result:", JSON.stringify(r.content[0].text).slice(0,160));
}
