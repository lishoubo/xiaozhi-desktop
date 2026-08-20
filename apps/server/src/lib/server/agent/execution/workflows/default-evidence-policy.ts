import type { EvidenceAssessment, ResolvedBusinessRequest } from '../business-execution-state';
import { assessEvidence, type EvidenceEnvelope } from '../evidence';

export function assessDefaultWorkflowEvidence(
	request: ResolvedBusinessRequest,
	evidence: readonly EvidenceEnvelope[],
	followUpUsed: boolean
): EvidenceAssessment {
	return assessEvidence(request, evidence, followUpUsed);
}
