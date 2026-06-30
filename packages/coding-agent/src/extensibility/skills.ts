import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { getProjectDir } from "@steve-z8k/pi-utils";
import { MANAGED_SKILLS_PROVIDER_ID } from "../autolearn/managed-skills";
import { skillCapability } from "../capability/skill";
import type { SourceMeta } from "../capability/types";
import type { SkillsSettings } from "../config/settings";
import { type Skill as CapabilitySkill, loadCapability } from "../discovery";
import { compareSkillOrder, scanSkillsFromDir } from "../discovery/helpers";
import type { SkillPromptDetails } from "../session/messages";
import { expandTilde } from "../tools/path-utils";
export interface Skill {
	name: string;
	description: string;
	filePath: string;
	baseDir: string;
	source: string;
	/**
	 * When `true`, the skill is loaded and reachable via `skill://<name>` and
	 * (when enabled) `/skill:<name>`, but is excluded from the rendered system
	 * prompt's `<skills>` listing.
	 */
	hide?: boolean;
	/** Source metadata for display */
	_source?: SourceMeta;
}

export interface SkillWarning {
	skillPath: string;
	message: string;
}

export interface LoadSkillsResult {
	skills: Skill[];
	warnings: SkillWarning[];
}

let activeSkills: readonly Skill[] = [];

/**
 * Process-global snapshot of skills the active session loaded.
 * Read by internal URL protocol handlers (skill://).
 */
export function getActiveSkills(): readonly Skill[] {
	return activeSkills;
}

/** Replace the active skill snapshot. Called once per top-level session. */
export function setActiveSkills(value: readonly Skill[]): void {
	activeSkills = value;
}

/** Reset the active skill snapshot. Test-only. */
export function resetActiveSkillsForTests(): void {
	activeSkills = [];
}

const MANAGE_SKILL_BOOTSTRAP_NAME = "manage-skill";
const MANAGE_SKILL_BOOTSTRAP_PATH = path.join(import.meta.dirname, "..", "prompts", "tools", "manage-skill.md");

function getManageSkillBootstrapSkill(): Skill {
	return {
		name: MANAGE_SKILL_BOOTSTRAP_NAME,
		description: "Use Circle skill_search/skill_get for skill discovery and management.",
		filePath: MANAGE_SKILL_BOOTSTRAP_PATH,
		baseDir: path.dirname(MANAGE_SKILL_BOOTSTRAP_PATH),
		source: "amaze:bootstrap",
		_source: {
			provider: "amaze",
			providerName: "Amaze",
			path: MANAGE_SKILL_BOOTSTRAP_PATH,
			level: "user",
		},
	};
}

/**
 * Whether `name` is already claimed by an active authored (non-managed) skill.
 *
 * Legacy managed skills are no longer loaded into the rendered catalog; new
 * managed skills are discovered through Circle skill_search/skill_get instead.
 * `manage_skill` create consults this to refuse writes that would collide with
 * an active authored skill name.
 */
export function isNameClaimedByAuthoredSkill(name: string): boolean {
	return getActiveSkills().some(
		skill => skill.name === name && skill._source?.provider !== MANAGED_SKILLS_PROVIDER_ID,
	);
}

export interface LoadSkillsFromDirOptions {
	/** Directory to scan for skills */
	dir: string;
	/** Source identifier for these skills */
	source: string;
}

export async function loadSkillsFromDir(options: LoadSkillsFromDirOptions): Promise<LoadSkillsResult> {
	const [rawProviderId, rawLevel] = options.source.split(":", 2);
	const providerId = rawProviderId || "custom";
	const level: "user" | "project" = rawLevel === "project" ? "project" : "user";
	const result = await scanSkillsFromDir(
		{ cwd: getProjectDir(), home: os.homedir(), repoRoot: null },
		{
			dir: options.dir,
			providerId,
			level,
			requireDescription: true,
		},
	);

	return {
		skills: result.items.map(capSkill => ({
			name: capSkill.name,
			description: typeof capSkill.frontmatter?.description === "string" ? capSkill.frontmatter.description : "",
			filePath: capSkill.path,
			baseDir: capSkill.path.replace(/[\\/]SKILL\.md$/, ""),
			source: options.source,
			hide: capSkill.frontmatter?.hide === true || capSkill.frontmatter?.disableModelInvocation === true,
			_source: capSkill._source,
		})),
		warnings: (result.warnings ?? []).map(message => ({ skillPath: options.dir, message })),
	};
}

export interface LoadSkillsOptions extends SkillsSettings {
	/** Working directory for project-local skills. Default: getProjectDir() */
	cwd?: string;
}

/**
 * Load skills from all configured locations.
 * Returns skills and any validation warnings.
 */
export async function loadSkills(options: LoadSkillsOptions = {}): Promise<LoadSkillsResult> {
	const {
		cwd = getProjectDir(),
		enabled = true,
		enableCodexUser = true,
		enableClaudeUser = true,
		enableClaudeProject = true,
		enablePiUser = true,
		enablePiProject = true,
		enableAgentsUser = true,
		enableAgentsProject = true,
		customDirectories = [],
		ignoredSkills = [],
		includeSkills = [],
		disabledExtensions = [],
		searchOnly = false,
	} = options;

	// Early return if skills are disabled
	if (!enabled) {
		return { skills: [], warnings: [] };
	}

	// Search-only mode: render NO authored/on-disk catalog. The model discovers
	// managed Circle skills exclusively via the Circle skill_search / skill_get
	// tools — search is independent of this rendered list (see callSkillTool:
	// MCP -> HTTP -> local-store fallback). The only entry kept is the
	// manage-skill bootstrap, which instructs the model to use those tools.
	if (searchOnly) {
		const bootstrapSkill = getManageSkillBootstrapSkill();
		const disabled = new Set((disabledExtensions ?? []).filter(id => id.startsWith("skill:")).map(id => id.slice(6)));
		const ignored = ignoredSkills.some(pattern => new Bun.Glob(pattern).match(bootstrapSkill.name));
		const included =
			includeSkills.length === 0 || includeSkills.some(pattern => new Bun.Glob(pattern).match(bootstrapSkill.name));
		const keepBootstrap = !disabled.has(bootstrapSkill.name) && !ignored && included;
		return { skills: keepBootstrap ? [bootstrapSkill] : [], warnings: [] };
	}
	// Fall-through gate for third-party CLI providers (claude-plugins, opencode,
	// gemini, github, ...) that share user intent with the named third-party
	// source toggles but don't have a dedicated control of their own. Only the
	// third-party toggles count here: the Amaze-native providers (`agents`,
	// `native`) get explicit branches in `isSourceEnabled` below, so folding
	// them into the fallback would re-enable unrelated third-party CLIs whenever
	// the user kept the default `.agent[s]/skills` toggles on while turning off
	// Codex/Claude/Pi (issue #2401 / PR #2405 review).
	const anyThirdPartySkillToggleEnabled =
		enableCodexUser || enableClaudeUser || enableClaudeProject || enablePiUser || enablePiProject;

	function isSourceEnabled(source: SourceMeta): boolean {
		const { provider, level } = source;
		// Legacy managed skills are not rendered into the prompt catalog. Learned
		// managed skills live in Circle and are discovered through skill_search/skill_get.
		if (provider === MANAGED_SKILLS_PROVIDER_ID) return false;
		if (provider === "codex" && level === "user") return enableCodexUser;
		if (provider === "claude" && level === "user") return enableClaudeUser;
		if (provider === "claude" && level === "project") return enableClaudeProject;
		if (provider === "native" && level === "user") return enablePiUser;
		if (provider === "native" && level === "project") return enablePiProject;
		if (provider === "agents" && level === "user") return enableAgentsUser;
		if (provider === "agents" && level === "project") return enableAgentsProject;
		return anyThirdPartySkillToggleEnabled;
	}

	// Use capability API to load all skills
	const result = await loadCapability<CapabilitySkill>(skillCapability.id, { cwd, disabledExtensions });

	const skillMap = new Map<string, Skill>();
	const realPathSet = new Set<string>();
	const collisionWarnings: SkillWarning[] = [];

	// Check if skill name matches any of the include patterns
	function matchesIncludePatterns(name: string): boolean {
		if (includeSkills.length === 0) return true;
		return includeSkills.some(pattern => new Bun.Glob(pattern).match(name));
	}

	// Check if skill name matches any of the ignore patterns
	function matchesIgnorePatterns(name: string): boolean {
		if (ignoredSkills.length === 0) return false;
		return ignoredSkills.some(pattern => new Bun.Glob(pattern).match(name));
	}

	const disabledSkillNames = new Set(
		(disabledExtensions ?? []).filter(id => id.startsWith("skill:")).map(id => id.slice(6)),
	);
	// Filter skills by source and patterns first
	const filteredSkills = result.items.filter(capSkill => {
		if (disabledSkillNames.has(capSkill.name)) return false;
		if (!isSourceEnabled(capSkill._source)) return false;
		if (matchesIgnorePatterns(capSkill.name)) return false;
		if (!matchesIncludePatterns(capSkill.name)) return false;
		return true;
	});

	// Batch resolve all real paths in parallel
	const realPaths = await Promise.all(
		filteredSkills.map(async capSkill => {
			try {
				return await fs.realpath(capSkill.path);
			} catch {
				return capSkill.path;
			}
		}),
	);

	// Process skills with resolved paths
	for (let i = 0; i < filteredSkills.length; i++) {
		const capSkill = filteredSkills[i];
		// Defensive: legacy managed skills are discovered through Circle search/get,
		// not through the rendered prompt catalog.
		if (capSkill._source.provider === MANAGED_SKILLS_PROVIDER_ID) continue;
		const resolvedPath = realPaths[i];

		// Skip silently if we've already loaded this exact file (via symlink)
		if (realPathSet.has(resolvedPath)) {
			continue;
		}

		const existing = skillMap.get(capSkill.name);
		if (existing) {
			collisionWarnings.push({
				skillPath: capSkill.path,
				message: `name collision: "${capSkill.name}" already loaded from ${existing.filePath}, skipping this one`,
			});
		} else {
			skillMap.set(capSkill.name, {
				name: capSkill.name,
				description: typeof capSkill.frontmatter?.description === "string" ? capSkill.frontmatter.description : "",
				filePath: capSkill.path,
				baseDir: capSkill.path.replace(/[\\/]SKILL\.md$/, ""),
				source: `${capSkill._source.provider}:${capSkill.level}`,
				hide: capSkill.frontmatter?.hide === true || capSkill.frontmatter?.disableModelInvocation === true,
				_source: capSkill._source,
			});
			realPathSet.add(resolvedPath);
		}
	}

	const customDirectoryResults = await Promise.all(
		customDirectories.map(async dir => {
			const expandedDir = expandTilde(dir);
			const scanResult = await scanSkillsFromDir(
				{ cwd, home: os.homedir(), repoRoot: null },
				{
					dir: expandedDir,
					providerId: "custom",
					level: "user",
					requireDescription: true,
				},
			);
			return { expandedDir, scanResult };
		}),
	);

	const allCustomSkills: Array<{ skill: Skill; path: string }> = [];
	for (const { expandedDir, scanResult } of customDirectoryResults) {
		for (const capSkill of scanResult.items) {
			if (disabledSkillNames.has(capSkill.name)) continue;
			if (matchesIgnorePatterns(capSkill.name)) continue;
			if (!matchesIncludePatterns(capSkill.name)) continue;
			allCustomSkills.push({
				skill: {
					name: capSkill.name,
					description:
						typeof capSkill.frontmatter?.description === "string" ? capSkill.frontmatter.description : "",
					filePath: capSkill.path,
					baseDir: capSkill.path.replace(/[\\/]SKILL\.md$/, ""),
					source: "custom:user",
					hide: capSkill.frontmatter?.hide === true || capSkill.frontmatter?.disableModelInvocation === true,
					_source: { ...capSkill._source, providerName: "Custom" },
				},
				path: capSkill.path,
			});
		}
		collisionWarnings.push(...(scanResult.warnings ?? []).map(message => ({ skillPath: expandedDir, message })));
	}

	const customRealPaths = await Promise.all(
		allCustomSkills.map(async ({ path }) => {
			try {
				return await fs.realpath(path);
			} catch {
				return path;
			}
		}),
	);

	for (let i = 0; i < allCustomSkills.length; i++) {
		const { skill } = allCustomSkills[i];
		const resolvedPath = customRealPaths[i];
		if (realPathSet.has(resolvedPath)) continue;

		const existing = skillMap.get(skill.name);
		if (existing) {
			collisionWarnings.push({
				skillPath: skill.filePath,
				message: `name collision: "${skill.name}" already loaded from ${existing.filePath}, skipping this one`,
			});
		} else {
			skillMap.set(skill.name, skill);
			realPathSet.add(resolvedPath);
		}
	}

	if (enablePiUser) {
		const bootstrapSkill = getManageSkillBootstrapSkill();
		if (
			!disabledSkillNames.has(bootstrapSkill.name) &&
			!matchesIgnorePatterns(bootstrapSkill.name) &&
			matchesIncludePatterns(bootstrapSkill.name) &&
			!skillMap.has(bootstrapSkill.name)
		) {
			let resolvedPath = bootstrapSkill.filePath;
			try {
				resolvedPath = await fs.realpath(bootstrapSkill.filePath);
			} catch {
				// Packaged/dev installs should carry this file; keep the path so skill:// reports a precise error.
			}
			if (!realPathSet.has(resolvedPath)) {
				skillMap.set(bootstrapSkill.name, bootstrapSkill);
				realPathSet.add(resolvedPath);
			}
		}
	}

	const skills = Array.from(skillMap.values());
	// Deterministic ordering for prompt stability (case-insensitive, then exact name, then path).
	skills.sort((a, b) => compareSkillOrder(a.name, a.filePath, b.name, b.filePath));
	return {
		skills,
		warnings: [...(result.warnings ?? []).map(w => ({ skillPath: "", message: w })), ...collisionWarnings],
	};
}

export interface BuiltSkillPromptMessage {
	message: string;
	details: SkillPromptDetails;
}

export function getSkillSlashCommandName(skill: Pick<Skill, "name">): string {
	return `skill:${skill.name}`;
}

export async function buildSkillPromptMessage(
	skill: Pick<Skill, "name" | "filePath">,
	args: string,
): Promise<BuiltSkillPromptMessage> {
	const content = await Bun.file(skill.filePath).text();
	const body = content.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
	const metaLines = [`Skill: ${skill.filePath}`];
	const trimmedArgs = args.trim();
	if (trimmedArgs) {
		metaLines.push(`User: ${trimmedArgs}`);
	}
	const message = `${body}\n\n---\n\n${metaLines.join("\n")}`;
	return {
		message,
		details: {
			name: skill.name,
			path: skill.filePath,
			args: trimmedArgs || undefined,
			lineCount: body ? body.split("\n").length : 0,
		},
	};
}
