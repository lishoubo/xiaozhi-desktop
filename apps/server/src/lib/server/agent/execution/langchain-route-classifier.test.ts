import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
	normalizedTemporalReviewSlots,
	parseReviewedJson,
	routeStructuredOutputConfig,
	temporalReviewNeedsConfirmation
} from './langchain-route-classifier';

describe('LangChain route classifier configuration', () => {
	it('uses Kimi-compatible function calling instead of inferred OpenAI JSON Schema mode', () => {
		expect(routeStructuredOutputConfig).toEqual({
			name: 'route_hotel_request',
			method: 'functionCalling',
			strict: true,
			includeRaw: true
		});
	});

	it('parses reviewed JSON without requiring a forced tool call', () => {
		const schema = z.strictObject({ dateRange: z.string(), analysis: z.boolean() });

		expect(
			parseReviewedJson(
				'```json\n{"dateRange":"2026-08-14/2026-08-20","analysis":true}\n```',
				schema
			)
		).toEqual({ dateRange: '2026-08-14/2026-08-20', analysis: true });
	});

	it('rejects a review response without a JSON object', () => {
		expect(() => parseReviewedJson('没有时间范围。', z.object({ date: z.string() }))).toThrow(
			'JSON object'
		);
	});

	it('finds the schema-valid object among unrelated brace blocks', () => {
		const schema = z.strictObject({ dateRange: z.string(), analysis: z.boolean() });

		expect(
			parseReviewedJson(
				'思考片段 {not-json} 后给出 {"dateRange":"2026-08-14/2026-08-20","analysis":true}，末尾还有 {"note":"ignored"}',
				schema
			)
		).toEqual({ dateRange: '2026-08-14/2026-08-20', analysis: true });
	});

	it('does not mistake braces inside JSON strings for object boundaries', () => {
		const schema = z.strictObject({ metrics: z.string() });

		expect(parseReviewedJson('{"metrics":"曝光 { 到支付 }"}', schema)).toEqual({
			metrics: '曝光 { 到支付 }'
		});
	});

	it('accepts only normalized temporal protocol values from the review model', () => {
		expect(
			normalizedTemporalReviewSlots({
				date: null,
				dateRange: '2026-08-15/2026-08-21',
				checkIn: '下周五',
				checkOut: '2026-08-29',
				relativeCompleteDays: null
			})
		).toEqual({ dateRange: '2026-08-15/2026-08-21', checkOut: '2026-08-29' });
		expect(
			normalizedTemporalReviewSlots({
				date: null,
				dateRange: '@date:complete-days:7',
				checkIn: null,
				checkOut: null,
				relativeCompleteDays: null
			})
		).toEqual({});
	});

	it('normalizes a single business date to the date-range contract unless the intent uses date', () => {
		const temporal = {
			date: '2026-08-22',
			dateRange: null,
			checkIn: null,
			checkOut: null,
			relativeCompleteDays: null
		};
		expect(normalizedTemporalReviewSlots(temporal)).toEqual({
			dateRange: '2026-08-22/2026-08-22'
		});
		expect(normalizedTemporalReviewSlots(temporal, { singleDateSlot: 'date' })).toEqual({
			date: '2026-08-22'
		});
	});

	it('turns a model-understood relative window into a deterministic date protocol', () => {
		expect(
			normalizedTemporalReviewSlots({
				date: null,
				dateRange: null,
				checkIn: null,
				checkOut: null,
				relativeCompleteDays: 7
			})
		).toEqual({ dateRange: '@date:complete-days:7' });
		expect(
			normalizedTemporalReviewSlots({
				date: null,
				dateRange: '2026-08-15/2026-08-21',
				checkIn: null,
				checkOut: null,
				relativeCompleteDays: 7
			})
		).toEqual({ dateRange: '2026-08-15/2026-08-21' });
	});

	it('confirms negative or unusable temporal reviews before discarding classified dates', () => {
		expect(
			temporalReviewNeedsConfirmation(
				{
					hasTimeConstraint: false,
					date: null,
					dateRange: null,
					checkIn: null,
					checkOut: null,
					relativeCompleteDays: null
				},
				{ dateRange: '2026-08-21/2026-08-21' }
			)
		).toBe(true);
		expect(
			temporalReviewNeedsConfirmation(
				{
					hasTimeConstraint: false,
					date: null,
					dateRange: null,
					checkIn: null,
					checkOut: null,
					relativeCompleteDays: null
				},
				{}
			)
		).toBe(false);
		expect(
			temporalReviewNeedsConfirmation(
				{
					hasTimeConstraint: true,
					date: null,
					dateRange: '近日',
					checkIn: null,
					checkOut: null,
					relativeCompleteDays: null
				},
				{}
			)
		).toBe(true);
		expect(
			temporalReviewNeedsConfirmation(
				{
					hasTimeConstraint: true,
					date: null,
					dateRange: null,
					checkIn: null,
					checkOut: null,
					relativeCompleteDays: 7
				},
				{}
			)
		).toBe(false);
	});
});
