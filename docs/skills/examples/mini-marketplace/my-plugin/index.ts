// @ts-nocheck — example file; install @steve-z8k/pi-coding-agent before running
import type { ExtensionAPI } from "@steve-z8k/pi-coding-agent";

export default function myPlugin(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("my-plugin loaded from example marketplace!", "info");
  });
}
