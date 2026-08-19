import { tool } from '@langchain/core/tools';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
	DeterministicWorkflowCollector,
	type WorkflowCollectionRequest
} from './deterministic-workflow-collector';
import { AgentProtocolError, AgentUpstreamError } from '../agent-effect';

const principal = { employeeId: '1001', orgId: '42' } as const;

function request(
	intent: WorkflowCollectionRequest['request']['intent'],
	slots: WorkflowCollectionRequest['request']['slots']
): WorkflowCollectionRequest {
	return {
		principal,
		request: { routeKind: 'business_read', intent, slots },
		signal: new AbortController().signal,
		emit: vi.fn().mockResolvedValue(undefined)
	};
}

describe('deterministic workflow collector', () => {
	it('does not load tools for a business route that declares no MCP dependency', async () => {
		const invoke = vi.fn(async () => '# Weather Summary');
		const weather = tool(invoke, {
			name: 'get_weather_summary',
			description: 'weather',
			schema: z.object({
				city_name: z.string(),
				include: z.array(z.string()).optional(),
				days: z.number().optional(),
				detail: z.string().optional()
			})
		});
		const getTools = vi.fn().mockResolvedValue([weather]);
		const collector = new DeterministicWorkflowCollector({ getTools });

		const result = await collector.collect(
			request('weather_operations_advice', { location: '上海', date: 'today' })
		);

		expect(result).toEqual({ status: 'fallback', reason: 'tool_unavailable' });
		expect(getTools).not.toHaveBeenCalled();
		expect(invoke).not.toHaveBeenCalled();
	});

	it('falls back before invoking an incompatible public-rate tool', async () => {
		const invoke = vi.fn(async () => ({ rates: [] }));
		const rates = tool(invoke, {
			name: 'search_public_rates',
			description: 'rates',
			schema: z.object({ opaqueVendorQuery: z.string() })
		});
		const collector = new DeterministicWorkflowCollector({
			getTools: vi.fn().mockResolvedValue([rates])
		});

		const result = await collector.collect(
			request('public_hotel_rates', {
				hotelReference: 'hotel-1',
				checkIn: '2026-08-14',
				checkOut: '2026-08-15',
				guests: 2,
				currency: 'CNY'
			})
		);

		expect(result).toEqual({ status: 'fallback', reason: 'incompatible_tool_schema' });
		expect(invoke).not.toHaveBeenCalled();
	});

	it('maps a compatible public-rate schema without model assistance', async () => {
		const rateInvoke = vi.fn(async () => ({ rates: [688] }));
		const rates = tool(rateInvoke, {
			name: 'search_public_rates',
			description: 'rates',
			schema: z.object({
				hotel_id: z.string(),
				check_in: z.string(),
				check_out: z.string(),
				adults: z.number(),
				currency: z.string()
			})
		});
		const collector = new DeterministicWorkflowCollector({
			getTools: vi.fn().mockResolvedValue([rates])
		});

		await collector.collect(
			request('public_hotel_rates', {
				hotelReference: 'hotel-1',
				checkIn: '2026-08-14',
				checkOut: '2026-08-15',
				guests: 2,
				currency: 'CNY'
			})
		);

		expect(rateInvoke).toHaveBeenCalledWith(
			{
				hotel_id: 'hotel-1',
				check_in: '2026-08-14',
				check_out: '2026-08-15',
				adults: 2,
				currency: 'CNY'
			},
			expect.anything()
		);
	});

	it('uses a code-owned aggregate query for the generic DMS endpoint', async () => {
		const sqlInvoke = vi.fn(async () => ({ hotel_id: 1, gmv: 888 }));
		const sql = tool(sqlInvoke, {
			name: 'query_hotel_operating_data_sql',
			description: 'read-only SQL',
			schema: z.object({ database_id: z.string(), script: z.string() })
		});
		const collector = new DeterministicWorkflowCollector({
			getTools: vi.fn().mockResolvedValue([sql])
		});

		const result = await collector.collect(
			request('hotel_operating_summary', {
				hotelReference: '1',
				dateRange: { start: '2026-07-01', end: '2026-07-31' }
			})
		);

		expect(result).toMatchObject({
			status: 'collected',
			toolEvidence: [{ toolName: 'query_hotel_operating_data_sql' }]
		});
		expect(sqlInvoke).toHaveBeenCalledWith(
			expect.objectContaining({
				script: expect.stringMatching(/hotel_id = 1.*2026-07-01.*2026-07-31/)
			}),
			expect.anything()
		);
	});

	it('uses a code-owned daily query for the seven-day trend shortcut', async () => {
		const invoke = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: '[]' }] });
		const emit = vi.fn().mockResolvedValue(undefined);
		const collector = new DeterministicWorkflowCollector({
			getTools: vi.fn().mockResolvedValue([
				{
					name: 'query_hotel_operating_data_sql',
					schema: {
						safeParse: () => ({ success: true })
					},
					invoke
				}
			])
		});

		await collector.collect({
			principal: { employeeId: '1001', orgId: '42' },
			request: {
				routeKind: 'business_read',
				intent: 'hotel_operating_summary',
				slots: {
					hotelReference: '123',
					dateRange: { start: '2026-08-06', end: '2026-08-12' },
					metrics: '按日经营趋势'
				}
			},
			signal: new AbortController().signal,
			emit
		});

		expect(invoke).toHaveBeenCalledWith(
			expect.objectContaining({
				script: expect.stringMatching(/GROUP BY hotel_id, data_date ORDER BY data_date ASC/)
			}),
			expect.any(Object)
		);
		expect(emit).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'mcp_call_completed',
				toolName: 'query_hotel_operating_data_sql',
				resultSummary: expect.objectContaining({ protocolStatus: 'success' })
			})
		);
	});

	it('fails closed instead of entering Agent schema discovery when operating SQL is unavailable', async () => {
		const collector = new DeterministicWorkflowCollector({
			getTools: vi.fn().mockResolvedValue([])
		});

		await expect(
			collector.collect(
				request('hotel_operating_summary', {
					hotelReference: '1',
					dateRange: { start: '2026-08-12', end: '2026-08-12' }
				})
			)
		).rejects.toMatchObject({
			_tag: 'AgentProtocolError',
			operation: 'select_hotel_operating_tool'
		} satisfies Partial<AgentProtocolError>);
	});

	it('leaves generic and multi-hotel discovery to the constrained Agent', async () => {
		const collector = new DeterministicWorkflowCollector({
			getTools: vi.fn().mockResolvedValue([])
		});

		await expect(
			collector.collect(request('generic_hotel_data_query', { hotelReference: 'hotel-1' }))
		).resolves.toEqual({ status: 'fallback', reason: 'agent_required' });
		await expect(
			collector.collect(
				request('hotel_operating_summary', {
					hotelReference: ['9', '10'],
					dateRange: { start: '2026-08-01', end: '2026-08-17' }
				})
			)
		).resolves.toEqual({ status: 'fallback', reason: 'agent_required' });
	});

	it('emits a safe MCP failure event when deterministic invocation fails', async () => {
		const emit = vi.fn().mockResolvedValue(undefined);
		const collector = new DeterministicWorkflowCollector({
			getTools: vi.fn().mockResolvedValue([
				{
					name: 'query_hotel_operating_data_sql',
					schema: { safeParse: () => ({ success: true }) },
					invoke: vi.fn().mockRejectedValue(new Error('SQL and private payload must not be logged'))
				}
			])
		});

		await expect(
			collector.collect({
				principal: { employeeId: '1001', orgId: '42' },
				request: {
					routeKind: 'business_read',
					intent: 'hotel_operating_summary',
					slots: {
						hotelReference: '123',
						dateRange: { start: '2026-08-08', end: '2026-08-14' },
						metrics: '按日经营趋势'
					}
				},
				signal: new AbortController().signal,
				emit
			})
		).rejects.toMatchObject({ _tag: 'AgentUpstreamError', service: 'mcp' });
		expect(emit).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'mcp_call_failed',
				toolName: 'query_hotel_operating_data_sql',
				errorType: 'AgentUpstreamError',
				causeType: 'Error'
			})
		);
		expect(JSON.stringify(emit.mock.calls)).not.toContain('private payload');
	});

	it('does not accept an MCP error result as business evidence', async () => {
		const rates = tool(async () => ({ isError: true, content: 'upstream failed' }), {
			name: 'search_public_rates',
			description: 'rates',
			schema: z.object({
				hotel_id: z.string(),
				check_in: z.string(),
				check_out: z.string(),
				adults: z.number(),
				currency: z.string()
			})
		});
		const collector = new DeterministicWorkflowCollector({
			getTools: vi.fn().mockResolvedValue([rates])
		});

		await expect(
			collector.collect(
				request('public_hotel_rates', {
					hotelReference: 'hotel-1',
					checkIn: '2026-08-14',
					checkOut: '2026-08-15',
					guests: 2,
					currency: 'CNY'
				})
			)
		).rejects.toMatchObject({
			_tag: 'AgentUpstreamError',
			service: 'mcp',
			operation: 'search_public_rates',
			kind: 'invalid_response'
		} satisfies Partial<AgentUpstreamError>);
	});
});
