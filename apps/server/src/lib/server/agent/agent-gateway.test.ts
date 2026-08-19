import type { AgentRunEvent } from '@hotel-butler/api';
import { describe, expect, it, vi } from 'vitest';
import type { McpCapability } from './agent-config';
import type { AgentRuntime } from './agent-runtime';
import { AgentAccessDeniedError } from './agent-repository';
import type { ConversationTitleGenerator } from './conversation-title';
import {
	describeAgentRunFailure,
	formatClarificationAnswer,
	HotelAgentGateway,
	runGroundedAnalysis
} from './agent-gateway';
import { AgentUpstreamError } from './agent-effect';
import type { EvidenceRecord } from './execution/business-execution-state';

const event: AgentRunEvent = {
	id: '22222222-2222-4222-8222-222222222222',
	runId: '33333333-3333-4333-8333-333333333333',
	conversationId: '44444444-4444-4444-8444-444444444444',
	createdAt: '2026-08-10T00:00:00.000Z',
	type: 'run_failed',
	message: 'test terminal',
	retryable: true
};

describe('runGroundedAnalysis', () => {
	it('enforces one total deadline and reports a model timeout', async () => {
		const parent = new AbortController();
		const publish = vi.fn(async () => undefined);
		const runtimeState: {
			emitLateEvent: ((event: { type: 'text_delta'; delta: string }) => Promise<void>) | null;
		} = { emitLateEvent: null };
		const runtime = {
			run: vi.fn((options: Parameters<AgentRuntime['run']>[0]) => {
				runtimeState.emitLateEvent = options.emit;
				return new Promise<never>(() => undefined);
			})
		};

		await expect(
			runGroundedAnalysis(
				runtime,
				{
					principal: { employeeId: '1001', orgId: '42' },
					conversationSummary: null,
					history: [],
					signal: parent.signal,
					emit: publish
				},
				5
			)
		).rejects.toMatchObject({
			_tag: 'AgentUpstreamError',
			service: 'model',
			operation: 'analyze_grounded_answer',
			kind: 'timeout'
		});
		expect(runtimeState.emitLateEvent).not.toBeNull();
		if (runtimeState.emitLateEvent) {
			await runtimeState.emitLateEvent({ type: 'text_delta', delta: '迟到内容' });
		}
		expect(publish).not.toHaveBeenCalled();
	});
});

describe('formatClarificationAnswer', () => {
	it('formats structured card values as readable conversation text', () => {
		expect(
			formatClarificationAnswer(
				{
					slot: 'hotelReference',
					label: '酒店',
					kind: 'single_choice',
					required: true,
					choices: [{ label: '西湖店', value: 'hotel-1' }]
				},
				'hotel-1'
			)
		).toBe('西湖店');
		expect(
			formatClarificationAnswer(
				{ slot: 'dateRange', label: '日期范围', kind: 'date_range', required: true },
				{ start: '2026-08-01', end: '2026-08-13' }
			)
		).toBe('2026-08-01 至 2026-08-13');
	});
});

type ListEvents = (
	principal: Readonly<{ employeeId: string; orgId: string }>,
	runId: string,
	lastEventId?: string | null
) => Promise<readonly AgentRunEvent[]>;

function createGatewayHarness(
	listEvents: ListEvents,
	mcpCapabilities: readonly McpCapability[] = [],
	conversationTitleGenerator?: ConversationTitleGenerator
) {
	const repository = {
		listConversations: vi.fn(),
		createConversation: vi.fn(),
		getConversation: vi.fn(),
		deleteConversation: vi.fn(),
		clearConversations: vi.fn(),
		startRun: vi.fn(),
		resumeBusinessExecution: vi.fn(),
		cancelBusinessExecution: vi.fn(),
		retryBusinessExecution: vi.fn(),
		getBusinessExecution: vi.fn(),
		transitionBusinessExecution: vi.fn(),
		recoverInterruptedRuns: vi.fn().mockResolvedValue(0),
		cancelRun: vi.fn(),
		getRunContext: vi.fn(),
		finalizeRunSuccess: vi.fn(),
		appendEvent: vi.fn(),
		listEvents,
		completeRun: vi.fn(),
		listMemories: vi.fn().mockResolvedValue([]),
		updateConversationTitle: vi.fn().mockResolvedValue(true)
	};
	const runtime = { run: vi.fn() };
	const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
	const gateway = new HotelAgentGateway(
		{
			apiKey: '',
			baseUrl: 'https://api.moonshot.cn/v1',
			model: 'kimi-k3',
			fastModel: 'kimi-k2.6',
			dmsDatabaseId: null,
			dmsDatabaseName: null,
			mcpServers: {}
		},
		repository,
		runtime,
		{ prepare: vi.fn().mockResolvedValue({ summary: null, history: [] }) },
		{
			serverCount: () => mcpCapabilities.length,
			capabilities: () => new Set(mcpCapabilities)
		},
		{ list: vi.fn().mockResolvedValue([]) },
		logger,
		undefined,
		undefined,
		undefined,
		conversationTitleGenerator
	);
	return { gateway, repository, runtime, logger };
}

function createGateway(listEvents: ListEvents) {
	return createGatewayHarness(listEvents).gateway;
}

describe('HotelAgentGateway session isolation', () => {
	it('updates the first conversation title on the fast parallel path without blocking completion', async () => {
		let resolveTitle!: (title: string) => void;
		const pendingTitle = new Promise<string>((resolve) => {
			resolveTitle = resolve;
		});
		const titleGenerator = {
			generate: vi.fn(() => pendingTitle)
		};
		const { gateway, repository, runtime } = createGatewayHarness(
			vi.fn(async () => []),
			[],
			titleGenerator
		);
		const principal = { employeeId: '1001', orgId: '42' } as const;
		const conversationId = '44444444-4444-4444-8444-444444444444';
		const runId = '33333333-3333-4333-8333-333333333333';
		const prompt = '请帮我查询上海酒店最近七天经营趋势';
		repository.startRun.mockResolvedValue({
			created: true,
			response: {
				runId,
				userMessage: {
					id: '22222222-2222-4222-8222-222222222222',
					conversationId,
					role: 'user',
					content: prompt,
					ui: null,
					createdAt: '2026-08-19T00:00:00.000Z'
				}
			}
		});
		repository.getRunContext.mockResolvedValue({
			run: { id: runId, status: 'running' },
			conversation: { id: conversationId, title: '查询上海酒店最近七天经营趋势' },
			userMessage: { content: prompt }
		});
		runtime.run.mockResolvedValue({ content: '完成', ui: null });
		repository.finalizeRunSuccess.mockResolvedValue({ id: 'assistant-message' });

		await gateway.startRun(principal, {
			conversationId,
			prompt,
			clientRequestId: '55555555-5555-4555-8555-555555555555'
		});
		await vi.waitFor(() => expect(repository.finalizeRunSuccess).toHaveBeenCalledOnce());
		expect(titleGenerator.generate).toHaveBeenCalledWith(prompt, expect.any(AbortSignal));
		expect(repository.updateConversationTitle).not.toHaveBeenCalled();

		resolveTitle('上海酒店近七日经营趋势');
		await vi.waitFor(() =>
			expect(repository.updateConversationTitle).toHaveBeenCalledWith(principal, {
				conversationId,
				expectedTitle: '查询上海酒店最近七天经营趋势',
				title: '上海酒店近七日经营趋势'
			})
		);
	});

	it('passes the authenticated principal into event replay', async () => {
		const listEvents = vi.fn(async () => [event]);
		const gateway = createGateway(listEvents);
		const principal = { employeeId: '1001', orgId: '42' } as const;
		const received: AgentRunEvent[] = [];

		for await (const item of gateway.events(principal, { runId: event.runId })) {
			received.push(item);
		}

		expect(received).toEqual([event]);
		expect(listEvents).toHaveBeenCalledWith(principal, event.runId, undefined);
	});

	it('does not expose another employee run when persistence rejects ownership', async () => {
		const listEvents = vi.fn(async (): Promise<readonly AgentRunEvent[]> => {
			throw new AgentAccessDeniedError('not owned');
		});
		const gateway = createGateway(listEvents);

		const consume = async () => {
			for await (const leakedEvent of gateway.events(
				{ employeeId: '2002', orgId: '42' },
				{ runId: event.runId }
			)) {
				expect.fail(`unexpected cross-session event: ${leakedEvent.id}`);
			}
		};
		await expect(consume()).rejects.toMatchObject({ code: 'NOT_FOUND' });
	});

	it('executes runs from different conversations concurrently with independent cancellation', async () => {
		const { gateway, repository, runtime } = createGatewayHarness(vi.fn(async () => []));
		const principal = { employeeId: '1001', orgId: '42' } as const;
		const runs = [
			{
				runId: '33333333-3333-4333-8333-333333333331',
				conversationId: '44444444-4444-4444-8444-444444444441',
				clientRequestId: '55555555-5555-4555-8555-555555555551'
			},
			{
				runId: '33333333-3333-4333-8333-333333333332',
				conversationId: '44444444-4444-4444-8444-444444444442',
				clientRequestId: '55555555-5555-4555-8555-555555555552'
			}
		] as const;
		const releases: Array<(value: { content: string; ui: null }) => void> = [];
		repository.startRun.mockImplementation(async (_principal, input) => {
			const run = runs.find((candidate) => candidate.conversationId === input.conversationId);
			if (!run) throw new Error('Unexpected conversation');
			return {
				created: true,
				response: {
					runId: run.runId,
					userMessage: {
						id: run.clientRequestId,
						conversationId: run.conversationId,
						role: 'user' as const,
						content: '查询数据',
						ui: null,
						createdAt: '2026-08-10T00:00:00.000Z'
					}
				}
			};
		});
		repository.getRunContext.mockImplementation(async (_principal, runId) => {
			const run = runs.find((candidate) => candidate.runId === runId);
			if (!run) throw new Error('Unexpected run');
			return {
				run: { id: run.runId, status: 'running' },
				conversation: { id: run.conversationId }
			};
		});
		runtime.run.mockImplementation(() => new Promise((resolve) => releases.push(resolve)));
		repository.finalizeRunSuccess.mockResolvedValue({ id: 'assistant-message' });

		await Promise.all(
			runs.map((run) =>
				gateway.startRun(principal, {
					conversationId: run.conversationId,
					prompt: '查询数据',
					clientRequestId: run.clientRequestId
				})
			)
		);
		await vi.waitFor(() => expect(runtime.run).toHaveBeenCalledTimes(2));

		expect(runtime.run.mock.calls[0]?.[0].signal).not.toBe(runtime.run.mock.calls[1]?.[0].signal);
		for (const release of releases) release({ content: '完成', ui: null });
		await vi.waitFor(() => expect(repository.finalizeRunSuccess).toHaveBeenCalledTimes(2));
	});
});

describe('HotelAgentGateway hotel quick actions', () => {
	it('exposes only actions that can run with the configured data sources', async () => {
		const { gateway } = createGatewayHarness(vi.fn(async () => []));

		const actions = await gateway.quickActions();

		expect(actions).toEqual([]);
		expect(actions.every((action) => !('prompt' in action))).toBe(true);
	});

	it('exposes five DMS-backed operating actions without the weather shortcut', async () => {
		const { gateway } = createGatewayHarness(
			vi.fn(async () => []),
			['weather', 'hotel_data']
		);

		const actions = await gateway.quickActions();

		expect(actions.map((action) => action.id)).toEqual([
			'yesterday_operating_review',
			'last_7_days_operating_trend',
			'month_to_date_operating_progress',
			'channel_operating_comparison',
			'hotel_operating_data'
		]);
		expect(actions.at(-1)).toMatchObject({
			label: '查看酒店经营概览',
			category: 'operations',
			requiresMcp: true,
			available: true
		});
		expect(actions.some((action) => action.id === 'yesterday_operating_review')).toBe(true);
	});

	it('persists a visible cancellation transcript for an awaiting clarification', async () => {
		const { gateway, repository } = createGatewayHarness(vi.fn(async () => []));
		const principal = { employeeId: '1001', orgId: '42' } as const;
		const businessExecutionId = '88888888-8888-4888-8888-888888888888';
		repository.getBusinessExecution.mockResolvedValue({
			summary: {
				id: businessExecutionId,
				conversationId: '44444444-4444-4444-8444-444444444444',
				status: 'awaiting_clarification'
			},
			state: { status: 'awaiting_clarification' }
		});
		repository.cancelBusinessExecution.mockResolvedValue({
			businessExecutionId,
			status: 'cancelled',
			userMessage: { content: '取消本次任务' },
			assistantMessage: { content: '好的，本次任务已取消。' }
		});

		await expect(
			gateway.cancelBusinessExecution(principal, businessExecutionId, 3)
		).resolves.toMatchObject({
			status: 'cancelled',
			userMessage: { content: '取消本次任务' },
			assistantMessage: { content: '好的，本次任务已取消。' }
		});
		expect(repository.cancelBusinessExecution).toHaveBeenCalledWith(
			principal,
			businessExecutionId,
			3
		);
	});

	it('rejects a live-data action before persistence when no hotel MCP is configured', async () => {
		const { gateway, repository } = createGatewayHarness(vi.fn(async () => []));

		await expect(
			gateway.startRun(
				{ employeeId: '1001', orgId: '42' },
				{
					conversationId: '44444444-4444-4444-8444-444444444444',
					quickActionId: 'public_hotel_rates',
					clientRequestId: '55555555-5555-4555-8555-555555555555'
				}
			)
		).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
		expect(repository.startRun).not.toHaveBeenCalled();
	});

	it('maps a quick action to its server-owned prompt', async () => {
		const { gateway, repository } = createGatewayHarness(
			vi.fn(async () => []),
			['hotel_data']
		);
		repository.startRun.mockResolvedValue({
			created: false,
			response: {
				runId: '33333333-3333-4333-8333-333333333333',
				userMessage: {
					id: '22222222-2222-4222-8222-222222222222',
					conversationId: '44444444-4444-4444-8444-444444444444',
					role: 'user',
					content: 'server prompt',
					ui: null,
					createdAt: '2026-08-10T00:00:00.000Z'
				}
			}
		});

		await gateway.startRun(
			{ employeeId: '1001', orgId: '42' },
			{
				conversationId: '44444444-4444-4444-8444-444444444444',
				quickActionId: 'hotel_operating_data',
				clientRequestId: '55555555-5555-4555-8555-555555555555'
			}
		);

		expect(repository.startRun).toHaveBeenCalledWith(
			{ employeeId: '1001', orgId: '42' },
			expect.objectContaining({
				conversationId: '44444444-4444-4444-8444-444444444444',
				clientRequestId: '55555555-5555-4555-8555-555555555555',
				prompt: expect.stringContaining('DMS 酒店经营数据 MCP')
			})
		);
	});
});

describe('HotelAgentGateway cancellation', () => {
	it('aborts an active owned run and publishes a cancelled terminal event', async () => {
		const { gateway, repository, runtime } = createGatewayHarness(vi.fn(async () => []));
		const principal = { employeeId: '1001', orgId: '42' } as const;
		const runId = '33333333-3333-4333-8333-333333333333';
		const conversationId = '44444444-4444-4444-8444-444444444444';
		repository.startRun.mockResolvedValue({
			created: true,
			response: {
				runId,
				userMessage: {
					id: '22222222-2222-4222-8222-222222222222',
					conversationId,
					role: 'user',
					content: '继续分析',
					ui: null,
					createdAt: '2026-08-10T00:00:00.000Z'
				}
			}
		});
		repository.getRunContext.mockResolvedValue({
			run: { id: runId, status: 'running' },
			conversation: { id: conversationId }
		});
		repository.cancelRun.mockResolvedValue({
			runId,
			conversationId,
			status: 'cancelled',
			transitioned: true
		});
		runtime.run.mockImplementation(
			({ signal }) =>
				new Promise((_resolve, reject) => {
					signal.addEventListener('abort', () => reject(signal.reason), { once: true });
				})
		);

		await gateway.startRun(principal, {
			conversationId,
			prompt: '继续分析',
			clientRequestId: '55555555-5555-4555-8555-555555555555'
		});
		await vi.waitFor(() => expect(runtime.run).toHaveBeenCalledOnce());

		await expect(gateway.cancelRun(principal, runId)).resolves.toEqual({
			runId,
			status: 'cancelled'
		});
		expect(runtime.run.mock.calls[0]?.[0].signal.aborted).toBe(true);
		expect(repository.appendEvent).toHaveBeenCalledWith(
			expect.objectContaining({ type: 'run_cancelled', runId, conversationId }),
			principal
		);
	});

	it('reuses an existing terminal state without publishing another event', async () => {
		const { gateway, repository } = createGatewayHarness(vi.fn(async () => []));
		const principal = { employeeId: '1001', orgId: '42' } as const;
		const runId = '33333333-3333-4333-8333-333333333333';
		repository.cancelRun.mockResolvedValue({
			runId,
			conversationId: '44444444-4444-4444-8444-444444444444',
			status: 'completed',
			transitioned: false
		});

		await expect(gateway.cancelRun(principal, runId)).resolves.toEqual({
			runId,
			status: 'completed'
		});
		expect(repository.appendEvent).not.toHaveBeenCalled();
	});

	it('does not publish or persist a late result after cancellation wins', async () => {
		const { gateway, repository, runtime, logger } = createGatewayHarness(vi.fn(async () => []));
		const principal = { employeeId: '1001', orgId: '42' } as const;
		const runId = '33333333-3333-4333-8333-333333333333';
		const conversationId = '44444444-4444-4444-8444-444444444444';
		let finishRuntime: ((value: { content: string; ui: null }) => void) | undefined;
		repository.startRun.mockResolvedValue({
			created: true,
			response: {
				runId,
				userMessage: {
					id: '22222222-2222-4222-8222-222222222222',
					conversationId,
					role: 'user',
					content: '分析经营情况',
					ui: null,
					createdAt: '2026-08-10T00:00:00.000Z'
				}
			}
		});
		repository.getRunContext.mockResolvedValue({
			run: { id: runId, status: 'running' },
			conversation: { id: conversationId }
		});
		repository.cancelRun.mockResolvedValue({
			runId,
			conversationId,
			status: 'cancelled',
			transitioned: true
		});
		repository.finalizeRunSuccess.mockResolvedValue(null);
		runtime.run.mockImplementation(
			() =>
				new Promise((resolve) => {
					finishRuntime = resolve;
				})
		);

		await gateway.startRun(principal, {
			conversationId,
			prompt: '分析经营情况',
			clientRequestId: '55555555-5555-4555-8555-555555555555'
		});
		await vi.waitFor(() => expect(runtime.run).toHaveBeenCalledOnce());
		await gateway.cancelRun(principal, runId);
		finishRuntime?.({ content: '不应落库的迟到答案', ui: null });
		await vi.waitFor(() =>
			expect(logger.info).toHaveBeenCalledWith(
				expect.objectContaining({ event: 'agent.run.execution.cancelled', runId }),
				'Agent run execution stopped after cancellation'
			)
		);
		expect(repository.finalizeRunSuccess).not.toHaveBeenCalled();

		const publishedTypes = repository.appendEvent.mock.calls.map(([published]) => published.type);
		expect(publishedTypes).toContain('run_cancelled');
		expect(publishedTypes).not.toContain('run_completed');
	});
});

describe('HotelAgentGateway retry', () => {
	it('retries through the authenticated repository operation and reuses an idempotent attempt', async () => {
		const { gateway, repository } = createGatewayHarness(vi.fn(async () => []));
		const principal = { employeeId: '1001', orgId: '42' } as const;
		const failedRunId = '33333333-3333-4333-8333-333333333333';
		const retryRunId = '77777777-7777-4777-8777-777777777777';
		const clientRequestId = '55555555-5555-4555-8555-555555555555';
		const conversationId = '44444444-4444-4444-8444-444444444444';
		repository.retryBusinessExecution.mockResolvedValue({
			created: false,
			response: {
				runId: retryRunId,
				businessExecutionId: '88888888-8888-4888-8888-888888888888',
				userMessage: {
					id: '22222222-2222-4222-8222-222222222222',
					conversationId,
					businessExecutionId: '88888888-8888-4888-8888-888888888888',
					role: 'user',
					content: '重新尝试上次请求',
					ui: null,
					createdAt: '2026-08-13T00:00:00.000Z'
				}
			}
		});

		await expect(
			gateway.retryRun(principal, { failedRunId, clientRequestId })
		).resolves.toMatchObject({ runId: retryRunId });
		expect(repository.retryBusinessExecution).toHaveBeenCalledWith(principal, {
			failedRunId,
			clientRequestId
		});
		expect(repository.getRunContext).not.toHaveBeenCalled();
	});
});

describe('HotelAgentGateway deterministic business collection', () => {
	it.each([
		{ responseMode: 'analysis' as const, runsAnalysis: true },
		{ responseMode: 'data_only' as const, runsAnalysis: false }
	])(
		'renders validated operating evidence with $responseMode response mode',
		async ({ responseMode, runsAnalysis }) => {
			const { repository, logger } = createGatewayHarness(
				vi.fn(async () => []),
				['weather']
			);
			const principal = { employeeId: '1001', orgId: '42' } as const;
			const runId = '33333333-3333-4333-8333-333333333333';
			const conversationId = '44444444-4444-4444-8444-444444444444';
			const businessExecutionId = '88888888-8888-4888-8888-888888888888';
			const userMessageId = '22222222-2222-4222-8222-222222222222';
			const assistantMessageId = '99999999-9999-4999-8999-999999999999';
			const runtime = {
				run: vi
					.fn()
					.mockResolvedValue({ content: '入住表现稳定，建议继续关注核销转化。', ui: null })
			};
			const workflowCollector = {
				collect: vi.fn().mockImplementation(async (input) => {
					await input.emit({
						type: 'mcp_call_started',
						toolCallId: 'tool-call-1',
						toolName: 'query_hotel_operating_data_sql'
					});
					await input.emit({
						type: 'mcp_call_completed',
						toolCallId: 'tool-call-1',
						toolName: 'query_hotel_operating_data_sql',
						durationMs: 321,
						resultSummary: {
							resultType: 'object',
							protocolStatus: 'success',
							contentBlockCount: 1,
							resultCharacterCount: 48,
							resultFingerprint: 'a'.repeat(64),
							filtered: false
						}
					});
					return {
						status: 'collected',
						strategy: 'deterministic',
						toolEvidence: [
							{
								toolName: 'query_hotel_operating_data_sql',
								toolArgs: { database_id: 'server-configured' },
								result: [
									{
										type: 'text',
										text: '| hotel_id | data_date | gmv | verified_amount |\n| --- | --- | --- | --- |\n| 1 | 2026-08-12 | 1000 | 800 |'
									}
								]
							}
						]
					};
				})
			};
			const summary = {
				id: businessExecutionId,
				conversationId,
				triggerUserMessageId: userMessageId,
				routeKind: 'business_read' as const,
				intent: 'hotel_operating_summary' as const,
				status: 'routing' as const,
				pendingClarification: null,
				createdAt: '2026-08-13T00:00:00.000Z',
				updatedAt: '2026-08-13T00:00:00.000Z',
				completedAt: null
			};
			const request = {
				routeKind: 'business_read' as const,
				intent: 'hotel_operating_summary' as const,
				responseMode,
				slots: {
					hotelReference: '1',
					dateRange: { start: '2026-08-12', end: '2026-08-12' }
				}
			};
			repository.startRun.mockResolvedValue({
				created: true,
				response: {
					runId,
					businessExecutionId,
					userMessage: {
						id: userMessageId,
						conversationId,
						businessExecutionId,
						role: 'user',
						content: '昨日经营复盘',
						ui: null,
						createdAt: '2026-08-13T00:00:00.000Z'
					}
				}
			});
			repository.getRunContext.mockResolvedValue({
				run: { id: runId, status: 'running', businessExecutionId },
				conversation: { id: conversationId }
			});
			repository.getBusinessExecution.mockResolvedValue({
				summary,
				state: {
					status: 'routing',
					inputKind: 'quick_action',
					inputValue: 'yesterday_operating_review'
				},
				version: 1
			});
			let version = 1;
			let persistedEvidence: readonly EvidenceRecord[] = [];
			repository.transitionBusinessExecution.mockImplementation(
				(_owner, _executionId, _expectedVersion, event) => {
					version += 1;
					if (event.type === 'route_classified') {
						return Promise.resolve({
							summary: { ...summary, status: 'resolving_slots' },
							state: {
								status: 'resolving_slots',
								routeKind: 'business_read',
								intent: 'hotel_operating_summary',
								slots: event.proposal.slots
							},
							version
						});
					}
					if (event.type === 'slots_ready') {
						return Promise.resolve({
							summary: { ...summary, status: 'ready' },
							state: { status: 'ready', request },
							version
						});
					}
					if (event.type === 'workflow_started') {
						return Promise.resolve({
							summary: { ...summary, status: 'executing' },
							state: { status: 'executing', request, evidence: [], followUpUsed: false },
							version
						});
					}
					if (event.type === 'workflow_completed') {
						persistedEvidence = event.evidence;
						return Promise.resolve({
							summary: { ...summary, status: 'validating_evidence' },
							state: {
								status: 'validating_evidence',
								request,
								evidence: event.evidence,
								followUpUsed: false
							},
							version
						});
					}
					if (event.type === 'evidence_validated') {
						return Promise.resolve({
							summary: { ...summary, status: 'answering' },
							state: {
								status: 'answering',
								mode: 'grounded',
								request,
								evidence: persistedEvidence,
								limitations: []
							},
							version
						});
					}
					return Promise.resolve({
						summary: { ...summary, status: 'completed' },
						state: { status: 'completed', assistantMessageId },
						version
					});
				}
			);
			repository.finalizeRunSuccess.mockResolvedValue({
				id: assistantMessageId,
				conversationId,
				businessExecutionId,
				role: 'assistant',
				content: '昨日经营复盘',
				ui: null,
				createdAt: '2026-08-13T00:00:01.000Z'
			});
			const gateway = new HotelAgentGateway(
				{
					apiKey: 'configured',
					baseUrl: 'https://api.moonshot.cn/v1',
					model: 'kimi-k3',
					fastModel: 'kimi-k2.6',
					dmsDatabaseId: null,
					dmsDatabaseName: null,
					mcpServers: {}
				},
				repository,
				runtime,
				{ prepare: vi.fn().mockResolvedValue({ summary: null, history: [] }) },
				{ serverCount: () => 1, capabilities: () => new Set(['hotel_data']) },
				{ list: vi.fn().mockResolvedValue([]) },
				logger,
				{
					route: vi.fn().mockResolvedValue({
						routeKind: 'business_read',
						intent: 'hotel_operating_summary',
						slots: {}
					})
				},
				{ resolve: vi.fn().mockResolvedValue({ status: 'ready', request }) },
				workflowCollector
			);

			await gateway.startRun(principal, {
				conversationId,
				quickActionId: 'yesterday_operating_review',
				clientRequestId: '55555555-5555-4555-8555-555555555555'
			});
			await vi.waitFor(() =>
				expect(
					repository.finalizeRunSuccess.mock.calls.length + logger.error.mock.calls.length
				).toBe(1)
			);
			expect(logger.error).not.toHaveBeenCalled();

			expect(workflowCollector.collect).toHaveBeenCalledOnce();
			if (runsAnalysis) {
				expect(runtime.run).toHaveBeenCalledWith(
					expect.objectContaining({
						workflowRequest: request,
						validatedEvidence: persistedEvidence,
						analysisOnly: true
					})
				);
			} else {
				expect(runtime.run).not.toHaveBeenCalled();
			}
			expect(repository.finalizeRunSuccess).toHaveBeenCalledWith(
				runId,
				conversationId,
				runsAnalysis
					? expect.stringMatching(/成交金额合计 1,000\.00 元[\s\S]+入住表现稳定/)
					: expect.stringContaining('成交金额合计 1,000.00 元'),
				expect.objectContaining({ root: 'root' })
			);
			if (runsAnalysis) {
				expect(JSON.stringify(repository.appendEvent.mock.calls)).toContain(
					'upstream_llm_analysis'
				);
			} else {
				expect(JSON.stringify(repository.appendEvent.mock.calls)).not.toContain(
					'upstream_llm_analysis'
				);
			}
			expect(logger.info).toHaveBeenCalledWith(
				expect.objectContaining({ event: 'agent.answer.deterministic.prepared' }),
				'Deterministic grounded result prepared'
			);
			expect(logger.info).toHaveBeenCalledWith(
				expect.objectContaining({
					event: 'agent.workflow.collection.completed',
					strategy: 'deterministic'
				}),
				'Agent workflow collection completed'
			);
			expect(logger.info).toHaveBeenCalledWith(
				expect.objectContaining({
					event: 'agent.mcp.call.completed',
					toolName: 'query_hotel_operating_data_sql',
					durationMs: 321,
					protocolStatus: 'success',
					resultCharacterCount: 48
				}),
				'MCP call completed'
			);
			expect(JSON.stringify(logger.info.mock.calls)).not.toContain('gmv');
		}
	);
});

describe('HotelAgentGateway observability', () => {
	it('logs safe run acceptance metadata without prompt content', async () => {
		const { gateway, repository, logger } = createGatewayHarness(vi.fn(async () => []));
		repository.startRun.mockResolvedValue({
			created: false,
			response: {
				runId: '33333333-3333-4333-8333-333333333333',
				userMessage: {
					id: '22222222-2222-4222-8222-222222222222',
					conversationId: '44444444-4444-4444-8444-444444444444',
					role: 'user',
					content: '敏感经营问题',
					ui: null,
					createdAt: '2026-08-10T00:00:00.000Z'
				}
			}
		});

		await gateway.startRun(
			{ employeeId: '1001', orgId: '42' },
			{
				conversationId: '44444444-4444-4444-8444-444444444444',
				prompt: '敏感经营问题',
				clientRequestId: '55555555-5555-4555-8555-555555555555'
			}
		);

		expect(logger.info).toHaveBeenCalledWith(
			expect.objectContaining({
				event: 'agent.run.reused',
				runId: '33333333-3333-4333-8333-333333333333',
				requestKind: 'prompt'
			}),
			'Agent run reused'
		);
		expect(JSON.stringify(logger.info.mock.calls)).not.toContain('敏感经营问题');
	});
});

describe('describeAgentRunFailure', () => {
	it('returns a friendly data-service message without exposing transport details', () => {
		const failure = describeAgentRunFailure(
			new AgentUpstreamError({
				service: 'mcp',
				operation: 'query_hotel_data',
				kind: 'timeout',
				cause: new Error('secret.internal.example')
			})
		);

		expect(failure).toEqual({
			message: '酒店经营数据服务暂时没有响应，请稍后重试。',
			retryable: true
		});
		expect(failure.message).not.toContain('secret.internal.example');
	});

	it('explains an incomplete analysis while keeping validated data visible', () => {
		const failure = describeAgentRunFailure(
			new AgentUpstreamError({
				service: 'model',
				operation: 'analyze_grounded_answer',
				kind: 'invalid_response'
			})
		);

		expect(failure).toEqual({
			message:
				'经营数据和图表已展示，但上游大模型没有返回完整分析。你可以先查看现有结果，或重试分析。',
			retryable: true
		});
	});
});
