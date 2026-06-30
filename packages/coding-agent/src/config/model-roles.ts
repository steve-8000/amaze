/**
 * Built-in model roles and role metadata helpers.
 */

import { isValidThemeColor, type ThemeColor } from "../modes/theme/theme";
import type { Settings } from "./settings";

export type ModelRole = "ultra" | "deep" | "flash" | "spark";
export const PRIMARY_MODEL_ROLE: ModelRole = "flash";

export interface ModelRoleInfo {
	tag?: string;
	name: string;
	color?: ThemeColor;
	/** If true, the role is functional but not shown in the model selector UI. */
	hidden?: boolean;
}

export const MODEL_ROLES: Record<ModelRole, ModelRoleInfo> = {
	flash: { tag: "FLASH", name: "Flash", color: "warning" },
	spark: { tag: "SPARK", name: "Spark", color: "muted" },
	deep: { tag: "DEEP", name: "Deep", color: "error" },
	ultra: { tag: "ULTRA", name: "Ultra", color: "accent" },
};

export const MODEL_ROLE_IDS: ModelRole[] = ["flash", "spark", "deep", "ultra"];

export type RoleInfo = ModelRoleInfo;

/**
 * Return the canonical set of known roles for selector/carousel UI.
 *
 * Built-ins always come first. Configured cycle order, model assignments, and
 * tag metadata can introduce additional custom roles without requiring duplicate
 * entries across settings.
 */
export function getKnownRoleIds(settings: Settings): string[] {
	const roles = MODEL_ROLE_IDS.filter(role => !MODEL_ROLES[role]?.hidden) as string[];
	const seen = new Set<string>(roles);
	const addRole = (role: string) => {
		if (seen.has(role) || getRoleInfo(role, settings).hidden) return;
		seen.add(role);
		roles.push(role);
	};

	for (const role of settings.get("cycleOrder")) addRole(role);
	for (const role in settings.getModelRoles()) addRole(role);
	for (const role in settings.get("modelTags")) addRole(role);

	return roles;
}

/**
 * Get role info for a role name (built-in or custom).
 * Configured metadata overrides built-in defaults when present.
 */
export function getRoleInfo(role: string, settings: Settings): RoleInfo {
	const builtIn = role in MODEL_ROLES ? MODEL_ROLES[role as ModelRole] : undefined;
	const configured = settings.get("modelTags")[role];

	if (configured) {
		return {
			tag: builtIn?.tag,
			name: configured.name || builtIn?.name || role,
			color: configured.color && isValidThemeColor(configured.color) ? configured.color : builtIn?.color,
			hidden: configured.hidden ?? builtIn?.hidden,
		};
	}

	if (builtIn) return builtIn;

	return { name: role, color: "muted" };
}
