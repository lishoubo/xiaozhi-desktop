import type { AgentEnvironment } from './agent-config';

export type AgentModelTier = 'fast' | 'analysis';

export function modelForTier(environment: AgentEnvironment, tier: AgentModelTier): string {
	return tier === 'fast' ? environment.fastModel : environment.model;
}

export function modelKwargsForTier(model: string, tier: AgentModelTier): Record<string, unknown> {
	const normalized = model.trim().toLowerCase();
	if (tier === 'fast' && (normalized === 'kimi-k2.5' || normalized === 'kimi-k2.6')) {
		return { thinking: { type: 'disabled' } };
	}
	if (normalized === 'kimi-k3') return { reasoning_effort: 'low' };
	return {};
}
