import { describe, expect, it, vi } from 'vitest';
import {
  createAgentController,
  shouldFollowConversationAfterAction,
  type AgentDesktopAdapter,
} from '../../../src/renderer/agent-controller';

const conversationId = '11111111-1111-4111-8111-111111111111';
const runId = '22222222-2222-4222-8222-222222222222';
const failedRunId = '33333333-3333-4333-8333-333333333333';

function conversation(activeRunId: string | null = null) {
  return {
    id: conversationId,
    title: '经营分析',
    activeRunId,
    createdAt: '2026-08-12T03:00:00.000Z',
    updatedAt: '2026-08-12T03:00:00.000Z',
  } as const;
}

function snapshot(activeRunId: string | null = null) {
  return {
    conversation: conversation(activeRunId),
    messages: [],
    executions: [],
    activeRun: activeRunId
      ? {
          runId: activeRunId,
          content: '',
          ui: null,
          preparingUi: false,
          retainedContentOnFailure: null,
          lastEventId: null,
        }
      : null,
  } as const;
}

function adapter(overrides: Partial<AgentDesktopAdapter> = {}): AgentDesktopAdapter {
  return {
    quickActions: vi.fn().mockResolvedValue([]),
    listConversations: vi.fn().mockResolvedValue([]),
    createConversation: vi.fn().mockResolvedValue(conversation()),
    getConversation: vi.fn().mockResolvedValue(snapshot()),
    deleteConversation: vi.fn().mockResolvedValue({ deletedCount: 1 }),
    clearConversations: vi.fn().mockResolvedValue({ deletedCount: 1 }),
    startRun: vi.fn().mockResolvedValue({
      runId,
      userMessage: {
        id: '44444444-4444-4444-8444-444444444444',
        conversationId,
        role: 'user',
        content: '查询经营数据',
        ui: null,
        createdAt: '2026-08-12T03:00:01.000Z',
      },
    }),
    retryRun: vi.fn(),
    submitClarification: vi.fn(),
    cancelBusinessExecution: vi.fn(),
    resumeRun: vi.fn().mockResolvedValue(undefined),
    cancelRun: vi.fn().mockResolvedValue({ runId, status: 'cancelled' }),
    onStreamEvent: vi.fn().mockReturnValue(() => undefined),
    ...overrides,
  };
}

describe('AgentController', () => {
  it('does not restore scroll-follow after the active conversation changes during an action', () => {
    expect(shouldFollowConversationAfterAction(true, conversationId, conversationId)).toBe(true);
    expect(
      shouldFollowConversationAfterAction(
        true,
        conversationId,
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      ),
    ).toBe(false);
  });

  it('isolates instance state and unsubscribes the disposed instance', async () => {
    const unsubscribeFirst = vi.fn();
    const firstApi = adapter({
      listConversations: vi.fn().mockResolvedValue([conversation()]),
      onStreamEvent: vi.fn().mockReturnValue(unsubscribeFirst),
    });
    const secondApi = adapter({ listConversations: vi.fn().mockResolvedValue([]) });
    const first = createAgentController(firstApi);
    const second = createAgentController(secondApi);

    await first.initialize();
    await second.initialize();
    expect(first.state.conversations).toHaveLength(1);
    expect(second.state.conversations).toHaveLength(0);

    first.dispose();
    expect(unsubscribeFirst).toHaveBeenCalledOnce();
    first.dispose();
    expect(unsubscribeFirst).toHaveBeenCalledOnce();
  });

  it('initializes, hydrates active conversations and resumes their streams', async () => {
    const api = adapter({
      listConversations: vi.fn().mockResolvedValue([conversation(runId)]),
      getConversation: vi.fn().mockResolvedValue(snapshot(runId)),
    });
    const controller = createAgentController(api, {
      randomId: () => '55555555-5555-4555-8555-555555555555',
      now: () => '2026-08-12T03:00:01.000Z',
    });

    await controller.initialize();

    expect(controller.state.loading).toBe(false);
    expect(controller.state.conversationViews.get(conversationId)?.activeRunId).toBe(runId);
    expect(api.resumeRun).toHaveBeenCalledWith(runId, conversationId, null);
    controller.dispose();
  });

  it('opens a conversation, starts a run and reduces its terminal stream event', async () => {
    const api = adapter({ listConversations: vi.fn().mockResolvedValue([conversation()]) });
    const controller = createAgentController(api, {
      randomId: () => '55555555-5555-4555-8555-555555555555',
      now: () => '2026-08-12T03:00:01.000Z',
    });
    await controller.initialize();
    await controller.openConversation(conversationId);

    await expect(controller.startRun({ prompt: '查询经营数据' })).resolves.toBe(true);
    expect(api.startRun).toHaveBeenCalledWith({
      conversationId,
      prompt: '查询经营数据',
      clientRequestId: '55555555-5555-4555-8555-555555555555',
    });
    const runningViews = controller.state.conversationViews;
    controller.handleStreamEnvelope({
      kind: 'event',
      event: {
        id: '66666666-6666-4666-8666-666666666666',
        runId,
        conversationId,
        type: 'run_cancelled',
        createdAt: '2026-08-12T03:00:02.000Z',
      },
    });
    expect(controller.state.conversationViews).not.toBe(runningViews);
    expect(controller.state.conversationViews.get(conversationId)?.activeRunId).toBeNull();
  });

  it('retries a failed run, cancels an active run and deletes an idle conversation', async () => {
    const retryRun = vi.fn().mockResolvedValue({
      runId,
      userMessage: {
        id: '77777777-7777-4777-8777-777777777777',
        conversationId,
        role: 'user',
        content: '重试',
        ui: null,
        createdAt: '2026-08-12T03:00:03.000Z',
      },
    });
    const api = adapter({
      listConversations: vi.fn().mockResolvedValue([conversation()]),
      getConversation: vi.fn().mockResolvedValue({
        ...snapshot(),
        executions: [
          {
            runId: failedRunId,
            businessExecutionId: null,
            userMessageId: '88888888-8888-4888-8888-888888888888',
            assistantMessageId: null,
            status: 'failed',
            steps: [],
            createdAt: '2026-08-12T03:00:00.000Z',
            completedAt: '2026-08-12T03:00:01.000Z',
            failure: {
              code: 'model_unavailable',
              message: '模型不可用',
              recovery: 'retry',
              retryable: true,
            },
          },
        ],
      }),
      retryRun,
    });
    const controller = createAgentController(api, {
      randomId: () => '99999999-9999-4999-8999-999999999999',
      now: () => '2026-08-12T03:00:03.000Z',
    });
    await controller.initialize();
    await controller.openConversation(conversationId);

    await controller.retryFailedRun();
    expect(retryRun).toHaveBeenCalledWith({
      failedRunId,
      clientRequestId: '99999999-9999-4999-8999-999999999999',
    });
    await controller.cancelActiveRun();
    expect(api.cancelRun).toHaveBeenCalledWith(runId);

    await controller.loadConversation(conversationId);
    await controller.deleteConversation(conversationId);
    expect(controller.state.conversations).toEqual([]);
  });
});
