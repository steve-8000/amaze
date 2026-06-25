import type { BunFile } from "bun";
import type { WritethroughBatchRequest } from "../tools/render-utils";

export enum FileFormatResult {
	UNCHANGED = "unchanged",
	FORMATTED = "formatted",
}

export interface FileDiagnosticsResult {
	server?: string;
	messages: string[];
	summary: string;
	errored: boolean;
	formatter?: FileFormatResult;
}

export type WritethroughDeferredHandle = {
	onDeferredDiagnostics: (diagnostics: FileDiagnosticsResult) => void;
	signal: AbortSignal;
	finalize: (diagnostics: FileDiagnosticsResult | undefined) => void;
};

export type WritethroughCallback = (
	dst: string,
	content: string,
	signal?: AbortSignal,
	file?: BunFile,
	batch?: WritethroughBatchRequest,
	getDeferred?: (dst: string) => WritethroughDeferredHandle | undefined,
) => Promise<FileDiagnosticsResult | undefined>;

export async function writethroughNoop(
	dst: string,
	content: string,
	_signal?: AbortSignal,
	file?: BunFile,
	_batch?: WritethroughBatchRequest,
	_getDeferred?: (dst: string) => WritethroughDeferredHandle | undefined,
): Promise<FileDiagnosticsResult | undefined> {
	if (file) {
		await file.write(content);
	} else {
		await Bun.write(dst, content);
	}
	return undefined;
}

export async function flushWritethroughBatch(
	_id: string,
	_cwd: string,
	_signal?: AbortSignal,
): Promise<FileDiagnosticsResult | undefined> {
	return undefined;
}
