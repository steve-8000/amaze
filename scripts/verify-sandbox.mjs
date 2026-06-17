import { loadExtensionFromFactory, createExtensionRuntime } from "../packages/coding-agent/dist/core/extensions/loader.js";
import { createEventBus } from "../packages/coding-agent/dist/core/event-bus.js";
import amazeSandbox from "../packages/coding-agent/dist/core/extensions/builtin/amaze-sandbox/index.js";
const ext = await loadExtensionFromFactory(amazeSandbox, process.cwd(), createEventBus(), createExtensionRuntime(), "<builtin:amaze-sandbox>");
console.log("tools:", [...ext.tools.keys()]);
const t = ext.tools.get("sandbox_exec");
if (t) {
  const r = await t.definition.execute("t1", { command: "echo amaze-sandbox-ok && uname -s" }, undefined, undefined, { cwd: process.cwd() });
  console.log("result:", r.content[0].text);
}
