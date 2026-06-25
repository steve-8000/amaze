import { describe, expect, it, vi } from "bun:test";
import { AsyncJobManager } from "../job-manager";

describe("AsyncJobManager", () => {
	it("can suppress successful completion delivery while retaining the job result", async () => {
		const onJobComplete = vi.fn();
		const manager = new AsyncJobManager({ onJobComplete });

		const jobId = manager.register("task", "TaskSuccess", async () => "success output", {
			deliverOnSuccess: false,
		});

		await manager.waitForAll();
		await manager.drainDeliveries({ timeoutMs: 50 });

		const job = manager.getJob(jobId);
		expect(job?.status).toBe("completed");
		expect(job?.resultText).toBe("success output");
		expect(onJobComplete).not.toHaveBeenCalled();
	});

	it("still delivers failures when successful completion delivery is suppressed", async () => {
		const onJobComplete = vi.fn();
		const manager = new AsyncJobManager({ onJobComplete });

		const jobId = manager.register(
			"task",
			"TaskFailure",
			async () => {
				throw new Error("failed output");
			},
			{ deliverOnSuccess: false },
		);

		await manager.waitForAll();
		await manager.drainDeliveries({ timeoutMs: 100 });

		const job = manager.getJob(jobId);
		expect(job?.status).toBe("failed");
		expect(job?.errorText).toBe("failed output");
		expect(onJobComplete).toHaveBeenCalledTimes(1);
		expect(onJobComplete).toHaveBeenCalledWith(jobId, "failed output", job);
	});
});
