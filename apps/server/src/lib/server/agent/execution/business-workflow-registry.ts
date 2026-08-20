import type { AgentBusinessIntent } from '@hotel-butler/api';
import { AgentProtocolError } from '../agent-effect';
import type { BusinessWorkflowHandler } from './business-workflow';
import { getIntentDefinition, listIntentDefinitions } from './intent-registry';

export class BusinessWorkflowRegistry {
	private readonly handlersById = new Map<string, BusinessWorkflowHandler>();

	constructor(handlers: readonly BusinessWorkflowHandler[]) {
		for (const handler of handlers) {
			if (this.handlersById.has(handler.id)) {
				throw new Error(`Duplicate business workflow handler: ${handler.id}`);
			}
			this.handlersById.set(handler.id, handler);
		}
		const referencedIds = new Set<string>();
		for (const definition of listIntentDefinitions()) {
			referencedIds.add(definition.workflowId);
			const handler = this.handlersById.get(definition.workflowId);
			if (!handler) {
				throw new Error(`Missing business workflow handler: ${definition.workflowId}`);
			}
			if (handler.intent !== definition.intent) {
				throw new Error(
					`Business workflow handler ${definition.workflowId} is registered for ${handler.intent}, expected ${definition.intent}`
				);
			}
		}
		for (const handler of handlers) {
			if (!referencedIds.has(handler.id)) {
				throw new Error(`Unreferenced business workflow handler: ${handler.id}`);
			}
		}
	}

	resolve(intent: AgentBusinessIntent): BusinessWorkflowHandler {
		const definition = getIntentDefinition(intent);
		const handler = this.handlersById.get(definition.workflowId);
		if (!handler || handler.intent !== intent) {
			throw new AgentProtocolError({
				operation: 'resolve_business_workflow',
				reason: `Business workflow handler is unavailable for ${definition.workflowId}`
			});
		}
		return handler;
	}
}
