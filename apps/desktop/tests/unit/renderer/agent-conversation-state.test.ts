import type { AgentConversation, AgentRunEvent } from '@hotel-butler/api';
import { describe, expect, it } from 'vitest';
import {
  addStartedRun,
  applyRunEvent,
  createEmptyConversationView,
  hydrateConversationView,
} from '../../../src/renderer/agent-conversation-state';

const conversationId = '11111111-1111-4111-8111-111111111111';
const runId = '22222222-2222-4222-8222-222222222222';
const userMessageId = '33333333-3333-4333-8333-333333333333';

describe('Agent conversation view state', () => {
  it('hydrates a persisted active draft and keeps another conversation isolated', () => {
    const snapshot: AgentConversation = {
      conversation: {
        id: conversationId,
        title: '经营分析',
        activeRunId: runId,
        createdAt: '2026-08-12T03:00:00.000Z',
        updatedAt: '2026-08-12T03:00:00.000Z',
      },
      messages: [],
      executions: [],
      activeRun: {
        runId,
        content: '已查询酒店',
        ui: null,
        preparingUi: true,
        lastEventId: '44444444-4444-4444-8444-444444444444',
      },
    };
    const restored = hydrateConversationView(snapshot);
    const other = createEmptyConversationView('55555555-5555-4555-8555-555555555555');
    const event: AgentRunEvent = {
      id: '66666666-6666-4666-8666-666666666666',
      runId,
      conversationId,
      type: 'text_delta',
      delta: '，正在生成结论',
      createdAt: '2026-08-12T03:00:01.000Z',
    };

    expect(applyRunEvent(restored, event).draftContent).toBe('已查询酒店，正在生成结论');
    expect(applyRunEvent(other, event)).toBe(other);
  });

  it('keeps a cancelled trace beside its own message and clears only that active draft', () => {
    const base = createEmptyConversationView(conversationId);
    const running = addStartedRun(
      base,
      {
        runId,
        userMessage: {
          id: userMessageId,
          conversationId,
          role: 'user',
          content: '查询经营数据',
          ui: null,
          createdAt: '2026-08-12T03:00:00.000Z',
        },
      },
      '2026-08-12T03:00:00.000Z',
    );
    const cancelled = applyRunEvent(running, {
      id: '77777777-7777-4777-8777-777777777777',
      runId,
      conversationId,
      type: 'run_cancelled',
      createdAt: '2026-08-12T03:00:01.000Z',
    });

    expect(cancelled.activeRunId).toBeNull();
    expect(cancelled.messages).toEqual([running.messages[0]]);
    expect(cancelled.executions[0]).toMatchObject({ runId, status: 'cancelled' });
  });

  it('tracks a pending clarification independently of the Run draft', () => {
    const execution = {
      id: '88888888-8888-4888-8888-888888888888',
      conversationId,
      triggerUserMessageId: userMessageId,
      routeKind: 'business_read' as const,
      intent: 'hotel_operating_summary' as const,
      status: 'awaiting_clarification' as const,
      pendingClarification: {
        interactionId: '99999999-9999-4999-8999-999999999999',
        anchorMessageId: userMessageId,
        version: 3,
        prompt: '请选择酒店。',
        fields: [
          {
            kind: 'text' as const,
            slot: 'hotelReference',
            label: '酒店',
            required: true,
            maxLength: 200,
          },
        ],
        expiresAt: '2026-08-13T03:00:00.000Z',
      },
      createdAt: '2026-08-12T03:00:00.000Z',
      updatedAt: '2026-08-12T03:00:01.000Z',
      completedAt: null,
    };
    const base = { ...createEmptyConversationView(conversationId), activeRunId: runId };
    const updated = applyRunEvent(base, {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      runId,
      conversationId,
      type: 'business_execution_updated',
      execution,
      createdAt: '2026-08-12T03:00:01.000Z',
    });

    expect(updated.activeBusinessExecution).toEqual(execution);
    expect(updated.draftContent).toBe('');
  });
});
