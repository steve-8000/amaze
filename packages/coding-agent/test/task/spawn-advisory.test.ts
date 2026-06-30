import { describe, expect, it } from "bun:test";
import { buildSpecializationAdvisory } from "@steve-z8k/pi-coding-agent/task";
import type { TaskItem } from "@steve-z8k/pi-coding-agent/task/types";

const item = (role?: string): TaskItem => ({ assignment: "do the thing", role });

describe("buildSpecializationAdvisory", () => {
	it("stays silent for a generic role-less spawn", () => {
		expect(buildSpecializationAdvisory("task", [item()], true)).toBeUndefined();
	});

	it("stays silent for repeated generic workers", () => {
		expect(buildSpecializationAdvisory("quick_task", [item(), item()], true)).toBeUndefined();
	});

	it("stays silent regardless of depth or role", () => {
		expect(buildSpecializationAdvisory("task", [item("Rust async-runtime specialist")], false)).toBeUndefined();
	});
});
