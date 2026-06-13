import { describe, expect, it, vi } from "bun:test";
import { submitInteractiveInput } from "@amaze/coding-agent/main";
import type { SubmittedUserInput } from "@amaze/coding-agent/modes/types";

function createInput(overrides: Partial<SubmittedUserInput> = {}): SubmittedUserInput {
	return {
		text: "hello",
		images: undefined,
		cancelled: false,
		started: false,
		...overrides,
	};
}

describe("submitInteractiveInput", () => {
	it("prompts already-started continue submissions without re-checking optimistic state", async () => {
		const mode = {
			markPendingSubmissionStarted: vi.fn(() => false),
			finishPendingSubmission: vi.fn(),
			showError: vi.fn(),
			checkShutdownRequested: vi.fn(async () => {}),
			handlePlanModeCommand: vi.fn(async () => {}),
			planModeEnabled: false,
		};
		const session = {
			prompt: vi.fn(async () => {}),
			promptCustomMessage: vi.fn(async () => {}),
		};
		const input = createInput({ text: "", started: true });

		await submitInteractiveInput(mode, session, input);

		expect(mode.markPendingSubmissionStarted).not.toHaveBeenCalled();
		expect(session.prompt).toHaveBeenCalledWith("", { images: undefined });
		expect(mode.finishPendingSubmission).toHaveBeenCalledWith(input);
		expect(mode.showError).not.toHaveBeenCalled();
	});

	it("skips prompting when optimistic submission was cancelled before start", async () => {
		const mode = {
			markPendingSubmissionStarted: vi.fn(() => false),
			finishPendingSubmission: vi.fn(),
			showError: vi.fn(),
			checkShutdownRequested: vi.fn(async () => {}),
			handlePlanModeCommand: vi.fn(async () => {}),
			planModeEnabled: false,
		};
		const session = {
			prompt: vi.fn(async () => {}),
			promptCustomMessage: vi.fn(async () => {}),
		};
		const input = createInput();

		await submitInteractiveInput(mode, session, input);

		expect(mode.markPendingSubmissionStarted).toHaveBeenCalledWith(input);
		expect(session.prompt).not.toHaveBeenCalled();
		expect(mode.finishPendingSubmission).toHaveBeenCalledWith(input);
		expect(mode.showError).not.toHaveBeenCalled();
	});

	it("routes hidden custom submissions through promptCustomMessage", async () => {
		const mode = {
			markPendingSubmissionStarted: vi.fn(() => true),
			finishPendingSubmission: vi.fn(),
			showError: vi.fn(),
			checkShutdownRequested: vi.fn(async () => {}),
			handlePlanModeCommand: vi.fn(async () => {}),
			planModeEnabled: false,
		};
		const session = {
			prompt: vi.fn(async () => {}),
			promptCustomMessage: vi.fn(async () => {}),
		};
		const input = createInput({ text: "continue goal", customType: "goal-continuation" });

		await submitInteractiveInput(mode, session, input);

		expect(session.prompt).not.toHaveBeenCalled();
		expect(session.promptCustomMessage).toHaveBeenCalledWith({
			customType: "goal-continuation",
			content: "continue goal",
			display: false,
			attribution: "agent",
		});
		expect(mode.finishPendingSubmission).toHaveBeenCalledWith(input);
		expect(mode.showError).not.toHaveBeenCalled();
	});

	it("auto-enters plan mode for proposal-required objectives", async () => {
		const mode = {
			markPendingSubmissionStarted: vi.fn(() => true),
			finishPendingSubmission: vi.fn(),
			showError: vi.fn(),
			checkShutdownRequested: vi.fn(async () => {}),
			handlePlanModeCommand: vi.fn(async () => {}),
			planModeEnabled: false,
		};
		const session = {
			prompt: vi.fn(async () => {}),
			promptCustomMessage: vi.fn(async () => {}),
		};
		const input = createInput({ text: "architecture 전면 개편하고 모듈 rename 하자" });

		await submitInteractiveInput(mode, session, input);

		expect(mode.handlePlanModeCommand).toHaveBeenCalledWith(input.text);
		expect(session.prompt).not.toHaveBeenCalled();
		expect(mode.finishPendingSubmission).toHaveBeenCalledWith(input);
		expect(mode.showError).not.toHaveBeenCalled();
	});

	it("does not auto-enter plan mode for ordinary code changes", async () => {
		const mode = {
			markPendingSubmissionStarted: vi.fn(() => true),
			finishPendingSubmission: vi.fn(),
			showError: vi.fn(),
			checkShutdownRequested: vi.fn(async () => {}),
			handlePlanModeCommand: vi.fn(async () => {}),
			planModeEnabled: false,
		};
		const session = {
			prompt: vi.fn(async () => {}),
			promptCustomMessage: vi.fn(async () => {}),
		};
		const input = createInput({ text: "button color fix" });

		await submitInteractiveInput(mode, session, input);

		expect(mode.handlePlanModeCommand).not.toHaveBeenCalled();
		expect(session.prompt).toHaveBeenCalledWith("button color fix", { images: undefined });
		expect(mode.finishPendingSubmission).toHaveBeenCalledWith(input);
	});
});
