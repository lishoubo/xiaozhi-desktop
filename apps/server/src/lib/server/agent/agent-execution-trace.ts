import type {
	AgentActiveRun,
	AgentExecutionTrace,
	AgentMessage,
	AgentRunEvent
} from '@hotel-butler/api';

export type StoredAgentRun = Readonly<{
	id: string;
	businessExecutionId?: string | null;
	userMessageId: string;
	status: 'running' | 'completed' | 'failed' | 'cancelled';
	createdAt: Date;
	completedAt: Date | null;
}>;

export function buildAgentExecutionTraces(
	runs: readonly StoredAgentRun[],
	events: readonly AgentRunEvent[]
): AgentExecutionTrace[] {
	const eventsByRun = new Map<string, AgentRunEvent[]>();
	for (const event of events) {
		const runEvents = eventsByRun.get(event.runId) ?? [];
		runEvents.push(event);
		eventsByRun.set(event.runId, runEvents);
	}

	return runs.map((run) => {
		const steps = new Map<string, AgentExecutionTrace['steps'][number]>();
		let assistantMessageId: string | null = null;
		let failure: AgentExecutionTrace['failure'] = null;
		for (const event of eventsByRun.get(run.id) ?? []) {
			if (event.type === 'tool_started') {
				steps.set(event.toolCallId, {
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					status: 'running',
					summary: ''
				});
			} else if (event.type === 'tool_completed') {
				steps.set(event.toolCallId, {
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					status: 'completed',
					summary: event.summary
				});
			} else if (event.type === 'run_completed') {
				assistantMessageId = event.message.id;
			} else if (event.type === 'run_failed') {
				failure = { message: event.message, retryable: event.retryable };
			}
		}
		return {
			runId: run.id,
			businessExecutionId: run.businessExecutionId ?? null,
			userMessageId: run.userMessageId,
			assistantMessageId,
			status: run.status,
			steps: [...steps.values()],
			createdAt: run.createdAt.toISOString(),
			completedAt: run.completedAt?.toISOString() ?? null,
			failure
		};
	});
}

export function buildActiveRunDraft(
	runId: string,
	events: readonly AgentRunEvent[]
): AgentActiveRun {
	let content = '';
	let ui: AgentActiveRun['ui'] = null;
	let preparingUi = false;
	let lastEventId: string | null = null;

	for (const event of events) {
		if (event.runId !== runId) continue;
		lastEventId = event.id;
		if (event.type === 'text_delta') {
			content += event.delta;
		} else if (event.type === 'tool_started' && event.toolName === 'render_hotel_ui') {
			preparingUi = true;
		} else if (event.type === 'ui_spec') {
			ui = event.spec;
			preparingUi = false;
		}
	}

	return { runId, content, ui, preparingUi, lastEventId };
}

export function buildRetainedFailedDraftMessages(
	runs: readonly StoredAgentRun[],
	events: readonly AgentRunEvent[]
): AgentMessage[] {
	const failedRuns = new Map(
		runs.filter((run) => run.status === 'failed').map((run) => [run.id, run])
	);
	const drafts = new Map<
		string,
		Readonly<{
			content: string;
			ui: AgentMessage['ui'];
			messageId: string | null;
			conversationId: string;
			createdAt: string | null;
			analysisStarted: boolean;
		}>
	>();
	for (const event of events) {
		if (!failedRuns.has(event.runId)) continue;
		const current = drafts.get(event.runId) ?? {
			content: '',
			ui: null,
			messageId: null,
			conversationId: event.conversationId,
			createdAt: null,
			analysisStarted: false
		};
		if (current.analysisStarted) continue;
		if (event.type === 'tool_started' && event.toolName === 'upstream_llm_analysis') {
			drafts.set(event.runId, { ...current, analysisStarted: true });
		} else if (event.type === 'text_delta') {
			drafts.set(event.runId, { ...current, content: current.content + event.delta });
		} else if (event.type === 'ui_spec') {
			drafts.set(event.runId, {
				...current,
				ui: event.spec,
				messageId: event.id,
				createdAt: event.createdAt
			});
		}
	}

	return [...drafts].flatMap(([runId, draft]) => {
		const run = failedRuns.get(runId);
		if (!run || !draft.analysisStarted || !draft.content.trim() || !draft.ui || !draft.messageId) {
			return [];
		}
		return [
			{
				id: draft.messageId,
				conversationId: draft.conversationId,
				businessExecutionId: run.businessExecutionId ?? null,
				role: 'assistant' as const,
				content: draft.content.trimEnd(),
				ui: draft.ui,
				createdAt: draft.createdAt ?? run.completedAt?.toISOString() ?? run.createdAt.toISOString()
			}
		];
	});
}
