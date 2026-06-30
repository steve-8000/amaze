import { describe, expect, it } from "bun:test";
import { __validateLegacyPiPackageRootOverrides } from "@steve-z8k/pi-coding-agent/extensibility/plugins/legacy-pi-compat";

// Regression for issue #2168: in compiled-binary mode the package-root
// override branch of `resolveCanonicalPiSpecifier` returned a bunfs path
// without checking the target was actually present. When `bun --compile`
// quietly dropped one of the extra entrypoints (observed on macOS arm64
// release builds), the rewrite still emitted a `file://` URL to a missing
// module, defeating the #1216 fallback that only fired on the throwing
// `getResolvedSpecifier` path. The fix validates each override at module
// init so missing entries fall through to canonical resolution and Bun
// resolves the import from the extension's own `node_modules`.
describe("legacy pi compat package-root override validation (issue #2168)", () => {
	it("keeps overrides whose targets exist", () => {
		const candidates = {
			"@steve-z8k/pi-ai": "/tmp/exists-ai.js",
			"@steve-z8k/pi-utils": "/tmp/exists-utils.js",
		};
		const result = __validateLegacyPiPackageRootOverrides(candidates, () => true);
		expect(result).toEqual(candidates);
	});

	it("drops overrides whose targets are missing on disk", () => {
		const candidates = {
			"@steve-z8k/pi-ai": "/tmp/exists-ai.js",
			"@steve-z8k/pi-coding-agent": "/tmp/exists-shim.js",
			"@steve-z8k/pi-utils": "/$bunfs/root/packages/utils/src/index.js",
			"@steve-z8k/pi-tui": "/$bunfs/root/packages/tui/src/index.js",
		};
		const missing = new Set(["/$bunfs/root/packages/utils/src/index.js", "/$bunfs/root/packages/tui/src/index.js"]);
		const result = __validateLegacyPiPackageRootOverrides(candidates, p => !missing.has(p));
		expect(result).toEqual({
			"@steve-z8k/pi-ai": "/tmp/exists-ai.js",
			"@steve-z8k/pi-coding-agent": "/tmp/exists-shim.js",
		});
		// `pi-utils` and `pi-tui` are absent so the resolver falls through to
		// `getResolvedSpecifier` (which throws under bunfs), which triggers
		// the catch in `rewriteLegacyPiImports` that leaves the specifier
		// unchanged for native `node_modules` resolution.
		expect(result).not.toHaveProperty("@steve-z8k/pi-utils");
		expect(result).not.toHaveProperty("@steve-z8k/pi-tui");
	});

	it("drops every override when none of the targets exist", () => {
		const candidates = {
			"@steve-z8k/pi-utils": "/$bunfs/root/packages/utils/src/index.js",
			"@steve-z8k/pi-tui": "/$bunfs/root/packages/tui/src/index.js",
		};
		const result = __validateLegacyPiPackageRootOverrides(candidates, () => false);
		expect(result).toEqual({});
	});
});
