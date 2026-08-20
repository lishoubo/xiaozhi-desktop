import type { AgentBusinessIntent, GenerativeUiSpec } from '@hotel-butler/api';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type {
	EvidenceAssessment,
	EvidenceRecord,
	ResolvedBusinessRequest
} from './business-execution-state';
import type { EvidenceEnvelope } from './evidence';

export type DirectWorkflowCollectionPlan = Readonly<{
	kind: 'direct';
	tool: StructuredToolInterface;
	args: Readonly<Record<string, unknown>>;
}>;

export type WorkflowCollectionPlan =
	| DirectWorkflowCollectionPlan
	| Readonly<{
			kind: 'agent';
			reason: 'agent_required' | 'tool_unavailable' | 'incompatible_tool_schema';
	  }>
	| Readonly<{ kind: 'protocol_error'; operation: string; reason: string }>;

export type DeterministicWorkflowAnswer = Readonly<{
	content: string;
	ui: GenerativeUiSpec;
}>;

export interface BusinessWorkflowHandler {
	readonly id: string;
	readonly intent: AgentBusinessIntent;
	requiresToolCatalog(request: ResolvedBusinessRequest): boolean;
	planCollection(
		request: ResolvedBusinessRequest,
		tools: readonly StructuredToolInterface[]
	): WorkflowCollectionPlan;
	assessEvidence(
		request: ResolvedBusinessRequest,
		evidence: readonly EvidenceEnvelope[],
		followUpUsed: boolean
	): EvidenceAssessment;
	present(
		request: ResolvedBusinessRequest,
		evidence: readonly EvidenceRecord[]
	): DeterministicWorkflowAnswer | null;
}
