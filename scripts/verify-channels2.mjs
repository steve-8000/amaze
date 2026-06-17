import { createHmac } from "node:crypto";
import { buildChannelApp } from "../services/channels/server.mjs";
const SS="sec_slack", GS="sec_github";
const { app, mounted } = await buildChannelApp({ channels: { enabled:true, slack:{enabled:true,signing_secret:SS}, github:{enabled:true,webhook_secret:GS} } });
console.log("mounted:", mounted);
// github ping webhook
const body = JSON.stringify({ action: "opened", zen: "ping" });
const sig = "sha256=" + createHmac("sha256", GS).update(body).digest("hex");
const res = await app.request("/github/webhook", { method:"POST", headers:{ "content-type":"application/json","content-length":Buffer.byteLength(body).toString(),"x-github-event":"ping","x-hub-signature-256":sig,"x-github-delivery":"d1" }, body });
console.log("github status:", res.status, res.status===200?"PASS":"(see body)", res.status!==200? await res.text():"");
const bad = await app.request("/github/webhook", { method:"POST", headers:{ "content-type":"application/json","x-github-event":"ping","x-hub-signature-256":"sha256=bad","x-github-delivery":"d2" }, body });
console.log("github bad-sig status:", bad.status, (bad.status===401||bad.status===400)?"PASS: rejected":"FAIL");
