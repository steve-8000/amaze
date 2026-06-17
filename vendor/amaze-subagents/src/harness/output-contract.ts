import type { JsonSchemaObject } from "../shared/types.ts";
import type { FreshBootContract, HarnessOutputRequired } from "./fresh-boot-contract.ts";

export type OutputContractValidation =
	| { status: "valid" }
	| { status: "invalid"; message: string };

const DEFAULT_FIELD_SCHEMAS: Record<HarnessOutputRequired, JsonSchemaObject> = {
	summary: { type: "string", minLength: 1 },
	files_changed: { type: "array", items: { type: "string" } },
	tests_run: { type: "array", items: { type: "string" } },
	risks: { type: "array", items: { type: "string" } },
	change_requests: { type: "array", items: {} },
	memory_updates: { type: "array", items: { type: "object", additionalProperties: true } },
};

function asObject(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: undefined;
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
		: [];
}

function propertiesOf(schema: JsonSchemaObject | undefined): Record<string, unknown> {
	return asObject(schema?.properties) ?? {};
}

export function outputSchemaForRequiredFields(
	requiredFields: HarnessOutputRequired[],
	baseSchema?: JsonSchemaObject,
): JsonSchemaObject {
	const required = [...new Set([
		...stringArray(baseSchema?.required),
		...requiredFields,
	])];
	const baseProperties = propertiesOf(baseSchema);
	const properties: Record<string, unknown> = { ...baseProperties };
	for (const field of requiredFields) {
		if (properties[field] === undefined) properties[field] = DEFAULT_FIELD_SCHEMAS[field];
	}
	return {
		...(baseSchema ?? {}),
		type: "object",
		properties,
		required,
		additionalProperties: baseSchema && Object.prototype.hasOwnProperty.call(baseSchema, "additionalProperties")
			? baseSchema.additionalProperties
			: true,
	};
}

export function outputSchemaForFreshBootContract(
	contract: FreshBootContract,
	baseSchema?: JsonSchemaObject,
): JsonSchemaObject {
	return outputSchemaForRequiredFields(contract.execution_contract.output_required, baseSchema);
}

function validateField(field: HarnessOutputRequired, value: unknown): string | undefined {
	if (value === undefined || value === null) return `${field} is required`;
	if (field === "summary") {
		return typeof value === "string" && value.trim() ? undefined : "summary must be a non-empty string";
	}
	return Array.isArray(value) ? undefined : `${field} must be an array`;
}

export function validateOutputContractFields(
	requiredFields: HarnessOutputRequired[],
	value: unknown,
): OutputContractValidation {
	const object = asObject(value);
	if (!object) return { status: "invalid", message: "output contract requires a JSON object" };
	const errors = requiredFields
		.map((field) => validateField(field, object[field]))
		.filter((error): error is string => Boolean(error));
	if (errors.length === 0) return { status: "valid" };
	return { status: "invalid", message: errors.join("; ") };
}

export function validateFreshBootOutputContract(
	contract: FreshBootContract,
	value: unknown,
): OutputContractValidation {
	return validateOutputContractFields(contract.execution_contract.output_required, value);
}
