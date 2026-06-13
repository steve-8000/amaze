import { describe, expect, test } from "bun:test";
import { MissionRuntimeImpl } from "../../src/mission/core/mission-runtime";
import { MissionStore } from "../../src/mission/store";

describe("mission mode persistence", () => {
	for (const mode of ["interactive", "autonomous", "dry-run", "auto"] as const) {
		test(`restores ${mode} after runtime restart`, async () => {
			const store = new MissionStore(":memory:");
			try {
				const runtime1 = new MissionRuntimeImpl({ store });
				const mission = await runtime1.create({
					title: `Mode ${mode}`,
					objective: `Persist ${mode} mode`,
					mode,
				});

				const runtime2 = new MissionRuntimeImpl({ store });
				expect(runtime2.tryGet(mission.id)?.mode).toBe(mode);
			} finally {
				store.close();
			}
		});
	}
});
