import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { LspClient } from "../src/lsp/client.js";
import type { Diagnostic } from "../src/lsp/types.js";

import { makeServer } from "./helpers/fake-lsp-client.js";

const diagnostic: Diagnostic = {
	range: {
		start: { line: 0, character: 0 },
		end: { line: 0, character: 1 },
	},
	message: "stored diagnostic",
};

class DiagnosticsHarness extends LspClient {
	constructor(
		root: string,
		private readonly pullError: Error,
		storedDiagnostics: Diagnostic[],
	) {
		super(root, makeServer("typescript"));
		this.diagnosticsStore.set(pathToFileURL(join(root, "sample.ts")).href, storedDiagnostics);
	}

	override async openFile(_filePath: string): Promise<void> {}

	protected override sendRequest<T>(method: string): Promise<T>;
	protected override sendRequest<T>(method: string, params: unknown): Promise<T>;
	protected override async sendRequest<T>(_method: string, _params?: unknown): Promise<T> {
		throw this.pullError;
	}
}

describe("LspClient diagnostics", () => {
	it("#given unsupported pull diagnostics #when diagnostics requested #then falls back without recording an error", async () => {
		// given
		const root = mkdtempSync(join(tmpdir(), "pi-lsp-client-"));
		try {
			const filePath = join(root, "sample.ts");
			writeFileSync(filePath, "const value = 1;\n");
			const client = new DiagnosticsHarness(root, new Error("method not found"), [diagnostic]);

			// when
			const result = await client.diagnostics(filePath);

			// then
			expect(result.items).toEqual([diagnostic]);
			expect(client.getDiagnosticPullErrors()).toEqual([]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("#given failed pull diagnostics #when diagnostics requested #then records the error before fallback", async () => {
		// given
		const root = mkdtempSync(join(tmpdir(), "pi-lsp-client-"));
		try {
			const filePath = join(root, "sample.ts");
			writeFileSync(filePath, "const value = 1;\n");
			const pullError = new Error("transport disconnected");
			const client = new DiagnosticsHarness(root, pullError, [diagnostic]);

			// when
			const result = await client.diagnostics(filePath);

			// then
			expect(result.items).toEqual([diagnostic]);
			expect(client.getDiagnosticPullErrors()).toEqual([pullError]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
