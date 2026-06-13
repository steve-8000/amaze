import { describe, expect, test } from "bun:test";
import { verifySourceRefs } from "../../src/research/source-verifier";

describe("source verifier", () => {
	test("rejects malformed source refs", () => {
		const observedAt = 1_000;
		const result = verifySourceRefs(
			[
				{ kind: "provider", uri: "", contentHash: "sha256:ok", observedAt },
				{ kind: "provider", uri: "https://example.test/no-observation", contentHash: "sha256:ok" },
				{ kind: "provider", uri: "https://example.test/no-hash", observedAt },
				{ kind: "provider", uri: "https://example.test/ok", contentHash: "sha256:ok", observedAt },
			],
			{ now: observedAt },
		);

		expect(result.valid).toEqual([
			{ kind: "provider", uri: "https://example.test/ok", contentHash: "sha256:ok", observedAt },
		]);
		expect(result.issues.map(issue => issue.reason)).toEqual([
			"missing_uri",
			"missing_observed_at",
			"missing_content_hash",
		]);
	});

	test("rejects stale source refs", () => {
		const result = verifySourceRefs(
			[{ kind: "provider", uri: "https://example.test/stale", contentHash: "sha256:old", observedAt: 1_000 }],
			{ now: 3_000, maxAgeMs: 1_000 },
		);

		expect(result.valid).toEqual([]);
		expect(result.issues.map(issue => issue.reason)).toEqual(["stale"]);
	});
});
