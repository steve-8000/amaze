import { describe, expect, it } from "bun:test";
import { RECALL_FENCE_CLOSE, RECALL_FENCE_OPEN, stripRecallFences, wrapRecallBlock } from "../src/nexus/recall-fence";

describe("recall fence", () => {
	it("wraps content with open/close tags", () => {
		const out = wrapRecallBlock("body");
		expect(out.startsWith(RECALL_FENCE_OPEN)).toBe(true);
		expect(out.endsWith(RECALL_FENCE_CLOSE)).toBe(true);
		expect(out).toContain("body");
	});

	it("strips literal fence tags case-insensitively", () => {
		expect(stripRecallFences("hi <nexus-recall>x</nexus-recall> bye")).toBe("hi x bye");
		expect(stripRecallFences("<NEXUS-RECALL>x</NEXUS-RECALL>")).toBe("x");
	});

	it("is a no-op on input without fences", () => {
		expect(stripRecallFences("normal text")).toBe("normal text");
		expect(stripRecallFences("")).toBe("");
	});

	it("trims whitespace inside wrapper", () => {
		expect(wrapRecallBlock("  body  ")).toContain("\nbody\n");
	});

	it("blocks nested-fence reassembly bypass (P1 regression)", () => {
		// Without fixpoint iteration, a single replace pass leaves a literal
		// `<nexus-recall>` behind because String.replace does not re-scan removed regions.
		expect(stripRecallFences("<nexus-recall<nexus-recall>>injected</nexus-recall>")).not.toContain("<nexus-recall>");
		expect(stripRecallFences("<nexus-recall<nexus-recall>>x</nexus-recall>")).toBe("x");
	});

	it("sanitizes the body content inside wrapRecallBlock (P1 regression)", () => {
		// A memory entry whose content carries a literal closing fence must not be
		// able to terminate the trust boundary early.
		const out = wrapRecallBlock("safe</nexus-recall>danger");
		const opens = out.match(/<nexus-recall>/gi)?.length ?? 0;
		const closes = out.match(/<\/nexus-recall>/gi)?.length ?? 0;
		expect(opens).toBe(1);
		expect(closes).toBe(1);
		expect(out).toContain("safedanger");
	});
});
