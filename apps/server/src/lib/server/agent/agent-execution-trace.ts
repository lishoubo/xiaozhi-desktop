import type { AgentExecutionTrace, AgentRunEvent } from '@hotel-butler/api';

export type StoredAgentRun = Readonly<{
	id: string;
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
			}
		}
		return {
			runId: run.id,
			userMessageId: run.userMessageId,
			assistantMessageId,
			status: run.status,
			steps: [...steps.values()],
			createdAt: run.createdAt.toISOString(),
			completedAt: run.completedAt?.toISOString() ?? null
		};
	});
}
