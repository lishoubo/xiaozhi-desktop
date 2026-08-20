import type { BusinessWorkflowHandler } from '../business-workflow';
import { assessDefaultWorkflowEvidence } from './default-evidence-policy';
import { publicRateArgs } from './workflow-tool-schema';

export const publicHotelRatesWorkflow: BusinessWorkflowHandler = {
	id: 'public_hotel_rates.v1',
	intent: 'public_hotel_rates',
	requiresToolCatalog: () => true,
	planCollection: (request, tools) => {
		for (const tool of tools.filter((candidate) =>
			/rate|price|availability|room/i.test(candidate.name)
		)) {
			const args = publicRateArgs(tool, request);
			if (args) return { kind: 'direct', tool, args };
		}
		return {
			kind: 'agent',
			reason: tools.length === 0 ? 'tool_unavailable' : 'incompatible_tool_schema'
		};
	},
	assessEvidence: assessDefaultWorkflowEvidence,
	present: () => null
};
