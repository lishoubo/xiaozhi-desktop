import type { AgentBusinessIntent } from '@hotel-butler/api';
import { describe, expect, it, vi } from 'vitest';
import type { BusinessWorkflowHandler } from './business-workflow';
import { BusinessWorkflowRegistry } from './business-workflow-registry';
import type { EvidenceAssessment } from './business-execution-state';
import { listIntentDefinitions } from './intent-registry';

const sufficientAssessment: EvidenceAssessment = { status: 'sufficient', limitations: [] };

function handler(intent: AgentBusinessIntent, id: string): BusinessWorkflowHandler {
	return {
		id,
		intent,
		requiresToolCatalog: () => false,
		planCollection: () => ({ kind: 'agent', reason: 'agent_required' }),
		assessEvidence: vi.fn(() => sufficientAssessment),
		present: vi.fn(() => null)
	};
}

function currentHandlers(): BusinessWorkflowHandler[] {
	return listIntentDefinitions().map((definition) =>
		handler(definition.intent, definition.workflowId)
	);
}

describe('BusinessWorkflowRegistry', () => {
	it('resolves an intent through its declared workflow id', () => {
		const handlers = currentHandlers();
		const registry = new BusinessWorkflowRegistry(handlers);

		expect(registry.resolve('hotel_operating_summary')).toBe(
			handlers.find((candidate) => candidate.id === 'hotel_operating_summary.v1')
		);
	});

	it('rejects missing, duplicate, mismatched and unreferenced handlers', () => {
		const handlers = currentHandlers();
		expect(() => new BusinessWorkflowRegistry(handlers.slice(1))).toThrow(
			'Missing business workflow handler'
		);
		expect(() => new BusinessWorkflowRegistry([...handlers, handlers[0]])).toThrow(
			'Duplicate business workflow handler'
		);
		expect(
			() =>
				new BusinessWorkflowRegistry([
					...handlers.slice(0, 1),
					handler('public_hotel_rates', 'hotel_operating_summary.v1'),
					...handlers.slice(2)
				])
		).toThrow();
		expect(
			() =>
				new BusinessWorkflowRegistry([
					...handlers,
					handler('generic_hotel_data_query', 'unreferenced.v1')
				])
		).toThrow('Unreferenced business workflow handler');
	});
});
