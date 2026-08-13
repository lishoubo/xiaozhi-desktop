import { tool } from '@langchain/core/tools';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
	DeterministicWorkflowCollector,
	type WorkflowCollectionRequest
} from './deterministic-workflow-collector';

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
	it('calls the pinned weather summary directly with code-owned arguments', async () => {
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
		const collector = new DeterministicWorkflowCollector({
			getTools: vi.fn().mockResolvedValue([weather])
		});

		const result = await collector.collect(
			request('weather_operations_advice', { location: '上海', date: 'today' })
		);

		expect(result).toMatchObject({
			status: 'collected',
			toolEvidence: [{ toolName: 'get_weather_summary', result: '# Weather Summary' }]
		});
		expect(invoke).toHaveBeenCalledWith(
			expect.objectContaining({ city_name: '上海', days: 1, detail: 'summary' }),
			expect.anything()
		);
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

	it('maps compatible operating-summary and public-rate schemas without model assistance', async () => {
		const operatingInvoke = vi.fn(async () => ({ revenue: 1000 }));
		const rateInvoke = vi.fn(async () => ({ rates: [688] }));
		const operating = tool(operatingInvoke, {
			name: 'query_hotel_operating_data',
			description: 'operating',
			schema: z.object({ question: z.string() })
		});
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
			getTools: vi.fn().mockResolvedValue([operating, rates])
		});

		await collector.collect(
			request('hotel_operating_summary', {
				hotelReference: 'hotel-1',
				dateRange: { start: '2026-08-01', end: '2026-08-13' }
			})
		);
		await collector.collect(
			request('public_hotel_rates', {
				hotelReference: 'hotel-1',
				checkIn: '2026-08-14',
				checkOut: '2026-08-15',
				guests: 2,
				currency: 'CNY'
			})
		);

		expect(operatingInvoke).toHaveBeenCalledWith(
			expect.objectContaining({ question: expect.stringContaining('hotel-1') }),
			expect.anything()
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

	it('leaves generic discovery to the constrained Agent and propagates invoked-tool failures', async () => {
		const failing = tool(
			async () => {
				throw new Error('weather unavailable');
			},
			{
				name: 'get_weather_summary',
				description: 'weather',
				schema: z.object({ city_name: z.string() })
			}
		);
		const collector = new DeterministicWorkflowCollector({
			getTools: vi.fn().mockResolvedValue([failing])
		});

		await expect(
			collector.collect(request('generic_hotel_data_query', { hotelReference: 'hotel-1' }))
		).resolves.toEqual({ status: 'fallback', reason: 'agent_required' });
		await expect(
			collector.collect(request('weather_operations_advice', { location: '上海', date: 'today' }))
		).rejects.toThrow('weather unavailable');
	});

	it('does not accept an MCP error result as business evidence', async () => {
		const weather = tool(async () => ({ isError: true, content: 'upstream failed' }), {
			name: 'get_weather_summary',
			description: 'weather',
			schema: z.object({ city_name: z.string() })
		});
		const collector = new DeterministicWorkflowCollector({
			getTools: vi.fn().mockResolvedValue([weather])
		});

		await expect(
			collector.collect(request('weather_operations_advice', { location: '上海', date: 'today' }))
		).rejects.toThrow('get_weather_summary MCP tool returned an error');
	});
});
