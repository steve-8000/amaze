import { describe, expect, it } from "vitest";

import {
	isLspDeadConnectionError,
	LspConnectionClosedError,
	LspInvalidPathError,
	LspProcessExitedError,
	LspProcessSpawnError,
	LspRequestTimeoutError,
	LspServerInitializingError,
	LspServerLookupError,
} from "../src/lsp/errors.js";

describe("LspConnectionClosedError", () => {
	it("#given new instance #when reading fields #then exposes serverId, root, and name", () => {
		// given
		const err = new LspConnectionClosedError("typescript", "/repo");

		// when / then
		expect(err.name).toBe("LspConnectionClosedError");
		expect(err.serverId).toBe("typescript");
		expect(err.root).toBe("/repo");
		expect(err.message).toContain("connection closed");
	});

	it("#given a custom message #when constructing #then uses that message", () => {
		// given
		const err = new LspConnectionClosedError("typescript", "/repo", "explicit reason");

		// when / then
		expect(err.message).toBe("explicit reason");
	});
});

describe("LspProcessExitedError", () => {
	it("#given exit code #when constructing #then includes serverId, root, and exit code in message", () => {
		// given
		const err = new LspProcessExitedError("rust", "/repo", 137, "boom");

		// when / then
		expect(err.name).toBe("LspProcessExitedError");
		expect(err.serverId).toBe("rust");
		expect(err.exitCode).toBe(137);
		expect(err.stderrTail).toBe("boom");
		expect(err.message).toContain("exited with code 137");
		expect(err.message).toContain("stderr tail: boom");
	});

	it("#given null exit code #when constructing #then renders null cleanly", () => {
		// given
		const err = new LspProcessExitedError("typescript", "/repo", null);

		// when / then
		expect(err.message).toContain("exited with code null");
	});
});

describe("isLspDeadConnectionError", () => {
	it("#given a connection error #when classifying #then returns true", () => {
		// given
		const err = new LspConnectionClosedError("typescript", "/repo");

		// when / then
		expect(isLspDeadConnectionError(err)).toBe(true);
	});

	it("#given a process exit error #when classifying #then returns true", () => {
		// given
		const err = new LspProcessExitedError("typescript", "/repo", 1);

		// when / then
		expect(isLspDeadConnectionError(err)).toBe(true);
	});

	it("#given a generic error #when classifying #then returns false", () => {
		// given / when / then
		expect(isLspDeadConnectionError(new Error("nope"))).toBe(false);
		expect(isLspDeadConnectionError("string")).toBe(false);
		expect(isLspDeadConnectionError(null)).toBe(false);
	});
});

describe("custom LSP errors", () => {
	it("#given timeout context #when constructing #then preserves method and stderr in message", () => {
		// given
		const err = new LspRequestTimeoutError("textDocument/definition", "server busy");

		// when / then
		expect(err.name).toBe("LspRequestTimeoutError");
		expect(err.method).toBe("textDocument/definition");
		expect(err.stderrTail).toBe("server busy");
		expect(err.message).toBe("LSP request timeout (method: textDocument/definition)\nrecent stderr: server busy");
	});

	it("#given timeout error #when wrapping initializing state #then preserves original timeout", () => {
		// given
		const timeout = new LspRequestTimeoutError("initialize");
		const err = new LspServerInitializingError(timeout);

		// when / then
		expect(err.name).toBe("LspServerInitializingError");
		expect(err.originalError).toBe(timeout);
		expect(err.message).toContain("LSP server is still initializing");
		expect(err.message).toContain("Original error: LSP request timeout (method: initialize)");
	});

	it("#given path, lookup, and spawn failures #when constructing #then expose typed names and messages", () => {
		// given
		const invalidPath = new LspInvalidPathError("bad path");
		const lookup = new LspServerLookupError("missing server");
		const spawn = new LspProcessSpawnError("spawn failed");

		// when / then
		expect(invalidPath.name).toBe("LspInvalidPathError");
		expect(invalidPath.message).toBe("bad path");
		expect(lookup.name).toBe("LspServerLookupError");
		expect(lookup.message).toBe("missing server");
		expect(spawn.name).toBe("LspProcessSpawnError");
		expect(spawn.message).toBe("spawn failed");
	});
});
