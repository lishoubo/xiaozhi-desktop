import { agentRunEventSchema } from '@hotel-butler/api';
import type {
	AgentBusinessExecutionSummary,
	AgentFailureCode,
	AgentFailureRecovery,
	AgentMessage,
	AgentRunEvent
} from '@hotel-butler/api';
import type { AgentPrincipal, ApiLogger } from '@hotel-butler/api/router';
import { EventEmitter, on } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { AgentRepository } from './agent-repository';
import type { PublishableRuntimeEvent, RuntimeEvent } from './agent-runtime';

type RunEventRepository = Pick<AgentRepository, 'appendEvent' | 'listEvents'>;

export type AgentEventInput =
	| PublishableRuntimeEvent
	| Readonly<{ type: 'business_execution_updated'; execution: AgentBusinessExecutionSummary }>
	| Readonly<{ type: 'run_started' }>
	| Readonly<{ type: 'run_completed'; message: AgentMessage }>
	| Readonly<{
			type: 'run_failed';
			code: AgentFailureCode;
			message: string;
			recovery: AgentFailureRecovery;
			retryable: boolean;
	  }>
	| Readonly<{ type: 'run_cancelled' }>;

function terminal(event: AgentRunEvent): boolean {
	return event.type === 'run_completed' || event.type === 'run_failed' || event.type === 'run_cancelled';
}

export class RunEventStream {
	private readonly eventBus = new EventEmitter();

	constructor(
		private readonly repository: RunEventRepository,
		private readonly logger: ApiLogger
	) {
		this.eventBus.setMaxListeners(100);
	}

	async *events(
		principal: AgentPrincipal,
		input: Readonly<{ runId: string; lastEventId?: string | null }>,
		signal?: AbortSignal
	): AsyncIterable<AgentRunEvent> {
		const live = on(this.eventBus, input.runId, { signal });
		const history = await this.repository.listEvents(principal, input.runId, input.lastEventId);
		this.logger.debug(
			{
				event: 'agent.events.replay.ready',
				runId: input.runId,
				replayedEventCount: history.length,
				hasCursor: Boolean(input.lastEventId)
			},
			'Agent event replay ready'
		);
		const delivered = new Set<string>();
		for (const event of history) {
			delivered.add(event.id);
			yield event;
			if (terminal(event)) return;
		}
		for await (const [value] of live) {
			const event = agentRunEventSchema.parse(value);
			if (event.id === input.lastEventId || delivered.has(event.id)) continue;
			delivered.add(event.id);
			yield event;
			if (terminal(event)) return;
		}
	}

	async publish(
		principal: AgentPrincipal,
		runId: string,
		conversationId: string,
		event: AgentEventInput
	): Promise<void> {
		const value = agentRunEventSchema.parse({
			...event,
			id: randomUUID(),
			runId,
			conversationId,
			createdAt: new Date().toISOString()
		});
		await this.repository.appendEvent(value, principal);
		if (
			value.type === 'tool_started' ||
			value.type === 'tool_completed' ||
			value.type === 'tool_failed'
		) {
			const log =
				value.type === 'tool_failed'
					? this.logger.warn.bind(this.logger)
					: this.logger.debug.bind(this.logger);
			log(
				{
					event: `agent.${value.type}`,
					runId,
					conversationId,
					toolCallId: value.toolCallId,
					toolName: value.toolName,
					...(value.type === 'tool_failed' ? { failureCode: value.code } : {})
				},
				value.type === 'tool_started'
					? 'Agent tool started'
					: value.type === 'tool_failed'
						? 'Agent tool failed'
						: 'Agent tool completed'
			);
		}
		if (value.type === 'business_execution_updated') {
			this.logger.info(
				{
					event: 'agent.business_execution.state_changed',
					runId,
					conversationId,
					businessExecutionId: value.execution.id,
					status: value.execution.status,
					routeKind: value.execution.routeKind,
					intent: value.execution.intent
				},
				'Agent business execution state changed'
			);
		}
		this.eventBus.emit(runId, value);
	}

	forwardRuntimeEvent(
		principal: AgentPrincipal,
		runId: string,
		conversationId: string,
		event: RuntimeEvent,
		businessExecutionId: string | null = null
	): Promise<void> {
		if (event.type === 'runtime_phase_completed') {
			this.logger.info(
				{
					event: `agent.runtime.${event.phase}`,
					runId,
					conversationId,
					businessExecutionId,
					durationMs: event.durationMs
				},
				'Agent runtime phase completed'
			);
			return Promise.resolve();
		}
		if (event.type === 'mcp_call_started') {
			this.logger.info(
				{
					event: 'agent.mcp.call.started',
					runId,
					conversationId,
					businessExecutionId,
					toolCallId: event.toolCallId,
					toolName: event.toolName
				},
				'MCP call started'
			);
			return Promise.resolve();
		}
		if (event.type === 'mcp_call_completed') {
			this.logger.info(
				{
					event: 'agent.mcp.call.completed',
					runId,
					conversationId,
					businessExecutionId,
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					durationMs: event.durationMs,
					...event.resultSummary
				},
				'MCP call completed'
			);
			return Promise.resolve();
		}
		if (event.type === 'mcp_call_failed') {
			this.logger.warn(
				{
					event: 'agent.mcp.call.failed',
					runId,
					conversationId,
					businessExecutionId,
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					durationMs: event.durationMs,
					errorType: event.errorType,
					...(event.causeType ? { causeType: event.causeType } : {}),
					failureKind: event.failureKind,
					retryable: event.retryable
				},
				'MCP call failed'
			);
			return Promise.resolve();
		}
		return this.publish(principal, runId, conversationId, event);
	}
}
