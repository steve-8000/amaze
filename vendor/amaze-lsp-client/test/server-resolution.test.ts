import { describe, expect, it } from "vitest";

import { AUTO_INSTALLABLE_SERVERS, BUILTIN_SERVERS, LSP_INSTALL_HINTS } from "../src/lsp/server-definitions.js";

describe("BUILTIN_SERVERS", () => {
	it("#given the registry #when counting #then includes at least 30 servers", () => {
		// given / when
		const count = Object.keys(BUILTIN_SERVERS).length;

		// then
		expect(count).toBeGreaterThanOrEqual(30);
	});

	it("#given typescript #when looking it up #then exposes command and extensions", () => {
		// given
		const ts = BUILTIN_SERVERS["typescript"];
		if (!ts) throw new Error("expected typescript server");

		// when / then
		expect(ts).toBeDefined();
		expect(ts.command[0]).toBe("typescript-language-server");
		expect(ts.extensions).toContain(".ts");
		expect(ts.extensions).toContain(".tsx");
	});

	it("#given rust #when looking it up #then maps to rust-analyzer", () => {
		// given
		const rust = BUILTIN_SERVERS["rust"];
		if (!rust) throw new Error("expected rust server");

		// when / then
		expect(rust).toBeDefined();
		expect(rust.command[0]).toBe("rust-analyzer");
		expect(rust.extensions).toEqual([".rs"]);
	});

	it("#given rust install guidance #when inspecting registry #then rust is manual install only", () => {
		// given
		const hint = LSP_INSTALL_HINTS["rust"];

		// when / then
		expect(AUTO_INSTALLABLE_SERVERS["rust"]).toBeUndefined();
		expect(hint).toContain("rust-analyzer");
		expect(hint).toContain("rustup component add rust-analyzer");
		expect(hint).toContain("rustup component remove rust-src");
		expect(hint).toContain("rustup component add rust-src");
	});
});

describe("LSP_INSTALL_HINTS", () => {
	it("#given each builtin server #when looking up the hint #then most have hints", () => {
		// given
		const builtinIds = Object.keys(BUILTIN_SERVERS);

		// when
		const hintCount = builtinIds.filter((id) => Boolean(LSP_INSTALL_HINTS[id])).length;

		// then
		expect(hintCount).toBeGreaterThanOrEqual(builtinIds.length - 5);
	});

	it("#given typescript #when looking up hint #then mentions npm install", () => {
		// given / when / then
		expect(LSP_INSTALL_HINTS["typescript"]).toContain("npm install");
		expect(LSP_INSTALL_HINTS["typescript"]).toContain("typescript-language-server");
	});
});
