import { describe, expect, it } from "bun:test";
import { getMemoryDoctorReport } from "../../src/cli/memory";
import { Settings } from "../../src/config/settings";

describe("memory doctor", () => {
	it("reports off when no durable backend is active", async () => {
		const report = await getMemoryDoctorReport();
		expect(report.backend).toBe("off");
		expect(report.status).toBe("ok");
		expect(report.text).toContain("Memory backend: off");
	});

	it("reports mem0 degraded without an endpoint", async () => {
		const report = await getMemoryDoctorReport(Settings.isolated({ "memory.backend": "mem0" }));
		expect(report.backend).toBe("mem0");
		expect(report.status).toBe("degraded");
		expect(report.text).toContain("Memory backend: mem0");
		expect(report.text).toContain("Missing memory.mem0.baseUrl");
	});

	it("reports hermes without using the mem0 endpoint path", async () => {
		const report = await getMemoryDoctorReport(Settings.isolated({ "memory.backend": "hermes" }));
		expect(report.backend).toBe("hermes");
		expect(report.status).toBe("ok");
		expect(report.text).toContain("Memory backend: hermes");
		expect(report.text).toContain("Local Hermes memory is configured");
		expect(report.text).not.toContain("memory.mem0.baseUrl");
	});
});
