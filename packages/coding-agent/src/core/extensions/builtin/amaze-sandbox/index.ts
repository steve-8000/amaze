import { join } from "node:path";
import { Type } from "typebox";
import { loadAmazeConfig } from "../../../../amaze/config.ts";
import { getPackageDir } from "../../../../config.ts";
import { createExtensionModuleImporter } from "../../loader.ts";
import type { ExtensionAPI, ToolDefinition } from "../../types.ts";

interface ShellResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

interface SessionEnv {
	exec(command: string, options?: { cwd?: string }): Promise<ShellResult>;
}

interface SandboxFactory {
	createSessionEnv(options: { id: string }): Promise<SessionEnv>;
}

type LocalFactory = (options?: Record<string, unknown>) => SandboxFactory;

function vendorRoot(): string {
	return join(getPackageDir(), "..", "..");
}

export default function amazeSandboxExtension(pi: ExtensionAPI): void {
	const config = loadAmazeConfig();
	if (!config.sandbox.enabled) return;

	let envPromise: Promise<SessionEnv> | undefined;

	const getEnv = async (): Promise<SessionEnv> => {
		if (!envPromise) {
			const importer = createExtensionModuleImporter();
			const entry = join(vendorRoot(), "vendor", "flue", "packages", "runtime", "src", "node", "local.ts");
			const mod = (await importer.import(entry)) as { local: LocalFactory };
			const factory = mod.local({});
			envPromise = factory.createSessionEnv({ id: "amaze-sandbox" });
		}
		return envPromise;
	};

	const sandboxExec: ToolDefinition = {
		name: "sandbox_exec",
		label: "sandbox_exec",
		description: "Run a shell command inside an isolated flue sandbox (local provider by default).",
		parameters: Type.Object({
			command: Type.String({ description: "Shell command to run." }),
			cwd: Type.Optional(Type.String({ description: "Working directory." })),
		}),
		async execute(_id, params) {
			const env = await getEnv();
			const { command, cwd } = params as { command: string; cwd?: string };
			const result = await env.exec(command, cwd ? { cwd } : undefined);
			const text = `exit ${result.exitCode}\n${result.stdout}${result.stderr ? `\n[stderr]\n${result.stderr}` : ""}`;
			return { content: [{ type: "text", text }], details: undefined };
		},
	};

	pi.registerTool(sandboxExec);
}
