import { describe, expect, it } from 'vitest';
import type { AgentEnvironment } from './agent-config';
import { modelForTier, modelKwargsForTier } from './model-tier';

const environment = {
	apiKey: 'secret',
	baseUrl: 'https://api.moonshot.cn/v1',
	model: 'kimi-k3',
	fastModel: 'kimi-k2.6',
	dmsDatabaseId: null,
	dmsDatabaseName: null,
	mcpServers: {}
} satisfies AgentEnvironment;

describe('Agent model tiers', () => {
	it('routes routine phases to non-thinking K2.6 and analysis to low-effort K3', () => {
		expect(modelForTier(environment, 'fast')).toBe('kimi-k2.6');
		expect(modelKwargsForTier('kimi-k2.6', 'fast')).toEqual({
			thinking: { type: 'disabled' }
		});
		expect(modelForTier(environment, 'analysis')).toBe('kimi-k3');
		expect(modelKwargsForTier('kimi-k3', 'analysis')).toEqual({ reasoning_effort: 'low' });
	});

	it('does not send Kimi-only request fields to custom model IDs', () => {
		expect(modelKwargsForTier('custom-fast-model', 'fast')).toEqual({});
		expect(modelKwargsForTier('custom-analysis-model', 'analysis')).toEqual({});
	});
});
