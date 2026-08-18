import type {
  AgentConversation,
  AgentBusinessExecutionSummary,
  AgentExecutionTrace,
  AgentMessage,
  AgentRunEvent,
  GenerativeUiSpec,
  StartAgentRunResponse,
} from '@hotel-butler/api';

export type AgentConversationViewState = Readonly<{
  conversationId: string;
  messages: AgentMessage[];
  executions: AgentExecutionTrace[];
  activeRunId: string | null;
  draftContent: string;
  draftUi: GenerativeUiSpec | null;
  preparingUi: boolean;
  retainValidatedDraftOnFailure: boolean;
  errorMessage: string;
  activeBusinessExecution: AgentBusinessExecutionSummary | null;
}>;

export function createEmptyConversationView(conversationId: string): AgentConversationViewState {
  return {
    conversationId,
    messages: [],
    executions: [],
    activeRunId: null,
    draftContent: '',
    draftUi: null,
    preparingUi: false,
    retainValidatedDraftOnFailure: false,
    errorMessage: '',
    activeBusinessExecution: null,
  };
}

export function hydrateConversationView(snapshot: AgentConversation): AgentConversationViewState {
  return {
    conversationId: snapshot.conversation.id,
    messages: [...snapshot.messages],
    executions: [...snapshot.executions],
    activeRunId: snapshot.activeRun?.runId ?? null,
    draftContent: snapshot.activeRun?.content ?? '',
    draftUi: snapshot.activeRun?.ui ?? null,
    preparingUi: snapshot.activeRun?.preparingUi ?? false,
    retainValidatedDraftOnFailure:
      snapshot.activeRun !== null &&
      snapshot.activeRun !== undefined &&
      snapshot.executions.some(
        (execution) =>
          execution.runId === snapshot.activeRun?.runId &&
          execution.steps.some((step) => step.toolName === 'upstream_llm_analysis'),
      ),
    errorMessage: '',
    activeBusinessExecution: snapshot.activeBusinessExecution ?? null,
  };
}

export function addStartedRun(
  state: AgentConversationViewState,
  started: StartAgentRunResponse,
  createdAt: string,
): AgentConversationViewState {
  return {
    ...state,
    messages: [...state.messages, started.userMessage],
    executions: [
      ...state.executions,
      {
        runId: started.runId,
        businessExecutionId: started.businessExecutionId ?? null,
        userMessageId: started.userMessage.id,
        assistantMessageId: null,
        status: 'running',
        steps: [],
        createdAt,
        completedAt: null,
        failure: null,
      },
    ],
    activeRunId: started.runId,
    draftContent: '',
    draftUi: null,
    preparingUi: false,
    retainValidatedDraftOnFailure: false,
    errorMessage: '',
  };
}

export function applyRunEvent(
  state: AgentConversationViewState,
  event: AgentRunEvent,
): AgentConversationViewState {
  if (event.conversationId !== state.conversationId || event.runId !== state.activeRunId) {
    return state;
  }
  if (event.type === 'text_delta') {
    return { ...state, draftContent: state.draftContent + event.delta };
  }
  if (event.type === 'tool_started') {
    return {
      ...state,
      preparingUi: state.preparingUi || event.toolName === 'render_hotel_ui',
      retainValidatedDraftOnFailure:
        state.retainValidatedDraftOnFailure || event.toolName === 'upstream_llm_analysis',
      executions: updateExecution(state.executions, event.runId, (execution) => ({
        ...execution,
        steps: [
          ...execution.steps.filter((step) => step.toolCallId !== event.toolCallId),
          {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            status: 'running',
            summary: '',
          },
        ],
      })),
    };
  }
  if (event.type === 'tool_completed') {
    return {
      ...state,
      executions: updateExecution(state.executions, event.runId, (execution) => ({
        ...execution,
        steps: execution.steps.some((step) => step.toolCallId === event.toolCallId)
          ? execution.steps.map((step) =>
              step.toolCallId === event.toolCallId
                ? { ...step, status: 'completed', summary: event.summary }
                : step,
            )
          : [
              ...execution.steps,
              {
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                status: 'completed',
                summary: event.summary,
              },
            ],
      })),
    };
  }
  if (event.type === 'ui_spec') {
    return { ...state, draftUi: event.spec, preparingUi: false };
  }
  if (event.type === 'business_execution_updated') {
    return {
      ...state,
      activeBusinessExecution: ['completed', 'failed', 'cancelled'].includes(event.execution.status)
        ? null
        : event.execution,
    };
  }
  if (event.type === 'run_completed') {
    return {
      ...clearActiveRun(state),
      messages: state.messages.some((message) => message.id === event.message.id)
        ? state.messages
        : [...state.messages, event.message],
      executions: updateExecution(state.executions, event.runId, (execution) => ({
        ...execution,
        assistantMessageId: event.message.id,
        status: 'completed',
        completedAt: event.createdAt,
      })),
    };
  }
  if (event.type === 'run_failed') {
    return {
      ...clearActiveRun(state, state.retainValidatedDraftOnFailure && state.draftUi !== null),
      activeBusinessExecution: null,
      errorMessage: event.message,
      executions: updateExecution(state.executions, event.runId, (execution) => ({
        ...execution,
        status: 'failed',
        completedAt: event.createdAt,
        failure: { message: event.message, retryable: event.retryable },
      })),
    };
  }
  if (event.type === 'run_cancelled') {
    return {
      ...clearActiveRun(state),
      activeBusinessExecution: null,
      executions: updateExecution(state.executions, event.runId, (execution) => ({
        ...execution,
        status: 'cancelled',
        completedAt: event.createdAt,
      })),
    };
  }
  return state;
}

export function withConversationError(
  state: AgentConversationViewState,
  errorMessage: string,
): AgentConversationViewState {
  return { ...state, errorMessage };
}

function clearActiveRun(
  state: AgentConversationViewState,
  preserveDraft = false,
): AgentConversationViewState {
  return {
    ...state,
    activeRunId: null,
    draftContent: preserveDraft ? state.draftContent : '',
    draftUi: preserveDraft ? state.draftUi : null,
    preparingUi: false,
    retainValidatedDraftOnFailure: false,
  };
}

function updateExecution(
  executions: AgentExecutionTrace[],
  runId: string,
  update: (execution: AgentExecutionTrace) => AgentExecutionTrace,
): AgentExecutionTrace[] {
  return executions.map((execution) => (execution.runId === runId ? update(execution) : execution));
}
