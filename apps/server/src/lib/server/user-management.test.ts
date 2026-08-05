import { describe, expect, it } from 'vitest';
import { parseManagedUserQuery } from './user-management';

describe('managed user query', () => {
	it('normalizes page and search values', () => {
		expect(parseManagedUserQuery(new URLSearchParams('page=2&q=%20Alice%20'))).toEqual({
			page: 2,
			search: 'Alice'
		});
		expect(parseManagedUserQuery(new URLSearchParams('page=-1'))).toEqual({
			page: 1,
			search: ''
		});
	});
});
