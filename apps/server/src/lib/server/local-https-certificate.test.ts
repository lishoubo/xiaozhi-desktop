import { describe, expect, it } from 'vitest';
import { certificateNeedsRenewal } from '../../../scripts/setup-local-https.ts';

describe('certificateNeedsRenewal', () => {
	it('keeps a certificate with more than 30 days remaining', () => {
		expect(
			certificateNeedsRenewal('2026-10-01T00:00:00.000Z', new Date('2026-08-05T00:00:00.000Z'))
		).toBe(false);
	});

	it('renews a certificate within the 30-day renewal window', () => {
		expect(
			certificateNeedsRenewal('2026-08-20T00:00:00.000Z', new Date('2026-08-05T00:00:00.000Z'))
		).toBe(true);
	});
});
