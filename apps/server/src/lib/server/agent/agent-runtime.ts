import type { AgentMessage, AgentPrincipal, GenerativeUiSpec } from '@hotel-butler/api';

export type RuntimeEvent =
	| Readonly<{ type: 'text_delta'; delta: string }>
	| Readonly<{ type: 'tool_started'; toolCallId: string; toolName: string }>
	| Readonly<{
			type: 'tool_completed';
			toolCallId: string;
			toolName: string;
			summary: string;
	  }>
	| Readonly<{ type: 'ui_spec'; spec: GenerativeUiSpec }>;

export type AgentRuntimeRunOptions = Readonly<{
	principal: AgentPrincipal;
	conversationSummary: string | null;
	history: readonly AgentMessage[];
	signal: AbortSignal;
	emit(event: RuntimeEvent): Promise<void>;
}>;

export type AgentRuntimeResult = Readonly<{
	content: string;
	ui: GenerativeUiSpec | null;
}>;

export interface AgentRuntime {
	run(options: AgentRuntimeRunOptions): Promise<AgentRuntimeResult>;
}
