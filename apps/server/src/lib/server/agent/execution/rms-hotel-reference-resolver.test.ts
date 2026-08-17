import { describe, expect, it, vi } from 'vitest';
import { RmsHotelReferenceResolver } from './rms-hotel-reference-resolver';

describe('RMS hotel reference resolver', () => {
	it('resolves an active hotel inside the authenticated organization', async () => {
		const execute = vi.fn().mockResolvedValue([
			[
				{
					id: '81918192',
					name: '包头璞禾咖啡酒店（禧瑞都店）',
					short_name: '璞禾禧瑞都店'
				}
			],
			[]
		]);
		const resolver = new RmsHotelReferenceResolver({ execute });

		await expect(resolver.resolve('包头璞禾咖啡酒店（禧瑞都店）', '42')).resolves.toEqual([
			{
				id: '81918192',
				label: '包头璞禾咖啡酒店（禧瑞都店）',
				match: 'exact',
				accessScope: 'shared_dms_token'
			}
		]);
		expect(execute).toHaveBeenCalledWith(expect.stringContaining('WHERE org_id = ?'), [
			'42',
			'包头璞禾咖啡酒店（禧瑞都店）',
			'包头璞禾咖啡酒店（禧瑞都店）',
			'包头璞禾咖啡酒店（禧瑞都店）',
			'包头璞禾咖啡酒店（禧瑞都店）',
			'包头璞禾咖啡酒店（禧瑞都店）',
			'包头璞禾咖啡酒店（禧瑞都店）'
		]);
	});

	it('does not query without a numeric organization ID', async () => {
		const execute = vi.fn();
		const resolver = new RmsHotelReferenceResolver({ execute });

		await expect(resolver.resolve('西湖店', 'other-org')).resolves.toEqual([]);
		expect(execute).not.toHaveBeenCalled();
	});
});
