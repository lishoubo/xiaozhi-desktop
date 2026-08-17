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

describe('DMS hotel reference resolver', () => {
	it('resolves a hotel name from the bounded MCP name-to-ID directory', async () => {
		const resolver = new DmsHotelReferenceResolver({
			getTools: vi.fn().mockResolvedValue([
				queryTool([
					{
						type: 'text',
						text:
							'| hotel_id | ota_hotel_name |\n| --- | --- |\n| 4 | 包头璞禾咖啡酒店(禧瑞都店) |\n| 4 | 璞禾咖啡酒店禧瑞都店 |\n| 5 | 另一家酒店 |'
					}
				])
			])
		});

		await expect(resolver.resolve('包头璞禾咖啡酒店（禧瑞都店）', '42')).resolves.toEqual([
			{
				id: '4',
				label: '包头璞禾咖啡酒店(禧瑞都店)',
				match: 'exact',
				accessScope: 'shared_dms_token'
			}
		]);
	});

	it('does not offer unrelated bare hotel IDs when the MCP name directory has no match', async () => {
		const resolver = new DmsHotelReferenceResolver({
			getTools: vi.fn().mockResolvedValue([
				queryTool('| hotel_id | ota_hotel_name |\n| --- | --- |\n| 4 | 另一家酒店 |')
			])
		});

		await expect(resolver.resolve('西湖店', '42')).resolves.toEqual([]);
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
