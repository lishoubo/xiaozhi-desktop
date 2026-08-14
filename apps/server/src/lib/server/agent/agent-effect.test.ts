import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import {
	agentErrorType,
	agentErrorRetryable,
	agentFailureKind,
	agentPromise,
	AgentConfigurationError,
	AgentProtocolError,
	AgentUpstreamError,
	runAgentEffect
} from './agent-effect';

describe('Agent Effect boundary', () => {
	it('preserves typed upstream failures and retry policy', async () => {
		const failure = await runAgentEffect(
			Effect.flip(
				agentPromise({
					service: 'mcp',
					operation: 'query_hotel_data',
					timeoutMs: 1_000,
					try: async () => Promise.reject(new Error('private transport detail'))
				})
			)
		);

		expect(failure).toBeInstanceOf(AgentUpstreamError);
		expect(agentFailureKind(failure)).toBe('tool_or_data_source');
		expect(agentErrorRetryable(failure)).toBe(true);
	});

	it('does not hide the inner operation when Effect boundaries are nested', async () => {
		const inner = new AgentUpstreamError({
			service: 'mcp',
			operation: 'discover_dms_database',
			kind: 'timeout'
		});
		const failure = await runAgentEffect(
			Effect.flip(
				agentPromise({
					service: 'mcp',
					operation: 'load_tool_catalog',
					timeoutMs: 1_000,
					try: async () => Promise.reject(inner)
				})
			)
		);

		expect(failure).toBe(inner);
		expect(failure.operation).toBe('discover_dms_database');
	});

	it('distinguishes configuration and protocol errors from retryable failures', () => {
		const configuration = new AgentConfigurationError({ setting: 'AI_KIMI_API_KEY' });
		const protocol = new AgentProtocolError({ operation: 'evidence', reason: 'scope mismatch' });

		expect(agentErrorRetryable(configuration)).toBe(false);
		expect(agentErrorRetryable(protocol)).toBe(false);
		expect(agentFailureKind(configuration)).toBe('model_not_configured');
		expect(agentFailureKind(protocol)).toBe('protocol_failure');
		expect(agentErrorType(configuration)).toBe('AgentConfigurationError');
	});

	it('interrupts an unresponsive boundary with a typed timeout', async () => {
		const failure = await runAgentEffect(
			Effect.flip(
				agentPromise({
					service: 'model',
					operation: 'slow_model',
					timeoutMs: 1,
					try: () => new Promise(() => undefined)
				})
			)
		);

		expect(failure).toMatchObject({
			_tag: 'AgentUpstreamError',
			service: 'model',
			operation: 'slow_model',
			kind: 'timeout'
		});
	});
});
