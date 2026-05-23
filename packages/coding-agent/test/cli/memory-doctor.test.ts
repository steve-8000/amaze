import { describe, expect, it } from "bun:test";
import { getMemoryDoctorReport } from "../../src/cli/memory";
import { nexusBackend } from "../../src/memory-backend/nexus-backend";

describe("memory doctor", () => {
	it("prints degraded status and the affected Nexus item", () => {
		const status = nexusBackend.getDegradationStatus() as { maintenance?: string };
		const previousMaintenance = status.maintenance;
		status.maintenance = "startup write failed";
		const originalGetDegradationStatus = nexusBackend.getDegradationStatus;
		let stdout = "";
		try {
			Object.defineProperty(nexusBackend, "getDegradationStatus", { value: () => status, configurable: true });
			const report = getMemoryDoctorReport();
			stdout = `${report.text}\n`;
		} finally {
			Object.defineProperty(nexusBackend, "getDegradationStatus", {
				value: originalGetDegradationStatus,
				configurable: true,
			});
			if (previousMaintenance === undefined) {
				delete status.maintenance;
			} else {
				status.maintenance = previousMaintenance;
			}
		}

		expect(stdout).toContain("Nexus status: degraded");
		expect(stdout).toContain("- maintenance: startup write failed");
		expect(stdout).toContain("- session-reindex: ok");
		expect(stdout).toContain("- knowledge-migration: ok");
	});
});
