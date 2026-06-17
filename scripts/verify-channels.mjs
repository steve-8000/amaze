import { createHmac } from "node:crypto";
import { buildChannelApp } from "../services/channels/server.mjs";

const SECRET = "test_signing_secret";
const config = { channels: { enabled: true, slack: { enabled: true, signing_secret: SECRET } } };

const { app, mounted } = await buildChannelApp(config);
console.log("mounted:", mounted);

const challenge = "amaze_challenge_42";
const body = JSON.stringify({ type: "url_verification", challenge });
const ts = Math.floor(Date.now() / 1000).toString();
const sig = `v0=${createHmac("sha256", SECRET).update(`v0:${ts}:${body}`).digest("hex")}`;

const res = await app.request("/slack/events", {
	method: "POST",
	headers: {
		"content-type": "application/json",
		"content-length": Buffer.byteLength(body).toString(),
		"x-slack-request-timestamp": ts,
		"x-slack-signature": sig,
	},
	body,
});
const json = await res.json();
console.log("status:", res.status, "echoed:", JSON.stringify(json));
console.log(json.challenge === challenge ? "PASS: signed challenge echoed" : "FAIL");

const bad = await app.request("/slack/events", {
	method: "POST",
	headers: { "content-type": "application/json", "x-slack-request-timestamp": ts, "x-slack-signature": "v0=deadbeef" },
	body,
});
console.log("unsigned/bad-signature status:", bad.status, bad.status === 401 || bad.status === 400 ? "PASS: rejected" : "FAIL");
