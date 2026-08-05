import { describe, expect, it } from 'vitest';
import { recentRegistrationStart } from './dashboard';

describe('dashboard reporting window', () => {
	it('starts seven complete days before the report time', () => {
		expect(recentRegistrationStart(new Date('2026-08-05T12:00:00.000Z'))).toEqual(
			new Date('2026-07-29T12:00:00.000Z')
		);
	});
});
