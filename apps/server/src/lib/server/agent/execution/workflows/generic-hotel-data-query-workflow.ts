import type { BusinessWorkflowHandler } from '../business-workflow';
import { buildDeterministicDataQueryAnswer } from '../deterministic-data-query-answer';
import { assessDefaultWorkflowEvidence } from './default-evidence-policy';

export const genericHotelDataQueryWorkflow: BusinessWorkflowHandler = {
	id: 'generic_hotel_data_query.v1',
	intent: 'generic_hotel_data_query',
	requiresToolCatalog: () => false,
	planCollection: () => ({ kind: 'agent', reason: 'agent_required' }),
	assessEvidence: assessDefaultWorkflowEvidence,
	present: buildDeterministicDataQueryAnswer
};
