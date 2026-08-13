import type { AgentRunEvent } from '@hotel-butler/api';
import { describe, expect, it, vi } from 'vitest';
import type { McpCapability } from './agent-config';
import { AgentAccessDeniedError } from './agent-repository';
import { describeAgentRunFailure, HotelAgentGateway } from './agent-gateway';

const event: AgentRunEvent = {
	id: '22222222-2222-4222-8222-222222222222',
	runId: '33333333-3333-4333-8333-333333333333',
	conversationId: '44444444-4444-4444-8444-444444444444',
	createdAt: '2026-08-10T00:00:00.000Z',
	type: 'run_failed',
	message: 'test terminal',
	retryable: true
};

type ListEvents = (
	principal: Readonly<{ employeeId: string; orgId: string }>,
	runId: string,
	lastEventId?: string | null
) => Promise<readonly AgentRunEvent[]>;

function createGatewayHarness(
	listEvents: ListEvents,
	mcpCapabilities: readonly McpCapability[] = []
) {
	const repository = {
		listConversations: vi.fn(),
		createConversation: vi.fn(),
		getConversation: vi.fn(),
		deleteConversation: vi.fn(),
		clearConversations: vi.fn(),
		startRun: vi.fn(),
		resumeBusinessExecution: vi.fn(),
		getBusinessExecution: vi.fn(),
		transitionBusinessExecution: vi.fn(),
		recoverInterruptedRuns: vi.fn().mockResolvedValue(0),
		cancelRun: vi.fn(),
		getRunContext: vi.fn(),
		finalizeRunSuccess: vi.fn(),
		appendEvent: vi.fn(),
		listEvents,
		completeRun: vi.fn()
	};
	const runtime = { run: vi.fn() };
	const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
	const gateway = new HotelAgentGateway(
		{
			apiKey: '',
			baseUrl: 'https://api.moonshot.cn/v1',
			model: 'kimi-k3',
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
		logger
	);
	return { gateway, repository, runtime, logger };
}

function createGateway(listEvents: ListEvents) {
	return createGatewayHarness(listEvents).gateway;
}

describe('HotelAgentGateway session isolation', () => {
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
});

describe('HotelAgentGateway hotel quick actions', () => {
	it('exposes only actions that can run with the configured data sources', async () => {
		const { gateway } = createGatewayHarness(vi.fn(async () => []));

		const actions = await gateway.quickActions();

		expect(actions).toEqual([]);
		expect(actions.every((action) => !('prompt' in action))).toBe(true);
	});

	it('keeps one weather action and exposes hotel operating data when DMS is configured', async () => {
		const { gateway } = createGatewayHarness(
			vi.fn(async () => []),
			['weather', 'hotel_data']
		);

		const actions = await gateway.quickActions();

		expect(actions.map((action) => action.id)).toEqual(['today_weather', 'hotel_operating_data']);
		expect(actions[1]).toMatchObject({
			label: '查看酒店经营概览',
			category: 'operations',
			requiresMcp: true,
			available: true
		});
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

describe('HotelAgentGateway deterministic business collection', () => {
	it('uses the answer model only after deterministic evidence passes assessment', async () => {
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
			run: vi.fn().mockResolvedValue({ content: '天气运营建议', ui: null })
		};
		const workflowCollector = {
			collect: vi.fn().mockResolvedValue({
				status: 'collected',
				strategy: 'deterministic',
				toolEvidence: [
					{
						toolName: 'get_weather_summary',
						toolArgs: { city_name: '上海' },
						result: '# Weather Summary\n\n**Location:** Shanghai\n\n**Temperature:** 29°C'
					}
				]
			})
		};
		const summary = {
			id: businessExecutionId,
			conversationId,
			triggerUserMessageId: userMessageId,
			routeKind: 'business_read' as const,
			intent: 'weather_operations_advice' as const,
			status: 'routing' as const,
			pendingClarification: null,
			createdAt: '2026-08-13T00:00:00.000Z',
			updatedAt: '2026-08-13T00:00:00.000Z',
			completedAt: null
		};
		const request = {
			routeKind: 'business_read' as const,
			intent: 'weather_operations_advice' as const,
			slots: { location: '上海', date: 'today' }
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
					content: '查看今日天气',
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
			state: { status: 'routing', inputKind: 'quick_action', inputValue: 'today_weather' },
			version: 1
		});
		let version = 1;
		repository.transitionBusinessExecution.mockImplementation(
			(_owner, _executionId, _expectedVersion, event) => {
				version += 1;
				if (event.type === 'route_classified') {
					return Promise.resolve({
						summary: { ...summary, status: 'resolving_slots' },
						state: {
							status: 'resolving_slots',
							routeKind: 'business_read',
							intent: 'weather_operations_advice',
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
							evidence: [
								{
									evidenceId: '77777777-7777-4777-8777-777777777777',
									source: 'weather_mcp',
									data: {}
								}
							],
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
			content: '天气运营建议',
			ui: null,
			createdAt: '2026-08-13T00:00:01.000Z'
		});
		const gateway = new HotelAgentGateway(
			{
				apiKey: 'configured',
				baseUrl: 'https://api.moonshot.cn/v1',
				model: 'kimi-k3',
				mcpServers: {}
			},
			repository,
			runtime,
			{ prepare: vi.fn().mockResolvedValue({ summary: null, history: [] }) },
			{ serverCount: () => 1, capabilities: () => new Set(['weather']) },
			{ list: vi.fn().mockResolvedValue([]) },
			logger,
			{
				route: vi
					.fn()
					.mockResolvedValue({
						routeKind: 'business_read',
						intent: 'weather_operations_advice',
						slots: {}
					})
			},
			{ resolve: vi.fn().mockResolvedValue({ status: 'ready', request }) },
			workflowCollector
		);

		await gateway.startRun(principal, {
			conversationId,
			quickActionId: 'today_weather',
			clientRequestId: '55555555-5555-4555-8555-555555555555'
		});
		await vi.waitFor(() => expect(repository.finalizeRunSuccess).toHaveBeenCalledOnce());

		expect(workflowCollector.collect).toHaveBeenCalledOnce();
		expect(runtime.run).toHaveBeenCalledOnce();
		expect(runtime.run).toHaveBeenCalledWith(
			expect.objectContaining({ workflowRequest: request, validatedEvidence: expect.any(Array) })
		);
		expect(logger.info).toHaveBeenCalledWith(
			expect.objectContaining({
				event: 'agent.workflow.collection.completed',
				strategy: 'deterministic'
			}),
			'Agent workflow collection completed'
		);
	});
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
			new Error('MCP askDatabase ETIMEDOUT at secret.internal.example')
		);

		expect(failure).toEqual({
			message: '酒店经营数据服务暂时没有响应。请确认酒店和日期范围后重试，或稍后再试。',
			retryable: true
		});
		expect(failure.message).not.toContain('secret.internal.example');
	});
});
