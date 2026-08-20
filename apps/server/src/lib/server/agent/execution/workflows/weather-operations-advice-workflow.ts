import type { BusinessWorkflowHandler } from '../business-workflow';
import { assessDefaultWorkflowEvidence } from './default-evidence-policy';

export const weatherOperationsAdviceWorkflow: BusinessWorkflowHandler = {
	id: 'weather_operations_advice.v1',
	intent: 'weather_operations_advice',
	requiresToolCatalog: () => false,
	planCollection: () => ({ kind: 'agent', reason: 'tool_unavailable' }),
	assessEvidence: assessDefaultWorkflowEvidence,
	present: () => null
};
