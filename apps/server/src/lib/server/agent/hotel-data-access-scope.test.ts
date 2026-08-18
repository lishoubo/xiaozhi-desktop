import { describe, expect, it } from 'vitest';
import {
	currentHotelDataAccessScope,
	runWithHotelDataAccessScope
} from './hotel-data-access-scope';

describe('hotel data access scope', () => {
	it('keeps concurrent run scopes isolated', async () => {
		const observed = await Promise.all([
			runWithHotelDataAccessScope(['9'], async () => {
				await Promise.resolve();
				return currentHotelDataAccessScope()?.hotelIds;
			}),
			runWithHotelDataAccessScope(['10'], async () => {
				await Promise.resolve();
				return currentHotelDataAccessScope()?.hotelIds;
			})
		]);

		expect(observed).toEqual([['9'], ['10']]);
		expect(currentHotelDataAccessScope()).toBeUndefined();
	});
});
