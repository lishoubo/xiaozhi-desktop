import type { AgentRunEvent } from '@hotel-butler/api';
import { describe, expect, it, vi } from 'vitest';
import { AgentService, type AgentClient } from '../../../src/main/services/agent-service';

describe('AgentService', () => {
  it('bridges tracked tRPC events and disposes the active subscription', async () => {
    const unsubscribe = vi.fn();
    const callbacks: { onData?: (event: { id: string; data: AgentRunEvent }) => void } = {};
    const runId = '11111111-1111-4111-8111-111111111111';
    const conversationId = '22222222-2222-4222-8222-222222222222';
    const userMessage = {
      id: '33333333-3333-4333-8333-333333333333',
      conversationId,
      role: 'user' as const,
      content: '检查异常订单',
      ui: null,
      createdAt: '2026-08-10T00:00:00.000Z',
    };
    const client: AgentClient = {
      agent: {
        capabilities: { query: vi.fn() },
        quickActions: { query: vi.fn() },
        listConversations: { query: vi.fn() },
        createConversation: { mutate: vi.fn() },
        getConversation: { query: vi.fn() },
        deleteConversation: { mutate: vi.fn().mockResolvedValue({ deletedCount: 1 }) },
        clearConversations: { mutate: vi.fn().mockResolvedValue({ deletedCount: 3 }) },
        startRun: { mutate: vi.fn().mockResolvedValue({ runId, userMessage }) },
        retryRun: { mutate: vi.fn() },
        submitClarification: { mutate: vi.fn() },
        cancelBusinessExecution: { mutate: vi.fn() },
        cancelRun: { mutate: vi.fn().mockResolvedValue({ runId, status: 'cancelled' }) },
        events: {
          subscribe: vi.fn((_input, handlers) => {
            callbacks.onData = handlers.onData;
            return { unsubscribe };
          }),
        },
      },
    };
    const notify = vi.fn();
    const info = vi.fn();
    const service = new AgentService(client, notify, {
      info,
      warn: vi.fn(),
      error: vi.fn(),
    });

    await service.startRun({ conversationId, prompt: '检查异常订单', clientRequestId: runId });
    const event: AgentRunEvent = {
      id: '44444444-4444-4444-8444-444444444444',
      runId,
      conversationId,
      type: 'text_delta',
      delta: '发现 2 笔',
      createdAt: '2026-08-10T00:00:01.000Z',
    };
    const onData = callbacks.onData;
    if (!onData) throw new Error('subscription callback was not installed');
    onData({ id: event.id, data: event });

    expect(notify).toHaveBeenCalledWith({ kind: 'event', event });
    expect(info).toHaveBeenCalledWith(
      'Agent run started',
      expect.objectContaining({
        event: 'agent.client.run.started',
        runId,
        conversationId,
        requestKind: 'prompt',
      }),
    );
    expect(info).toHaveBeenCalledWith(
      'Agent event subscription connected',
      expect.objectContaining({ runId, conversationId }),
    );
    expect(JSON.stringify(info.mock.calls)).not.toContain('检查异常订单');
    expect(JSON.stringify(info.mock.calls)).not.toContain('发现 2 笔');
    await expect(service.deleteConversation(conversationId)).resolves.toEqual({ deletedCount: 1 });
    await expect(service.clearConversations()).resolves.toEqual({ deletedCount: 3 });
    expect(info).toHaveBeenCalledWith(
      'Agent conversation deleted',
      expect.objectContaining({ conversationId, deletedCount: 1 }),
    );
    expect(info).toHaveBeenCalledWith(
      'Agent conversations cleared',
      expect.objectContaining({ deletedCount: 3 }),
    );
    await expect(service.cancelRun(runId)).resolves.toEqual({ runId, status: 'cancelled' });
    expect(info).toHaveBeenCalledWith(
      'Agent run cancellation acknowledged',
      expect.objectContaining({ runId, status: 'cancelled' }),
    );
    service.dispose();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('replaces an existing subscription and resumes after the persisted event cursor', () => {
    const firstUnsubscribe = vi.fn();
    const secondUnsubscribe = vi.fn();
    const subscribe = vi
      .fn()
      .mockReturnValueOnce({ unsubscribe: firstUnsubscribe })
      .mockReturnValueOnce({ unsubscribe: secondUnsubscribe });
    const client = {
      agent: {
        capabilities: { query: vi.fn() },
        quickActions: { query: vi.fn() },
        listConversations: { query: vi.fn() },
        createConversation: { mutate: vi.fn() },
        getConversation: { query: vi.fn() },
        deleteConversation: { mutate: vi.fn() },
        clearConversations: { mutate: vi.fn() },
        startRun: { mutate: vi.fn() },
        retryRun: { mutate: vi.fn() },
        submitClarification: { mutate: vi.fn() },
        cancelBusinessExecution: { mutate: vi.fn() },
        cancelRun: { mutate: vi.fn() },
        events: { subscribe },
      },
    } satisfies AgentClient;
    const service = new AgentService(client, vi.fn(), {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    });
    const runId = '11111111-1111-4111-8111-111111111111';
    const conversationId = '22222222-2222-4222-8222-222222222222';
    const cursor = '33333333-3333-4333-8333-333333333333';

    service.resumeRun(runId, conversationId, null);
    service.resumeRun(runId, conversationId, cursor);

    expect(firstUnsubscribe).toHaveBeenCalledOnce();
    expect(subscribe).toHaveBeenLastCalledWith(
      { runId, lastEventId: cursor },
      expect.objectContaining({
        onData: expect.any(Function),
        onError: expect.any(Function),
        onComplete: expect.any(Function),
      }),
    );
    service.dispose();
    expect(secondUnsubscribe).toHaveBeenCalledOnce();
  });
});
