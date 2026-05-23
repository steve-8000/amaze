/**
 * Aggregate health checks across memory, metrics, rules, and observability.
 */
import { Command, Flags } from "@amaze/utils/cli";
import { runDoctorCommand } from "../cli/doctor";

export default class Doctor extends Command {
	static description = "Run health checks across Amaze subsystems";

	static flags = {
		json: Flags.boolean({ description: "Emit a single JSON health report" }),
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(Doctor);
		const report = await runDoctorCommand({ json: flags.json });
		if (report.status !== "ok") process.exitCode = 1;
	}
}
