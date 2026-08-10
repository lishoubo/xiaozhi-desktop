import type { AgentRunEvent } from '@hotel-butler/api';
import { describe, expect, it, vi } from 'vitest';
import { AgentAccessDeniedError } from './agent-repository';
import { HotelAgentGateway } from './agent-gateway';

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
	mcpCapabilities: readonly ('weather' | 'hotel_rates')[] = []
) {
	const repository = {
		listConversations: vi.fn(),
		createConversation: vi.fn(),
		getConversation: vi.fn(),
		startRun: vi.fn(),
		getRunContext: vi.fn(),
		appendAssistantMessage: vi.fn(),
		appendEvent: vi.fn(),
		listEvents,
		completeRun: vi.fn()
	};
	const gateway = new HotelAgentGateway(
		{
			apiKey: '',
			baseUrl: 'https://api.moonshot.cn/v1',
			model: 'kimi-k3',
			mcpServers: {},
			allowMcpWriteTools: false
		},
		repository,
		{ run: vi.fn() },
		{
			serverCount: () => mcpCapabilities.length,
			capabilities: () => new Set(mcpCapabilities)
		},
		{ list: vi.fn().mockResolvedValue([]) },
		{ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
	);
	return { gateway, repository };
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
			['weather']
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
				quickActionId: 'today_weather',
				clientRequestId: '55555555-5555-4555-8555-555555555555'
			}
		);

		expect(repository.startRun).toHaveBeenCalledWith(
			{ employeeId: '1001', orgId: '42' },
			expect.objectContaining({
				conversationId: '44444444-4444-4444-8444-444444444444',
				clientRequestId: '55555555-5555-4555-8555-555555555555',
				prompt: expect.stringContaining('公共天气 MCP')
			})
		);
	});
});
