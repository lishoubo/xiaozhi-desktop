import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseReviewedJson, routeStructuredOutputConfig } from './langchain-route-classifier';

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
});
