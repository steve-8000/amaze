import { join } from "node:path";
import { type AmazeConfig, loadAmazeConfig } from "../../../../amaze/config.ts";
import { getAgentDir, getPackageDir } from "../../../../config.ts";
import { createExtensionModuleImporter, loadExtensionModule } from "../../loader.ts";
import type { ExtensionAPI } from "../../types.ts";
import { type WrapPiOptions, wrapPi } from "./wrap.ts";

interface VendoredExtensionSpec extends WrapPiOptions {
	relativeEntry: string;
	isEnabled: (config: AmazeConfig) => boolean;
}

const VENDORED_EXTENSIONS: VendoredExtensionSpec[] = [
	{
		relativeEntry: "vendor/amaze-ast-grep/src/index.ts",
		isEnabled: (c) => c.tools.code.enabled,
		rename: { ast_grep_search: "code_find", ast_grep_replace: "code_rewrite" },
		renameCmd: { "ast-grep": "code" },
	},
	{
		relativeEntry: "vendor/amaze-lsp-client/src/index.ts",
		isEnabled: (c) => c.tools.lang.enabled,
		rename: {
			lsp_diagnostics: "lang_check",
			lsp_goto_definition: "lang_jump",
			lsp_rename: "lang_rename",
			lsp_prepare_rename: "lang_verify",
		},
		skip: new Set(["lsp_symbols", "lsp_find_references"]),
		renameCmd: { lsp: "lang" },
	},
	{
		relativeEntry: "vendor/amaze-subagents/src/extension/index.ts",
		isEnabled: (c) => c.agents.enabled,
		rename: { subagent: "agent_run" },
		renameCmd: { "subagents-doctor": "agents-doctor" },
	},
	{
		relativeEntry: "vendor/amaze-cua-integration/src/index.ts",
		isEnabled: (c) => c.desk.enabled,
		rename: {
			cua_screenshot: "desk_shot",
			cua_click: "desk_click",
			cua_type: "desk_type",
			cua_key: "desk_key",
			cua_scroll: "desk_scroll",
			cua_sandbox_start: "desk_open",
			cua_sandbox_stop: "desk_close",
			cua_sandbox_list: "desk_list",
		},
		renameCmd: { cua: "desk" },
	},
	{
		relativeEntry: "vendor/amaze-comment-checker/src/index.ts",
		isEnabled: (c) => c.hooks.enabled,
	},
];

function vendorRoot(): string {
	return join(getPackageDir(), "..", "..");
}

export default async function amazeToolsExtension(pi: ExtensionAPI): Promise<void> {
	// Vendored pi-* extensions read AMAZE_CODING_AGENT_DIR for their config/agents;
	// point it at amaze's agent dir so subagent overrides etc. resolve correctly.
	process.env.AMAZE_CODING_AGENT_DIR ??= getAgentDir();
	const config = loadAmazeConfig();
	const importer = createExtensionModuleImporter();
	const root = vendorRoot();

	for (const spec of VENDORED_EXTENSIONS) {
		if (!spec.isEnabled(config)) continue;
		const entry = join(root, spec.relativeEntry);
		const factory = await loadExtensionModule(entry, importer);
		if (!factory) continue;
		const { relativeEntry: _entry, isEnabled: _isEnabled, ...wrapOptions } = spec;
		await factory(wrapPi(pi, wrapOptions));
	}
}
