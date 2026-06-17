import { loadExtensionFromFactory, createExtensionRuntime } from "../packages/coding-agent/dist/core/extensions/loader.js";
import { createEventBus } from "../packages/coding-agent/dist/core/event-bus.js";
import amazeSearch from "../packages/coding-agent/dist/core/extensions/builtin/amaze-search/index.js";

const PROJ = "/tmp/soc-proj";
const ext = await loadExtensionFromFactory(amazeSearch, PROJ, createEventBus(), createExtensionRuntime(), "<verify>");
const call = (n,a={}) => ext.tools.get(n).definition.execute("t",{ projectPath: PROJ, ...a }, undefined, undefined, { cwd: PROJ }).then(r=>r.content[0].text);

console.log("== index_build =="); console.log((await call("index_build")).slice(0,300));
for (let i=0;i<40;i++){
  await new Promise(r=>setTimeout(r,5000));
  const s = await call("index_status");
  const line = s.split("\n").find(l=>/%|complete|indexed|ready|error|fail/i.test(l)) || s.slice(0,80);
  console.log(`status[${i}]`, line.slice(0,120));
  if (/100%|complete|ready|finished/i.test(s)) break;
  if (/error|fail/i.test(s)) break;
}
console.log("== search_query 'authentication middleware' ==");
console.log((await call("search_query",{ query:"authentication middleware" })).slice(0,500));
