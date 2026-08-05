import { describe, expect, it } from 'vitest';
import { missingLocalDatabaseServices } from '../../../scripts/ensure-local-databases';

describe('local database startup', () => {
	it('only starts database services that are not already running', () => {
		expect(missingLocalDatabaseServices('db\nrms\n')).toEqual([]);
		expect(missingLocalDatabaseServices('db\n')).toEqual(['rms']);
		expect(missingLocalDatabaseServices('')).toEqual(['db', 'rms']);
	});
});
