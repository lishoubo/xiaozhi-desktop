import { AsyncLocalStorage } from 'node:async_hooks';

type HotelDataAccessScope = Readonly<{ hotelIds: readonly string[] }>;

const storage = new AsyncLocalStorage<HotelDataAccessScope>();

export function runWithHotelDataAccessScope<T>(
	hotelIds: readonly string[] | undefined,
	operation: () => Promise<T>
): Promise<T> {
	if (!hotelIds) return operation();
	return storage.run({ hotelIds: [...new Set(hotelIds)] }, operation);
}

export function currentHotelDataAccessScope(): HotelDataAccessScope | undefined {
	return storage.getStore();
}
