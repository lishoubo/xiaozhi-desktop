import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import {
	DmsHotelReferenceResolver,
	FallbackHotelReferenceResolver
} from './dms-hotel-reference-resolver';

function queryTool(result: unknown): DynamicStructuredTool {
	return new DynamicStructuredTool({
		name: 'query_hotel_operating_data_sql',
		description: 'query',
		schema: z.object({ database_id: z.string(), script: z.string() }),
		func: async () => result
	});
}

describe('DMS hotel reference fallback', () => {
	it('turns the bounded DMS hotel ID list into explicit clarification choices', async () => {
		const resolver = new DmsHotelReferenceResolver({
			getTools: vi.fn().mockResolvedValue([
				queryTool([
					{
						type: 'text',
						text: '| hotel_id |\n| --- |\n| 2 |\n| 4 |'
					}
				])
			])
		});

		await expect(resolver.resolve('未录入目录的酒店', '42')).resolves.toEqual([
			{ id: '2', label: '酒店 ID 2', match: 'fuzzy', accessScope: 'shared_dms_token' },
			{ id: '4', label: '酒店 ID 4', match: 'fuzzy', accessScope: 'shared_dms_token' }
		]);
	});

	it('uses DMS only when the organization hotel directory has no match', async () => {
		const primary = { resolve: vi.fn().mockResolvedValue([]) };
		const fallback = {
			resolve: vi
				.fn()
				.mockResolvedValue([
					{ id: '2', label: '酒店 ID 2', match: 'fuzzy', accessScope: 'shared_dms_token' }
				])
		};
		const resolver = new FallbackHotelReferenceResolver(primary, fallback);

		await expect(resolver.resolve('西湖店', '42')).resolves.toHaveLength(1);
		expect(primary.resolve).toHaveBeenCalledWith('西湖店', '42');
		expect(fallback.resolve).toHaveBeenCalledWith('西湖店', '42');
	});
});
