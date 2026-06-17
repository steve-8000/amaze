import { createExtensionModuleImporter } from "../packages/coding-agent/dist/core/extensions/loader.js";
import { resolve } from "node:path";
const importer = createExtensionModuleImporter();
for (const f of ["query-tools","index-tools","graph-tools","context-tools","manage-tools"]) {
  try {
    const mod = await importer.import(resolve("vendor/socraticode/src/tools/" + f + ".ts"), { default: false });
    console.log(f, "->", Object.keys(mod).filter(k=>k.startsWith("handle")));
  } catch (e) {
    console.error(f, "FAILED:", e.message.split("\n")[0]);
  }
}
