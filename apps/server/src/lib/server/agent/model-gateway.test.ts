import type { ApiLogger } from '@hotel-butler/api';
import { describe, expect, it } from 'vitest';
import { ModelInvocationTelemetry, modelPolicyForPurpose } from './model-gateway';

function recordingLogger(records: Array<Record<string, unknown>>): ApiLogger {
	const record = (fields: Record<string, unknown>) => records.push(fields);
	return { debug: record, info: record, warn: record, error: record };
}

describe('Agent model gateway policies', () => {
	it('keeps routine work on the bounded fast tier and grounded analysis on the analysis tier', () => {
		expect(modelPolicyForPurpose('workflow')).toEqual({
			tier: 'fast',
			maxTokens: 8_192,
			maxRetries: 1,
			timeoutMs: 60_000,
			streaming: true
		});
		expect(modelPolicyForPurpose('analysis')).toEqual({
			tier: 'analysis',
			maxRetries: 0,
			timeoutMs: 120_000,
			streaming: true
		});
		expect(modelPolicyForPurpose('routing').maxTokens).toBe(1_024);
		expect(modelPolicyForPurpose('conversation_title').maxTokens).toBe(40);
	});
});

describe('ModelInvocationTelemetry', () => {
	it('logs identifiers, policy and duration without prompt or result content', () => {
		const records: Array<Record<string, unknown>> = [];
		let now = 100;
		const telemetry = new ModelInvocationTelemetry(
			recordingLogger(records),
			{ purpose: 'routing', tier: 'fast', model: 'kimi-k2.6' },
			() => now
		);

		telemetry.start('model-run', 'agent-run');
		now = 137;
		telemetry.complete('model-run', 'agent-run');

		expect(records).toEqual([
			expect.objectContaining({
				event: 'agent.model_call_started',
				modelRunId: 'model-run',
				parentModelRunId: 'agent-run',
				purpose: 'routing',
				model: 'kimi-k2.6'
			}),
			expect.objectContaining({
				event: 'agent.model_call_completed',
				durationMs: 37
			})
		]);
		expect(JSON.stringify(records)).not.toMatch(/prompt|result|content/i);
	});

	it('records only a sanitized error type for failures', () => {
		const records: Array<Record<string, unknown>> = [];
		const telemetry = new ModelInvocationTelemetry(recordingLogger(records), {
			purpose: 'analysis',
			tier: 'analysis',
			model: 'kimi-k3'
		});

		telemetry.start('failed-run');
		telemetry.fail(new TypeError('sensitive model response'), 'failed-run');

		expect(records.at(-1)).toEqual(
			expect.objectContaining({
				event: 'agent.model_call_failed',
				errorType: 'TypeError'
			})
		);
		expect(JSON.stringify(records)).not.toContain('sensitive model response');
	});
});
