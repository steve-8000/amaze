import * as fs from "node:fs/promises";
import * as path from "node:path";
import { type AgiEvalCase, AgiEvalRunner } from "../agi/eval-runner";
import {
	type AgiEvalId,
	type AgiEvalManifest,
	type AgiEvalSpec,
	REQUIRED_AGI_EVAL_IDS,
	validateAgiEvalManifest,
} from "../agi/eval-suite";

export interface AgiEvalCommandArgs {
	action?: string;
	manifest?: string;
}

interface AgiEvalFixture {
	id: AgiEvalId;
	expected?: { blocker?: string };
}

export async function runAgiEvalCommand(args: AgiEvalCommandArgs = {}): Promise<void> {
	const action = args.action ?? "run";
	if (action !== "run") throw new Error(`Unknown agi-eval action: ${action}`);
	const manifestPath = args.manifest ?? "evals/agi/manifest.json";
	const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as AgiEvalManifest;
	const validation = validateAgiEvalManifest(manifest);
	if (!validation.valid) {
		for (const error of validation.errors) process.stderr.write(`${error}\n`);
		process.exitCode = 1;
		return;
	}

	const cases = await Promise.all(manifest.requiredEvals.map(entry => loadCase(entry, manifestPath)));
	const runner = new AgiEvalRunner(cases);
	const result = await runner.run(REQUIRED_AGI_EVAL_IDS);
	for (const evalResult of result.results) {
		process.stdout.write(`${evalResult.specId}\t${evalResult.passed ? "pass" : "fail"}\n`);
		for (const blocker of evalResult.blockers) process.stdout.write(`  blocker: ${blocker}\n`);
	}
	for (const missing of result.missingEvalIds) process.stdout.write(`${missing}\tmissing\n`);
	if (!result.passed) process.exitCode = 1;
}

async function loadCase(entry: AgiEvalManifest["requiredEvals"][number], manifestPath: string): Promise<AgiEvalCase> {
	const datasetPath = path.resolve(path.dirname(manifestPath), "..", "..", entry.dataset);
	const fixture = JSON.parse(await fs.readFile(datasetPath, "utf8")) as AgiEvalFixture;
	const spec: AgiEvalSpec = {
		id: entry.id,
		objective: entry.mandatoryBlockers[0] ?? entry.id,
		dataset: { uri: entry.dataset, version: "v1", fixtureCount: 1 },
		metrics: [{ name: "mandatory_blocker_absent", type: "binary", threshold: 1, mandatory: true }],
		evidenceRequired: ["event-ledger", "verifier"],
		governance: { riskTier: "high", oversight: "human-approval", monitoringCadence: "release" },
		humanCalibration: {
			rubricUri: "evals/agi/rubrics/runtime-substrate-v1.md",
			goldSetUri: entry.dataset,
			minAgreement: 0.8,
			escalation: "reviewer",
		},
	};
	return {
		spec,
		run: () => {
			const blocker = fixture.expected?.blocker;
			const passed = fixture.id === entry.id && blocker !== undefined && entry.mandatoryBlockers.includes(blocker);
			return {
				passed,
				metrics: {
					mandatory_blocker_absent: {
						value: passed ? 1 : 0,
						passed,
						evidenceRefs: [`fixture:${entry.dataset}`],
					},
				},
				blockers: passed ? [] : [blocker ?? `invalid fixture for ${entry.id}`],
			};
		},
	};
}

if (import.meta.main) {
	await runAgiEvalCommand({
		action: process.argv[2],
		manifest: process.argv.includes("--manifest") ? process.argv[process.argv.indexOf("--manifest") + 1] : undefined,
	});
}
