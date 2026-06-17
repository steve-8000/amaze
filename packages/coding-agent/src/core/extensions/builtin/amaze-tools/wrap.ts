import type { ExtensionAPI, ToolDefinition } from "../../types.ts";

export interface WrapPiOptions {
	rename?: Record<string, string>;
	skip?: Set<string>;
	renameCmd?: Record<string, string>;
}

// wrapPi intercepts a vendored pi-* extension's `pi` object to rename/skip its
// tools and commands, so the vendored source is reused without modification.
export function wrapPi(pi: ExtensionAPI, opts: WrapPiOptions): ExtensionAPI {
	const rename = opts.rename ?? {};
	const renameCmd = opts.renameCmd ?? {};
	const skip = opts.skip ?? new Set<string>();

	return new Proxy(pi, {
		get(target, prop, receiver) {
			if (prop === "registerTool") {
				return (tool: ToolDefinition) => {
					if (skip.has(tool.name)) return undefined;
					const name = rename[tool.name] ?? tool.name;
					return target.registerTool(name === tool.name ? tool : { ...tool, name });
				};
			}
			if (prop === "registerCommand") {
				return (name: string, options: Parameters<ExtensionAPI["registerCommand"]>[1]) => {
					return target.registerCommand(renameCmd[name] ?? name, options);
				};
			}
			const value = Reflect.get(target, prop, receiver);
			return typeof value === "function" ? value.bind(target) : value;
		},
	}) as ExtensionAPI;
}
