import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { assessEvidence, normalizeEvidence } from './evidence';

const DAY_MS = 86_400_000;

function isoDay(offset: number): string {
	return new Date(Date.UTC(2026, 0, 1) + offset * DAY_MS).toISOString().slice(0, 10);
}

const boundedDateSelection = fc
	.record({
		startOffset: fc.integer({ min: 0, max: 300 }),
		dayCount: fc.integer({ min: 3, max: 30 })
	})
	.chain(({ startOffset, dayCount }) =>
		fc
			.subarray(
				Array.from({ length: dayCount }, (_, index) => index),
				{
					minLength: 1,
					maxLength: dayCount
				}
			)
			.map((selectedOffsets) => ({ startOffset, dayCount, selectedOffsets }))
	);

function dailyTrendRequest(startOffset: number, dayCount: number) {
	return {
		routeKind: 'business_read' as const,
		intent: 'generic_hotel_data_query' as const,
		responseMode: 'analysis' as const,
		slots: {
			hotelReference: 'hotel-1',
			dateRange: {
				start: isoDay(startOffset),
				end: isoDay(startOffset + dayCount - 1),
				timezone: 'Asia/Shanghai',
				original: 'generated-range'
			},
			metrics: '@metrics:daily-trend'
		}
	};
}

describe('business evidence properties', () => {
	it('never rejects an in-range non-empty date subset and always discloses missing days', () => {
		fc.assert(
			fc.property(boundedDateSelection, ({ startOffset, dayCount, selectedOffsets }) => {
				const request = dailyTrendRequest(startOffset, dayCount);
				const evidence = normalizeEvidence({
					request,
					toolName: 'query_hotel_operating_data_sql',
					toolArgs: { script: 'SELECT hotel_id, data_date, gmv FROM fact_business_daily' },
					result: selectedOffsets.map((offset) => ({
						hotel_id: 'hotel-1',
						data_date: isoDay(startOffset + offset),
						gmv: 100 + offset
					})),
					verifiedHotelScope: ['hotel-1']
				});
				const assessment = assessEvidence(request, [evidence], false);

				expect(assessment.status).toBe('sufficient');
				if (assessment.status !== 'sufficient') return;
				const missingDayDisclosure = assessment.limitations.some((limitation) =>
					limitation.includes(`当前仅返回 ${selectedOffsets.length} 个可验证日期`)
				);
				expect(missingDayDisclosure).toBe(selectedOffsets.length < dayCount);
			})
		);
	});

	it('always rejects evidence containing a business date outside the requested range', () => {
		fc.assert(
			fc.property(
				fc.record({
					startOffset: fc.integer({ min: 1, max: 300 }),
					dayCount: fc.integer({ min: 1, max: 30 }),
					outsideAtEnd: fc.boolean()
				}),
				({ startOffset, dayCount, outsideAtEnd }) => {
					const request = dailyTrendRequest(startOffset, dayCount);
					const outsideDate = outsideAtEnd
						? isoDay(startOffset + dayCount)
						: isoDay(startOffset - 1);
					const evidence = normalizeEvidence({
						request,
						toolName: 'query_hotel_operating_data_sql',
						toolArgs: { script: 'SELECT hotel_id, data_date, gmv FROM fact_business_daily' },
						result: [{ hotel_id: 'hotel-1', data_date: outsideDate, gmv: 100 }],
						verifiedHotelScope: ['hotel-1']
					});

					expect(assessEvidence(request, [evidence], false)).toEqual({
						status: 'rejected',
						reasonCode: 'evidence_scope_mismatch'
					});
				}
			)
		);
	});

	it('accepts partial aggregate rows inside enforced hotel scope and rejects any explicit outsider', () => {
		fc.assert(
			fc.property(
				fc.uniqueArray(fc.integer({ min: 1, max: 20 }), { minLength: 1, maxLength: 5 }),
				fc.boolean(),
				(allowedIds, includeOutsider) => {
					const allowedHotels = allowedIds.map(String);
					const outsider = String(Math.max(...allowedIds) + 100);
					const request = {
						routeKind: 'business_read' as const,
						intent: 'generic_hotel_data_query' as const,
						responseMode: 'data_only' as const,
						slots: { hotelReference: allowedHotels, metrics: '流量' }
					};
					const result = [
						{ hotel_id: allowedHotels[0], latest_data_date: '2026-08-20', exposure_cnt: 10 },
						{ latest_data_date: '2026-08-20', exposure_cnt: 20 },
						...(includeOutsider
							? [{ hotel_id: outsider, latest_data_date: '2026-08-20', exposure_cnt: 30 }]
							: [])
					];
					const evidence = normalizeEvidence({
						request,
						toolName: 'query_hotel_operating_data_sql',
						toolArgs: { script: 'SELECT hotel_id, MAX(data_date), SUM(exposure_cnt)' },
						result,
						verifiedHotelScope: allowedHotels
					});
					const assessment = assessEvidence(request, [evidence], false);

					if (includeOutsider) {
						expect(assessment).toEqual({
							status: 'rejected',
							reasonCode: 'evidence_scope_mismatch'
						});
					} else {
						expect(assessment.status).toBe('sufficient');
					}
				}
			)
		);
	});
});
