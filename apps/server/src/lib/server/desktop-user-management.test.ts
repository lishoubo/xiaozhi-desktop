import { describe, expect, it } from 'vitest';
import { parseDesktopUserQuery } from './desktop-user-management';

describe('desktop user query', () => {
	it('normalizes page, search, and status values', () => {
		expect(
			parseDesktopUserQuery(new URLSearchParams('page=2&q=%2013800%20&status=disabled'))
		).toEqual({
			page: 2,
			search: '13800',
			status: 'disabled'
		});
		expect(parseDesktopUserQuery(new URLSearchParams('page=-1&status=unknown'))).toEqual({
			page: 1,
			search: '',
			status: 'all'
		});
	});
});
