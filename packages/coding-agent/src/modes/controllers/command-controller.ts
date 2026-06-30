import * as fs from "node:fs/promises";
import { CompactionCancelledError, type CompactionOutcome } from "@steve-z8k/pi-agent-core/compaction";
import {
	getEnvApiKey,
	getProviderDetails,
	type ProviderDetails,
	type UsageLimit,
	type UsageReport,
} from "@steve-z8k/pi-ai";
import { Loader, Markdown, padding, Spacer, Text, visibleWidth } from "@steve-z8k/pi-tui";
import { formatDuration } from "@steve-z8k/pi-utils";
import { shouldEnableAppendOnlyContext } from "../../config/append-only-context-mode";
import type { CompactOptions } from "../../extensibility/extensions/types";
import { BashExecutionComponent } from "../../modes/components/bash-execution";
import { DynamicBorder } from "../../modes/components/dynamic-border";
import { EvalExecutionComponent } from "../../modes/components/eval-execution";
import { TranscriptBlock } from "../../modes/components/transcript-container";
import { getMarkdownTheme, getSymbolTheme, theme } from "../../modes/theme/theme";
import type { InteractiveModeContext } from "../../modes/types";
import { computeContextBreakdown, renderContextUsage } from "../../modes/utils/context-usage";
import { buildHotkeysMarkdown } from "../../modes/utils/hotkeys-markdown";
import { buildToolsMarkdown } from "../../modes/utils/tools-markdown";
import type { AsyncJobSnapshotItem } from "../../session/agent-session";
import type { AuthStorage, OAuthAccountIdentity } from "../../session/auth-storage";
import type { CompactMode } from "../../session/compact-modes";
import type { NewSessionOptions } from "../../session/session-entries";
import { formatShakeSummary, type ShakeMode, type ShakeResult } from "../../session/shake-types";
import { limitMatchesActiveAccount } from "../../slash-commands/helpers/active-oauth-account";
import { outputMeta } from "../../tools/output-meta";
import { resolveToCwd, stripOuterDoubleQuotes } from "../../tools/path-utils";
import { getChangelogPath, parseChangelog } from "../../utils/changelog";
import { copyToClipboard } from "../../utils/clipboard";
import { openPath } from "../../utils/open";
import { setSessionTerminalTitle } from "../../utils/title-generator";

function showMarkdownPanel(ctx: InteractiveModeContext, title: string, markdown: string): void {
	const block = new TranscriptBlock();
	block.addChild(new DynamicBorder());
	block.addChild(new Text(theme.bold(theme.fg("accent", title)), 1, 0));
	block.addChild(new Spacer(1));
	block.addChild(new Markdown(markdown.trim(), 1, 1, getMarkdownTheme()));
	block.addChild(new DynamicBorder());
	ctx.present(block);
}

export class CommandController {
	constructor(private readonly ctx: InteractiveModeContext) {}

	openInBrowser(urlOrPath: string): void {
		openPath(urlOrPath);
	}

	async handleDumpCommand(): Promise<void> {
		try {
			const formatted = this.ctx.session.formatSessionAsText();
			if (!formatted) {
				this.ctx.showError("No messages to dump yet.");
				return;
			}
			// Build the LLM request JSON sidecar first so its path (and a
			// raw-context warning) can be appended to the copied transcript.
			let sidecarPath: string | undefined;
			let sidecarError: string | undefined;
			try {
				sidecarPath = await this.ctx.session.dumpLlmRequestToTmpDir();
			} catch (error: unknown) {
				sidecarError = error instanceof Error ? error.message : "Unknown error";
			}
			const doc = sidecarPath
				? `${formatted}\n\n---\nLLM request JSON: ${sidecarPath}\nThis file persists on disk and may contain raw context/secrets — treat accordingly.`
				: formatted;
			await copyToClipboard(doc);
			const statusParts = ["Session copied to clipboard"];
			if (sidecarPath) statusParts.push(`LLM request JSON: ${sidecarPath}`);
			if (sidecarError) statusParts.push(`LLM request JSON unavailable: ${sidecarError}`);
			this.ctx.showStatus(statusParts.join("\n"));
		} catch (error: unknown) {
			this.ctx.showError(`Failed to copy session: ${error instanceof Error ? error.message : "Unknown error"}`);
		}
	}

	handleAdvisorDumpCommand(isRaw = false) {
		try {
			const advisorHistory = this.ctx.session.formatAdvisorHistoryAsText({ compact: !isRaw });
			if (advisorHistory === null) {
				this.ctx.showError("Advisor is not active for this session.");
				return;
			}
			if (!advisorHistory) {
				this.ctx.showError("Advisor has no history yet.");
				return;
			}
			copyToClipboard(advisorHistory);
			this.ctx.showStatus("Advisor history copied to clipboard");
		} catch (error: unknown) {
			this.ctx.showError(
				`Failed to copy advisor history: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
		}
	}

	async handleSessionCommand(): Promise<void> {
		const stats = this.ctx.session.getSessionStats();
		const premiumRequests =
			"premiumRequests" in stats && typeof stats.premiumRequests === "number"
				? stats.premiumRequests
				: this.ctx.session.sessionManager.getUsageStatistics().premiumRequests;
		const normalizedPremiumRequests = Math.round((premiumRequests + Number.EPSILON) * 100) / 100;

		let info = `${theme.bold("Session Info")}\n\n`;
		info += `${theme.fg("dim", "File:")} ${stats.sessionFile ?? "In-memory"}\n`;
		info += `${theme.fg("dim", "ID:")} ${stats.sessionId}\n\n`;
		info += `\n${theme.bold("Provider")}\n`;
		const model = this.ctx.session.model;
		if (!model) {
			info += `${theme.fg("dim", "No model selected")}\n`;
		} else {
			const authMode = resolveProviderAuthMode(this.ctx.session.modelRegistry.authStorage, model.provider);
			const openaiWebsocketSetting = this.ctx.settings.get("providers.openaiWebsockets") ?? "auto";
			const preferOpenAICodexWebsockets =
				openaiWebsocketSetting === "on" ? true : openaiWebsocketSetting === "off" ? false : undefined;
			const credentialSource = this.ctx.session.modelRegistry.authStorage.describeCredentialSource(
				model.provider,
				stats.sessionId,
			);
			const providerDetails = getProviderDetails({
				model,
				sessionId: stats.sessionId,
				authMode,
				credentialSource,
				preferWebsockets: preferOpenAICodexWebsockets,
				providerSessionState: this.ctx.session.providerSessionState,
			});
			info += renderProviderSection(providerDetails, theme);
		}
		info += `\n`;
		info += `${theme.bold("Messages")}\n`;
		info += `${theme.fg("dim", "User:")} ${stats.userMessages}\n`;
		info += `${theme.fg("dim", "Assistant:")} ${stats.assistantMessages}\n`;
		info += `${theme.fg("dim", "Tool Calls:")} ${stats.toolCalls}\n`;
		info += `${theme.fg("dim", "Tool Results:")} ${stats.toolResults}\n`;
		info += `${theme.fg("dim", "Total:")} ${stats.totalMessages}\n\n`;
		// Append-only context
		{
			const setting = this.ctx.settings.get("provider.appendOnlyContext") ?? "auto";
			const model = this.ctx.session.model;
			const mode = shouldEnableAppendOnlyContext(setting, model);
			const activeLabel = mode ? theme.fg("success", "active") : theme.fg("dim", "inactive");
			const settingLabel = setting === "auto" ? `${setting} (${model?.provider ?? "?"})` : setting;
			info += `${theme.fg("dim", "Append-Only:")} ${activeLabel} (setting: ${settingLabel})\n`;
		}
		info += `${theme.bold("Tokens")}\n`;
		info += `${theme.fg("dim", "Input:")} ${stats.tokens.input.toLocaleString()}\n`;
		info += `${theme.fg("dim", "Output:")} ${stats.tokens.output.toLocaleString()}\n`;
		if (stats.tokens.cacheRead > 0) {
			info += `${theme.fg("dim", "Cache Read:")} ${stats.tokens.cacheRead.toLocaleString()}\n`;
		}
		if (stats.tokens.cacheWrite > 0) {
			info += `${theme.fg("dim", "Cache Write:")} ${stats.tokens.cacheWrite.toLocaleString()}\n`;
		}
		info += `${theme.fg("dim", "Total:")} ${stats.tokens.total.toLocaleString()}\n`;

		if (stats.cost > 0 || normalizedPremiumRequests > 0) {
			info += `\n${theme.bold("Cost")}\n`;
			if (stats.cost > 0) {
				info += `${theme.fg("dim", "Total:")} ${stats.cost.toFixed(4)}\n`;
			}
			if (normalizedPremiumRequests > 0) {
				info += `${theme.fg("dim", "Premium Requests:")} ${normalizedPremiumRequests.toLocaleString()}\n`;
			}
		}

		if (this.ctx.mcpManager) {
			const mcpServers = this.ctx.mcpManager.getConnectedServers();
			info += `\n${theme.bold("MCP Servers")}\n`;
			if (mcpServers.length === 0) {
				info += `${theme.fg("dim", "None connected")}\n`;
			} else {
				for (const name of mcpServers) {
					const conn = this.ctx.mcpManager.getConnection(name);
					const toolCount = conn?.tools?.length ?? 0;
					info += `${theme.fg("dim", `${name}:`)} ${theme.fg("success", "connected")} ${theme.fg("dim", `(${toolCount} tools)`)}\n`;
				}
			}
		}

		this.ctx.present([new Spacer(1), new Text(info, 1, 0)]);
	}

	async handleAdvisorStatusCommand(): Promise<void> {
		const stats = this.ctx.session.getAdvisorStats();
		if (!stats.active) {
			this.ctx.present([
				new Spacer(1),
				new Text(
					stats.configured
						? "Advisor setting is enabled, but no model is assigned to the 'advisor' role."
						: "Advisor is disabled.",
					1,
					0,
				),
			]);
			return;
		}
		const model = stats.model!;
		let info = `${theme.bold("Advisor Status")}\n\n`;
		info += `${theme.bold("Provider")}\n`;
		info += `${theme.fg("dim", "Model:")} ${model.provider}/${model.id}\n`;
		info += `\n${theme.bold("Messages")}\n`;
		info += `${theme.fg("dim", "User:")} ${stats.messages.user.toLocaleString()}\n`;
		info += `${theme.fg("dim", "Assistant:")} ${stats.messages.assistant.toLocaleString()}\n`;
		info += `${theme.fg("dim", "Total:")} ${stats.messages.total.toLocaleString()}\n`;
		info += `\n${theme.bold("Context")}\n`;
		if (stats.contextWindow > 0) {
			const percent = Math.round((stats.contextTokens / stats.contextWindow) * 100);
			info += `${theme.fg("dim", "Tokens:")} ${stats.contextTokens.toLocaleString()} / ${stats.contextWindow.toLocaleString()} (${percent}%)\n`;
		} else {
			info += `${theme.fg("dim", "Tokens:")} ${stats.contextTokens.toLocaleString()}\n`;
		}
		info += `\n${theme.bold("Spend")}\n`;
		info += `${theme.fg("dim", "Input:")} ${stats.tokens.input.toLocaleString()}\n`;
		info += `${theme.fg("dim", "Output:")} ${stats.tokens.output.toLocaleString()}\n`;
		if (stats.tokens.cacheRead > 0) {
			info += `${theme.fg("dim", "Cache Read:")} ${stats.tokens.cacheRead.toLocaleString()}\n`;
		}
		if (stats.tokens.cacheWrite > 0) {
			info += `${theme.fg("dim", "Cache Write:")} ${stats.tokens.cacheWrite.toLocaleString()}\n`;
		}
		info += `${theme.fg("dim", "Total:")} ${stats.tokens.total.toLocaleString()}\n`;
		if (stats.cost > 0) {
			info += `\n${theme.bold("Cost")}\n`;
			info += `${theme.fg("dim", "Total:")} $${stats.cost.toFixed(4)}\n`;
		}
		this.ctx.present([new Spacer(1), new Text(info, 1, 0)]);
	}

	async handleJobsCommand(): Promise<void> {
		const snapshot = this.ctx.session.getAsyncJobSnapshot({ recentLimit: 5 });
		if (!snapshot) {
			this.ctx.showWarning("Async background jobs are unavailable in this session.");
			return;
		}

		const now = Date.now();
		const lineWidth = Math.max(24, (this.ctx.ui.terminal.columns ?? 100) - 24);
		let info = `${theme.bold("Background Jobs")}\n\n`;
		info += `${theme.fg("dim", "Running:")} ${snapshot.running.length}\n`;

		if (snapshot.running.length === 0 && snapshot.recent.length === 0) {
			info += `\n${theme.fg("dim", "No async jobs yet.")}\n`;
			this.ctx.present([new Spacer(1), new Text(info, 1, 0)]);
			return;
		}

		if (snapshot.running.length > 0) {
			info += `\n${theme.bold("Running Jobs")}\n`;
			for (const job of snapshot.running) {
				info += `${renderJobLine(job, now)}\n`;
				info += `  ${theme.fg("dim", truncateJobLabel(job.label, lineWidth))}\n`;
			}
		}

		if (snapshot.recent.length > 0) {
			info += `\n${theme.bold("Recent Jobs")}\n`;
			for (const job of snapshot.recent) {
				info += `${renderJobLine(job, now)}\n`;
				info += `  ${theme.fg("dim", truncateJobLabel(job.label, lineWidth))}\n`;
			}
		}

		this.ctx.present([new Spacer(1), new Text(info.trimEnd(), 1, 0)]);
	}

	async handleUsageCommand(reports?: UsageReport[] | null): Promise<void> {
		let usageReports = reports ?? null;
		if (!usageReports) {
			const provider = this.ctx.session as { fetchUsageReports?: () => Promise<UsageReport[] | null> };
			if (!provider.fetchUsageReports) {
				this.ctx.showWarning("Usage reporting is not configured for this session.");
				return;
			}
			try {
				usageReports = await provider.fetchUsageReports();
			} catch (error) {
				this.ctx.showError(`Failed to fetch usage data: ${error instanceof Error ? error.message : String(error)}`);
				return;
			}
		}

		if (!usageReports || usageReports.length === 0) {
			this.ctx.showWarning("No usage data available.");
			return;
		}

		const availableWidth = Math.max(40, (this.ctx.ui.terminal.columns ?? 100) - 2);
		const currentProvider = this.ctx.session.model?.provider;
		const activeAccount = currentProvider
			? this.ctx.session.modelRegistry.authStorage.getOAuthAccountIdentity(
					currentProvider,
					this.ctx.session.sessionId,
				)
			: undefined;
		const output = renderUsageReports(usageReports, theme, Date.now(), availableWidth, provider =>
			provider === currentProvider ? activeAccount : undefined,
		);
		this.ctx.present([new Spacer(1), new Text(output, 1, 0)]);
	}

	async handleChangelogCommand(showFull = false): Promise<void> {
		const changelogPath = getChangelogPath();
		const allEntries = await parseChangelog(changelogPath);
		// Default to showing only the latest 3 versions unless --full is specified
		// allEntries comes from parseChangelog with newest first, reverse to show oldest->newest
		const entriesToShow = showFull ? allEntries : allEntries.slice(0, 3);
		const changelogMarkdown =
			entriesToShow.length > 0
				? [...entriesToShow]
						.reverse()
						.map(e => e.content)
						.join("\n\n")
				: "No changelog entries found.";
		const title = showFull ? "Full Changelog" : "Recent Changes";
		const hint = showFull
			? ""
			: `\n\n${theme.fg("dim", "Use")} ${theme.bold("/changelog full")} ${theme.fg("dim", "to view the complete changelog.")}`;

		const block = new TranscriptBlock();
		block.addChild(new DynamicBorder());
		block.addChild(new Text(theme.bold(theme.fg("accent", title)), 1, 0));
		block.addChild(new Spacer(1));
		block.addChild(new Markdown(changelogMarkdown + hint, 1, 1, getMarkdownTheme()));
		block.addChild(new DynamicBorder());
		this.ctx.present(block);
	}

	handleHotkeysCommand(): void {
		const hotkeys = buildHotkeysMarkdown({ keybindings: this.ctx.keybindings });
		showMarkdownPanel(this.ctx, "Keyboard Shortcuts", hotkeys);
	}

	handleToolsCommand(): void {
		const tools = buildToolsMarkdown({ tools: this.ctx.session.agent.state.tools });
		showMarkdownPanel(this.ctx, "Available Tools", tools);
	}

	handleContextCommand(): void {
		const breakdown = computeContextBreakdown(this.ctx.session, { snapcompactSavings: true });
		if (breakdown.contextWindow <= 0) {
			this.ctx.showWarning("Context usage is unavailable: no model is selected for this session.");
			return;
		}
		const output = renderContextUsage(breakdown, theme);
		const block = new TranscriptBlock();
		block.addChild(new DynamicBorder());
		block.addChild(new Text(theme.bold(theme.fg("accent", "Context Usage")), 1, 0));
		block.addChild(new Spacer(1));
		block.addChild(new Text(output, 1, 0));
		block.addChild(new DynamicBorder());
		this.ctx.present(block);
	}

	async #runNewSessionFlow(options?: NewSessionOptions, label: string = "New session started"): Promise<void> {
		if (this.ctx.loadingAnimation) {
			this.ctx.loadingAnimation.stop();
			this.ctx.loadingAnimation = undefined;
		}
		this.ctx.statusContainer.clear();

		if (this.ctx.session.isCompacting) {
			this.ctx.session.abortCompaction();
			while (this.ctx.session.isCompacting) {
				await Bun.sleep(10);
			}
		}
		if (!(await this.ctx.session.newSession(options))) return;
		this.ctx.resetObserverRegistry();
		setSessionTerminalTitle(this.ctx.sessionManager.getSessionName(), this.ctx.sessionManager.getCwd());

		this.ctx.statusLine.invalidate();
		this.ctx.statusLine.setSessionStartTime(Date.now());
		this.ctx.updateEditorTopBorder();
		this.ctx.updateEditorBorderColor();
		this.ctx.chatContainer.clear();
		this.ctx.pendingMessagesContainer.clear();
		this.ctx.compactionQueuedMessages = [];
		this.ctx.streamingComponent = undefined;
		this.ctx.streamingMessage = undefined;
		this.ctx.pendingTools.clear();

		this.ctx.present([new Spacer(1), new Text(`${theme.fg("accent", `${theme.status.success} ${label}`)}`, 1, 1)]);
		await this.ctx.reloadTodos();
		this.ctx.ui.requestRender(true, { clearScrollback: true });
	}

	async handleClearCommand(): Promise<void> {
		await this.#runNewSessionFlow();
	}

	async handleFreshCommand(): Promise<void> {
		const result = this.ctx.session.freshSession();
		if (!result) {
			this.ctx.showWarning("Wait for the current response to finish or abort it before refreshing provider state.");
			return;
		}
		const stateLabel = result.closedProviderSessions === 1 ? "provider state" : "provider states";
		this.ctx.statusLine.invalidate();
		this.ctx.updateEditorTopBorder();
		this.ctx.showStatus(`Fresh provider session started (${result.closedProviderSessions} ${stateLabel} pruned).`);
	}

	async handleDropCommand(): Promise<void> {
		if (!this.ctx.sessionManager.getSessionFile()) {
			this.ctx.showError("Nothing to drop (in-memory session)");
			return;
		}
		await this.#runNewSessionFlow({ drop: true }, "Session dropped");
	}

	async handleForkCommand(): Promise<void> {
		if (this.ctx.session.isStreaming) {
			this.ctx.showWarning("Wait for the current response to finish or abort it before forking.");
			return;
		}
		if (this.ctx.loadingAnimation) {
			this.ctx.loadingAnimation.stop();
			this.ctx.loadingAnimation = undefined;
		}
		this.ctx.statusContainer.clear();

		const success = await this.ctx.session.fork();
		if (!success) {
			this.ctx.showError("Fork failed (session not persisted or cancelled)");
			return;
		}

		this.ctx.statusLine.invalidate();
		this.ctx.updateEditorTopBorder();

		const sessionFile = this.ctx.session.sessionFile;
		const shortPath = sessionFile ? sessionFile.split("/").pop() : "new session";
		this.ctx.present([
			new Spacer(1),
			new Text(`${theme.fg("accent", `${theme.status.success} Session forked to ${shortPath}`)}`, 1, 1),
		]);
	}

	async handleMoveCommand(targetPath: string): Promise<void> {
		if (this.ctx.session.isStreaming) {
			this.ctx.showWarning("Wait for the current response to finish or abort it before moving.");
			return;
		}

		const unquoted = stripOuterDoubleQuotes(targetPath);
		if (!unquoted) {
			this.ctx.showError("Usage: /move <path>");
			return;
		}

		const cwd = this.ctx.sessionManager.getCwd();
		const resolvedPath = resolveToCwd(unquoted, cwd);

		try {
			const stat = await fs.stat(resolvedPath);
			if (!stat.isDirectory()) {
				this.ctx.showError(`Not a directory: ${resolvedPath}`);
				return;
			}
		} catch {
			this.ctx.showError(`Directory does not exist: ${resolvedPath}`);
			return;
		}

		try {
			await this.ctx.sessionManager.flush();
			await this.ctx.sessionManager.moveTo(resolvedPath);
			await this.ctx.applyCwdChange(resolvedPath);

			this.ctx.present([
				new Spacer(1),
				new Text(`${theme.fg("accent", `${theme.status.success} Session moved to ${resolvedPath}`)}`, 1, 1),
			]);
		} catch (err) {
			this.ctx.showError(`Move failed: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	async handleRenameCommand(title: string): Promise<void> {
		try {
			const stored = await this.ctx.sessionManager.setSessionName(title, "user");
			if (!stored) {
				this.ctx.showError("Session name cannot be empty.");
				return;
			}
			const name = this.ctx.sessionManager.getSessionName()!;
			setSessionTerminalTitle(name, this.ctx.sessionManager.getCwd());
			this.ctx.statusLine.invalidate();
			this.ctx.updateEditorBorderColor();
			this.ctx.showStatus(`Session renamed to "${name}".`);
		} catch (err) {
			this.ctx.showError(`Rename failed: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	async handleBashCommand(command: string, excludeFromContext = false): Promise<void> {
		const isDeferred = this.ctx.session.isStreaming;
		this.ctx.bashComponent = new BashExecutionComponent(command, this.ctx.ui, excludeFromContext);

		if (isDeferred) {
			this.ctx.pendingMessagesContainer.addChild(this.ctx.bashComponent);
			this.ctx.pendingBashComponents.push(this.ctx.bashComponent);
		} else {
			this.ctx.present(this.ctx.bashComponent);
		}
		this.ctx.ui.requestRender();

		try {
			const result = await this.ctx.session.executeBash(
				command,
				chunk => {
					if (this.ctx.bashComponent) {
						this.ctx.bashComponent.appendOutput(chunk);
					}
				},
				{ excludeFromContext, useUserShell: true },
			);

			if (this.ctx.bashComponent) {
				const meta = outputMeta().truncationFromSummary(result, { direction: "tail" }).get();
				this.ctx.bashComponent.setComplete(result.exitCode, result.cancelled, {
					output: result.output,
					truncation: meta?.truncation,
				});
			}
		} catch (error) {
			if (this.ctx.bashComponent) {
				this.ctx.bashComponent.setComplete(undefined, false);
			}
			this.ctx.showError(`Bash command failed: ${error instanceof Error ? error.message : "Unknown error"}`);
		}

		this.ctx.bashComponent = undefined;
		this.ctx.ui.requestRender();
	}

	async handlePythonCommand(code: string, excludeFromContext = false): Promise<void> {
		const isDeferred = this.ctx.session.isStreaming;
		this.ctx.pythonComponent = new EvalExecutionComponent(code, this.ctx.ui, excludeFromContext);

		if (isDeferred) {
			this.ctx.pendingMessagesContainer.addChild(this.ctx.pythonComponent);
			this.ctx.pendingPythonComponents.push(this.ctx.pythonComponent);
		} else {
			this.ctx.present(this.ctx.pythonComponent);
		}
		this.ctx.ui.requestRender();

		try {
			const result = await this.ctx.session.executePython(
				code,
				chunk => {
					if (this.ctx.pythonComponent) {
						this.ctx.pythonComponent.appendOutput(chunk);
					}
				},
				{ excludeFromContext },
			);

			if (this.ctx.pythonComponent) {
				const meta = outputMeta().truncationFromSummary(result, { direction: "tail" }).get();
				this.ctx.pythonComponent.setComplete(result.exitCode, result.cancelled, {
					output: result.output,
					truncation: meta?.truncation,
				});
			}
		} catch (error) {
			if (this.ctx.pythonComponent) {
				this.ctx.pythonComponent.setComplete(undefined, false);
			}
			this.ctx.showError(`Python execution failed: ${error instanceof Error ? error.message : "Unknown error"}`);
		}

		this.ctx.pythonComponent = undefined;
		this.ctx.ui.requestRender();
	}

	async handleCompactCommand(
		customInstructions?: string,
		mode?: CompactMode,
		beforeFlush?: (outcome: CompactionOutcome) => void | Promise<void>,
	): Promise<CompactionOutcome> {
		const entries = this.ctx.sessionManager.getEntries();
		const messageCount = entries.filter(e => e.type === "message").length;

		if (messageCount < 2) {
			this.ctx.showWarning("Nothing to compact (no messages yet)");
			return "ok";
		}

		return this.executeCompaction(customInstructions, false, beforeFlush, mode);
	}

	/**
	 * TUI handler for `/shake`. `elide` drops heavy structural content and
	 * `images` strips image blocks. Rebuilds the chat and reports counts.
	 */
	async handleShakeCommand(mode: ShakeMode): Promise<void> {
		let result: ShakeResult;
		try {
			result = await this.ctx.session.shake(mode);
		} catch (error) {
			this.ctx.showError(`Shake failed: ${error instanceof Error ? error.message : String(error)}`);
			return;
		}

		const dropped = result.toolResultsDropped + result.blocksDropped + (result.imagesDropped ?? 0);
		if (dropped === 0) {
			this.ctx.showStatus("Nothing to shake.");
			return;
		}
		this.ctx.rebuildChatFromMessages();
		this.ctx.statusLine.invalidate();
		this.ctx.updateEditorTopBorder();
		this.ctx.showStatus(formatShakeSummary(result));
	}

	async handleSkillCommand(skillPath: string, args: string): Promise<void> {
		try {
			const content = await Bun.file(skillPath).text();
			const body = content.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
			const metaLines = [`Skill: ${skillPath}`];
			if (args) {
				metaLines.push(`User: ${args}`);
			}
			const message = `${body}\n\n---\n\n${metaLines.join("\n")}`;
			await this.ctx.session.prompt(message);
		} catch (err) {
			this.ctx.showError(`Failed to load skill: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	async executeCompaction(
		customInstructionsOrOptions?: string | CompactOptions,
		isAuto = false,
		beforeFlush?: (outcome: CompactionOutcome) => void | Promise<void>,
		mode?: CompactMode,
	): Promise<CompactionOutcome> {
		if (this.ctx.loadingAnimation) {
			this.ctx.loadingAnimation.stop();
			this.ctx.loadingAnimation = undefined;
		}
		this.ctx.statusContainer.clear();

		const label = isAuto ? "Auto-compacting context... (esc to cancel)" : "Compacting context... (esc to cancel)";
		const compactingLoader = new Loader(
			this.ctx.ui,
			spinner => theme.fg("accent", spinner),
			text => theme.fg("muted", text),
			label,
			getSymbolTheme().spinnerFrames,
		);
		this.ctx.statusContainer.addChild(compactingLoader);
		this.ctx.ui.requestRender();

		let outcome: CompactionOutcome = "ok";
		try {
			const instructions = typeof customInstructionsOrOptions === "string" ? customInstructionsOrOptions : undefined;
			const baseOptions =
				customInstructionsOrOptions && typeof customInstructionsOrOptions === "object"
					? customInstructionsOrOptions
					: undefined;
			// The slash path passes `mode` positionally; the extension path carries
			// it inside the options object. Either source wins over no mode.
			const effectiveMode = mode ?? baseOptions?.mode;
			const options =
				baseOptions || effectiveMode
					? { ...baseOptions, ...(effectiveMode ? { mode: effectiveMode } : {}) }
					: undefined;
			await this.ctx.session.compact(instructions, options);

			compactingLoader.stop();
			this.ctx.statusContainer.clear();
			this.ctx.rebuildChatFromMessages();

			this.ctx.statusLine.invalidate();
			this.ctx.updateEditorTopBorder();
		} catch (error) {
			if (error instanceof CompactionCancelledError) {
				outcome = "cancelled";
				this.ctx.showError("Compaction cancelled");
			} else {
				outcome = "failed";
				const message = error instanceof Error ? error.message : String(error);
				this.ctx.showError(`Compaction failed: ${message}`);
			}
		} finally {
			compactingLoader.stop();
			this.ctx.statusContainer.clear();
		}
		// Run the caller's pre-flush hook (e.g. the plan-approval model transition)
		// before queued user input is dispatched, so any turn queued during
		// compaction executes on the post-compaction model rather than the model
		// compaction itself ran on.
		if (beforeFlush) await beforeFlush(outcome);
		await this.ctx.flushCompactionQueue({ willRetry: false });
		return outcome;
	}

	async handleHandoffCommand(customInstructions?: string): Promise<void> {
		const entries = this.ctx.sessionManager.getEntries();
		const messageCount = entries.filter(e => e.type === "message").length;

		if (messageCount < 2) {
			this.ctx.showWarning("Nothing to hand off (no messages yet)");
			return;
		}

		if (this.ctx.loadingAnimation) {
			this.ctx.loadingAnimation.stop();
			this.ctx.loadingAnimation = undefined;
		}
		this.ctx.statusContainer.clear();

		const handoffLoader = new Loader(
			this.ctx.ui,
			spinner => theme.fg("accent", spinner),
			text => theme.fg("muted", text),
			"Generating handoff… (esc to cancel)",
			getSymbolTheme().spinnerFrames,
		);
		this.ctx.statusContainer.addChild(handoffLoader);
		this.ctx.ui.requestRender();

		try {
			// Handoff generation runs as a oneshot request; the new session is shown after it completes.
			const result = await this.ctx.session.handoff(customInstructions);

			if (!result) {
				this.ctx.showError("Handoff cancelled");
				return;
			}

			// Rebuild chat from the new session (which now contains the handoff document)
			this.ctx.rebuildChatFromMessages();

			this.ctx.statusLine.invalidate();
			this.ctx.updateEditorTopBorder();
			this.ctx.updateEditorBorderColor();
			await this.ctx.reloadTodos();

			this.ctx.present([
				new Spacer(1),
				new Text(`${theme.fg("accent", `${theme.status.success} New session started with handoff context`)}`, 1, 1),
			]);
			if (result.savedPath) {
				this.ctx.showStatus(`Handoff document saved to: ${result.savedPath}`);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (message === "Handoff cancelled" || (error instanceof Error && error.name === "AbortError")) {
				this.ctx.showError("Handoff cancelled");
			} else {
				this.ctx.showError(`Handoff failed: ${message}`);
			}
		} finally {
			handoffLoader.stop();
			this.ctx.statusContainer.clear();
		}
		this.ctx.ui.requestRender();
	}
}

const BAR_WIDTH_MAX = 24;
const BAR_WIDTH_MIN = 4;

function formatJobType(job: AsyncJobSnapshotItem): string {
	return job.type === "task" && job.agentName ? `${job.type}:${job.agentName}` : job.type;
}

function renderJobLine(job: AsyncJobSnapshotItem, now: number): string {
	const duration = formatDuration(Math.max(0, now - job.startTime));
	const status = formatJobStatus(job.status);
	return `${theme.fg("dim", job.id)} ${theme.fg("dim", `[${formatJobType(job)}]`)} ${status} ${theme.fg("dim", `(${duration})`)}`;
}

function formatJobStatus(status: AsyncJobSnapshotItem["status"]): string {
	if (status === "running") return theme.fg("warning", "running");
	if (status === "completed") return theme.fg("success", "completed");
	if (status === "cancelled") return theme.fg("dim", "cancelled");
	return theme.fg("error", "failed");
}

function truncateJobLabel(label: string, maxWidth: number): string {
	if (visibleWidth(label) <= maxWidth) return label;
	if (maxWidth <= 1) return "…";

	let out = "";
	for (const char of label) {
		const next = `${out}${char}`;
		if (visibleWidth(`${next}…`) > maxWidth) break;
		out = next;
	}

	return `${out}…`;
}

function formatProviderName(provider: string): string {
	return provider
		.split(/[-_]/g)
		.map(part => (part ? part[0].toUpperCase() + part.slice(1) : ""))
		.join(" ");
}

function formatNumber(value: number, maxFractionDigits = 1): string {
	return new Intl.NumberFormat("en-US", { maximumFractionDigits: maxFractionDigits }).format(value);
}

function resolveProviderAuthMode(authStorage: AuthStorage, provider: string): string {
	if (authStorage.hasOAuth(provider)) {
		return "oauth";
	}
	if (authStorage.has(provider)) {
		return "api key";
	}
	if (getEnvApiKey(provider)) {
		return "env api key";
	}
	if (authStorage.hasAuth(provider)) {
		return "runtime/fallback";
	}
	return "unknown";
}

export function renderProviderSection(details: ProviderDetails, uiTheme: Pick<typeof theme, "fg">): string {
	const lines: string[] = [];
	lines.push(`${uiTheme.fg("dim", "Name:")} ${details.provider}`);
	for (const field of details.fields) {
		lines.push(`${uiTheme.fg("dim", `${field.label}:`)} ${field.value}`);
	}
	return `${lines.join("\n")}\n`;
}

function resolveFraction(limit: UsageLimit): number | undefined {
	const amount = limit.amount;
	if (amount.usedFraction !== undefined) return amount.usedFraction;
	if (amount.used !== undefined && amount.limit !== undefined && amount.limit > 0) {
		return amount.used / amount.limit;
	}
	if (amount.unit === "percent" && amount.used !== undefined) {
		return amount.used / 100;
	}
	return undefined;
}

function resolveProviderUsageTotal(reports: UsageReport[]): number {
	return reports
		.flatMap(report => report.limits)
		.map(limit => resolveFraction(limit) ?? 0)
		.reduce((sum, value) => sum + value, 0);
}

function formatLimitTitle(limit: UsageLimit): string {
	const tier = limit.scope.tier;
	if (tier && !limit.label.toLowerCase().includes(tier.toLowerCase())) {
		return `${limit.label} (${tier})`;
	}
	return limit.label;
}

function formatWindowSuffix(label: string, windowLabel: string, uiTheme: typeof theme): string {
	const normalizedLabel = label.toLowerCase();
	const normalizedWindow = windowLabel.toLowerCase();
	if (normalizedWindow === "quota window") return "";
	if (normalizedLabel.includes(normalizedWindow)) return "";
	return uiTheme.fg("dim", `(${windowLabel})`);
}

function formatAccountLabel(limit: UsageLimit, report: UsageReport, index: number): string {
	const email = (report.metadata?.email as string | undefined) ?? limit.scope.accountId;
	if (email) return email;
	const accountId = (report.metadata?.accountId as string | undefined) ?? limit.scope.accountId;
	if (accountId) return accountId;
	const projectId = (report.metadata?.projectId as string | undefined) ?? limit.scope.projectId;
	if (projectId) return projectId;
	return `account ${index + 1}`;
}

function formatUnlimitedReportLabel(report: UsageReport, index: number): string {
	const email = report.metadata?.email as string | undefined;
	if (email) return email;
	const accountId = report.metadata?.accountId as string | undefined;
	if (accountId) return accountId;
	const projectId = report.metadata?.projectId as string | undefined;
	if (projectId) return projectId;
	return `account ${index + 1}`;
}

function formatResetShort(limit: UsageLimit, nowMs: number): string | undefined {
	const resetsAt = limit.window?.resetsAt;
	if (resetsAt === undefined) return undefined;
	// Codex returns the prior window's reset_at until a new request opens a fresh window —
	// rendering a negative delta is meaningless, so drop the suffix in that case.
	if (resetsAt <= nowMs) return undefined;
	return formatDuration(resetsAt - nowMs);
}

function formatAccountHeaderRow(
	limits: UsageLimit[],
	reports: UsageReport[],
	nowMs: number,
	columnWidth: number,
	uiTheme: typeof theme,
	activeAccount?: OAuthAccountIdentity,
): string[] {
	const parts = limits.map((limit, index) => {
		const reset = formatResetShort(limit, nowMs);
		const report = reports[index];
		const active = report !== undefined && limitMatchesActiveAccount(report, limit, activeAccount);
		const label = formatAccountLabel(limit, report, index);
		return {
			label: active ? `● ${label}` : label,
			suffix: reset ? `(${reset})` : "",
			active,
		};
	});
	const maxSuffixWidth = parts.reduce((max, p) => Math.max(max, visibleWidth(p.suffix)), 0);
	const gap = maxSuffixWidth > 0 ? 1 : 0;
	const prefixBudget = columnWidth - maxSuffixWidth - gap;

	// If suffix can't share the cell with at least `x…`, fall back to whole-label truncation.
	if (prefixBudget < 2) {
		return parts.map(p => {
			const full = p.suffix ? `${p.label} ${p.suffix}` : p.label;
			const cell = padColumn(truncateJobLabel(full, columnWidth), columnWidth);
			return p.active ? uiTheme.fg("accent", cell) : cell;
		});
	}

	return parts.map(p => {
		const prefix = truncateJobLabel(p.label, prefixBudget);
		const prefixCell = prefix + " ".repeat(prefixBudget - visibleWidth(prefix));
		const styledPrefix = p.active ? uiTheme.fg("accent", prefixCell) : prefixCell;
		if (!p.suffix) return styledPrefix + " ".repeat(maxSuffixWidth + gap);
		const suffixPad = " ".repeat(maxSuffixWidth - visibleWidth(p.suffix));
		return `${styledPrefix} ${suffixPad}${uiTheme.fg("dim", p.suffix)}`;
	});
}

function padColumn(text: string, width: number): string {
	const visible = visibleWidth(text);
	if (visible >= width) return text;
	return `${text}${padding(width - visible)}`;
}

function resolveAggregateStatus(limits: UsageLimit[]): UsageLimit["status"] {
	const hasOk = limits.some(limit => limit.status === "ok");
	const hasWarning = limits.some(limit => limit.status === "warning");
	const hasExhausted = limits.some(limit => limit.status === "exhausted");
	if (!hasOk && !hasWarning && !hasExhausted) return "unknown";
	if (hasOk) {
		return hasWarning || hasExhausted ? "warning" : "ok";
	}
	if (hasWarning) return "warning";
	return "exhausted";
}

function formatAggregateAmount(limits: UsageLimit[]): string {
	const fractions = limits
		.map(limit => resolveFraction(limit))
		.filter((value): value is number => value !== undefined);
	if (fractions.length === limits.length && fractions.length > 0) {
		const sum = fractions.reduce((total, value) => total + value, 0);
		const avgRemaining = Math.max(0, ((limits.length - sum) / limits.length) * 100);
		return `${formatNumber(avgRemaining)}% free`;
	}

	const amounts = limits
		.map(limit => limit.amount)
		.filter(amount => amount.used !== undefined && amount.limit !== undefined && amount.limit > 0);
	if (amounts.length === limits.length && amounts.length > 0) {
		const totalUsed = amounts.reduce((sum, amount) => sum + (amount.used ?? 0), 0);
		const totalLimit = amounts.reduce((sum, amount) => sum + (amount.limit ?? 0), 0);
		const remainingPct = totalLimit > 0 ? Math.max(0, 100 - (totalUsed / totalLimit) * 100) : 0;
		return `${formatNumber(remainingPct)}% free`;
	}

	// Count unique accounts from limit scopes — not limits.length.
	const uniqueAccountIds = new Set(
		limits.map(limit => limit.scope.accountId).filter((id): id is string => typeof id === "string" && id.length > 0),
	);
	if (uniqueAccountIds.size > 0) return `${uniqueAccountIds.size} ${uniqueAccountIds.size === 1 ? "acct" : "accts"}`;
	// No account IDs available — keep the pre-existing fallback so providers
	// that don't populate scope.accountId still show a summary.
	return `${limits.length} accts`;
}

function resolveResetRange(limits: UsageLimit[], nowMs: number): string | null {
	const absolute = limits
		.map(limit => limit.window?.resetsAt)
		.filter((value): value is number => value !== undefined && Number.isFinite(value) && value > nowMs);
	if (absolute.length === 0) return null;
	const offsets = absolute.map(value => value - nowMs);
	const minReset = Math.min(...offsets);
	const maxReset = Math.max(...offsets);
	if (maxReset - minReset > 60_000) {
		return `resets in ${formatDuration(minReset)}–${formatDuration(maxReset)}`;
	}
	return `resets in ${formatDuration(minReset)}`;
}

function resolveStatusIcon(status: UsageLimit["status"], uiTheme: typeof theme): string {
	if (status === "exhausted") return uiTheme.fg("error", uiTheme.status.error);
	if (status === "warning") return uiTheme.fg("warning", uiTheme.status.warning);
	if (status === "ok") return uiTheme.fg("success", uiTheme.status.success);
	return uiTheme.fg("dim", uiTheme.status.pending);
}

function resolveStatusColor(status: UsageLimit["status"]): "success" | "warning" | "error" | "dim" {
	if (status === "exhausted") return "error";
	if (status === "warning") return "warning";
	if (status === "ok") return "success";
	return "dim";
}

function renderUsageBar(limit: UsageLimit, uiTheme: typeof theme, barWidth: number): string {
	const fraction = resolveFraction(limit);
	if (fraction === undefined) {
		return uiTheme.fg("dim", "·".repeat(barWidth));
	}
	const clamped = Math.min(Math.max(fraction, 0), 1);
	const exact = clamped * barWidth;
	const fullCells = Math.floor(exact);
	const remainder = exact - fullCells;
	let partial = "";
	if (remainder >= 2 / 3) partial = "▓";
	else if (remainder >= 1 / 3) partial = "▒";
	const leading = "█".repeat(fullCells) + partial;
	const empty = "░".repeat(Math.max(0, barWidth - fullCells - (partial ? 1 : 0)));
	const color = resolveStatusColor(limit.status);
	return `${uiTheme.fg(color, leading)}${uiTheme.fg("dim", empty)}`;
}

/**
 * Pick a per-column width so n bars + a trailing amount string fit in `available` columns.
 * Falls back to the minimum when the terminal is too narrow rather than wrapping.
 */
function resolveColumnWidth(count: number, available: number, trailing: number): number {
	if (count <= 0) return BAR_WIDTH_MAX;
	const indent = 2;
	const gaps = count - 1;
	const spaceForBars = available - indent - gaps - (trailing > 0 ? trailing + 1 : 0);
	const ideal = Math.floor(spaceForBars / count);
	const min = BAR_WIDTH_MIN;
	const max = BAR_WIDTH_MAX;
	if (ideal < min) return min;
	if (ideal > max) return max;
	return ideal;
}

function renderUsageReports(
	reports: UsageReport[],
	uiTheme: typeof theme,
	nowMs: number,
	availableWidth: number,
	resolveActiveAccount?: (provider: string) => OAuthAccountIdentity | undefined,
): string {
	const lines: string[] = [];
	const latestFetchedAt = Math.max(...reports.map(report => report.fetchedAt ?? 0));
	const headerSuffix = latestFetchedAt ? ` (${formatDuration(nowMs - latestFetchedAt)} ago)` : "";
	lines.push(uiTheme.bold(uiTheme.fg("accent", `Usage${headerSuffix}`)));
	const grouped = new Map<string, UsageReport[]>();
	for (const report of reports) {
		const list = grouped.get(report.provider) ?? [];
		list.push(report);
		grouped.set(report.provider, list);
	}
	const providerEntries = Array.from(grouped.entries())
		.map(([provider, providerReports]) => ({
			provider,
			providerReports,
			totalUsage: resolveProviderUsageTotal(providerReports),
		}))
		.sort((a, b) => {
			if (a.totalUsage !== b.totalUsage) return a.totalUsage - b.totalUsage;
			return a.provider.localeCompare(b.provider);
		});

	for (const { provider, providerReports } of providerEntries) {
		lines.push("");
		const providerName = formatProviderName(provider);
		const activeAccount = resolveActiveAccount?.(provider);

		const limitGroups = new Map<
			string,
			{ label: string; windowLabel: string; limits: UsageLimit[]; reports: UsageReport[] }
		>();
		for (const report of providerReports) {
			for (const limit of report.limits) {
				const windowId = limit.window?.id ?? limit.scope.windowId ?? "default";
				const key = `${formatLimitTitle(limit)}|${windowId}`;
				const windowLabel = limit.window?.label ?? windowId;
				const entry = limitGroups.get(key) ?? {
					label: formatLimitTitle(limit),
					windowLabel,
					limits: [],
					reports: [],
				};
				entry.limits.push(limit);
				entry.reports.push(report);
				limitGroups.set(key, entry);
			}
		}

		lines.push(uiTheme.bold(uiTheme.fg("accent", providerName)));
		const activeAccountLabel = activeAccount?.email ?? activeAccount?.accountId ?? activeAccount?.projectId;
		if (activeAccountLabel) {
			lines.push(`  ${uiTheme.fg("accent", "in use by this session:")} ${activeAccountLabel}`);
		}

		const resetAccountLines: string[] = [];
		for (const report of providerReports) {
			const count = report.resetCredits?.availableCount ?? 0;
			if (count <= 0) continue;
			const label =
				(report.metadata?.email as string | undefined) ??
				(report.metadata?.accountId as string | undefined) ??
				"account";
			const isActive =
				!!activeAccount &&
				((!!activeAccount.accountId && activeAccount.accountId === report.metadata?.accountId) ||
					(!!activeAccount.email && activeAccount.email === report.metadata?.email));
			resetAccountLines.push(
				`    • ${label}: ${count} saved reset${count === 1 ? "" : "s"}${isActive ? " (active)" : ""}`,
			);
		}
		if (resetAccountLines.length > 0) {
			lines.push(
				`  ${uiTheme.fg("accent", "Saved rate-limit resets")} ${uiTheme.fg("dim", "(/usage reset to spend)")}`,
			);
			for (const line of resetAccountLines) lines.push(uiTheme.fg("dim", line));
		}

		const renderableGroups = Array.from(limitGroups.values()).map(group => {
			const entries = group.limits.map((limit, index) => ({
				limit,
				report: group.reports[index],
				fraction: resolveFraction(limit),
				index,
			}));
			entries.sort((a, b) => {
				const aFraction = a.fraction ?? -1;
				const bFraction = b.fraction ?? -1;
				if (aFraction !== bFraction) return bFraction - aFraction;
				return a.index - b.index;
			});
			const sortedLimits = entries.map(entry => entry.limit);
			const sortedReports = entries.map(entry => entry.report);
			return { group, sortedLimits, sortedReports, amountText: formatAggregateAmount(sortedLimits) };
		});

		const sectionCount = renderableGroups.reduce((max, g) => Math.max(max, g.sortedLimits.length), 0);
		const sectionTrailing = renderableGroups.reduce((max, g) => Math.max(max, visibleWidth(g.amountText)), 0);
		const sectionColumnWidth = resolveColumnWidth(sectionCount, availableWidth, sectionTrailing);

		for (const { group, sortedLimits, sortedReports, amountText } of renderableGroups) {
			const status = resolveAggregateStatus(sortedLimits);
			const statusIcon = resolveStatusIcon(status, uiTheme);

			const windowSuffix = formatWindowSuffix(group.label, group.windowLabel, uiTheme);
			lines.push(`${statusIcon} ${uiTheme.bold(group.label)} ${windowSuffix}`.trim());
			const accountLabels = formatAccountHeaderRow(
				sortedLimits,
				sortedReports,
				nowMs,
				sectionColumnWidth,
				uiTheme,
				activeAccount,
			);
			lines.push(`  ${accountLabels.join(" ")}`.trimEnd());
			const bars = sortedLimits.map(limit =>
				padColumn(renderUsageBar(limit, uiTheme, sectionColumnWidth), sectionColumnWidth),
			);
			lines.push(`  ${bars.join(" ")} ${amountText}`.trimEnd());
			const resetText = sortedLimits.length <= 1 ? resolveResetRange(sortedLimits, nowMs) : null;
			if (resetText) {
				lines.push(`  ${uiTheme.fg("dim", resetText)}`.trimEnd());
			}
			const notes = sortedLimits.flatMap(limit => limit.notes ?? []);
			if (notes.length > 0) {
				lines.push(`  ${uiTheme.fg("dim", notes.join(" • "))}`.trimEnd());
			}
		}

		// Render accounts with no rate limits (e.g. business/enterprise plans).
		const unlimitedReports = providerReports.filter(report => report.limits.length === 0);
		for (const report of unlimitedReports) {
			const label = formatUnlimitedReportLabel(report, 0);
			const tier = report.metadata?.planType as string | undefined;
			const tierSuffix = tier ? ` ${uiTheme.fg("dim", `(${tier})`)}` : "";
			lines.push(
				`${uiTheme.fg("success", uiTheme.status.success)} ${label}${tierSuffix} ${uiTheme.fg("dim", "-- no limits")}`,
			);
		}
		// No per-provider footer; global header shows last check.
	}

	return lines.join("\n");
}
