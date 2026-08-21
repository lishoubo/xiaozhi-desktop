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
        retainedContentOnFailure: null,
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

  it('keeps retry metadata on the failed execution for durable recovery UI', () => {
    const started = addStartedRun(
      createEmptyConversationView(conversationId),
      {
        runId,
        userMessage: {
          id: userMessageId,
          conversationId,
          role: 'user',
          content: '查询天气',
          ui: null,
          createdAt: '2026-08-12T03:00:00.000Z',
        },
      },
      '2026-08-12T03:00:00.000Z',
    );
    const pendingExecution = {
      id: '88888888-8888-4888-8888-888888888888',
      conversationId,
      triggerUserMessageId: userMessageId,
      routeKind: 'business_read' as const,
      intent: 'generic_hotel_data_query' as const,
      status: 'executing' as const,
      pendingClarification: null,
      createdAt: '2026-08-12T03:00:00.000Z',
      updatedAt: '2026-08-12T03:00:00.500Z',
      completedAt: null,
    };
    const running = applyRunEvent(
      { ...started, activeBusinessExecution: pendingExecution },
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',
        runId,
        conversationId,
        type: 'text_delta',
        delta: '正在组织回答',
        createdAt: '2026-08-12T03:00:00.500Z',
      },
    );

    const withUi = applyRunEvent(running, {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac',
      runId,
      conversationId,
      type: 'ui_spec',
      spec: {
        root: 'root',
        state: {},
        elements: {
          root: { type: 'Table', props: {}, children: [], visible: true },
        },
      },
      createdAt: '2026-08-12T03:00:00.750Z',
    });
    const ordinaryFailure = applyRunEvent(withUi, {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae',
      runId,
      conversationId,
      type: 'run_failed',
      code: 'model_unavailable',
      message: '普通模型调用失败。',
      recovery: 'retry',
      retryable: true,
      createdAt: '2026-08-12T03:00:00.780Z',
    });
    expect(ordinaryFailure).toMatchObject({ draftContent: '', draftUi: null });

    const analyzing = applyRunEvent(withUi, {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad',
      runId,
      conversationId,
      type: 'tool_started',
      toolCallId: 'analysis-1',
      toolName: 'upstream_llm_analysis',
      createdAt: '2026-08-12T03:00:00.800Z',
    });

    const partiallyAnalyzed = applyRunEvent(analyzing, {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaf',
      runId,
      conversationId,
      type: 'text_delta',
      delta: '未完成的模型分析',
      createdAt: '2026-08-12T03:00:00.900Z',
    });

    const failed = applyRunEvent(partiallyAnalyzed, {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      runId,
      conversationId,
      type: 'run_failed',
      code: 'data_source_unavailable',
      message: '天气服务暂时不可用。',
      recovery: 'retry',
      retryable: true,
      createdAt: '2026-08-12T03:00:01.000Z',
    });

    expect(failed.executions[0]).toMatchObject({
      status: 'failed',
      failure: {
        code: 'data_source_unavailable',
        message: '天气服务暂时不可用。',
        recovery: 'retry',
        retryable: true,
      },
    });
    expect(failed).toMatchObject({
      activeRunId: null,
      activeBusinessExecution: null,
      draftContent: '正在组织回答',
      draftUi: expect.objectContaining({ root: 'root' }),
      preparingUi: false,
      errorMessage: '天气服务暂时不可用。',
    });
  });

  it('marks a failed tool as failed instead of completed', () => {
    const started = addStartedRun(
      createEmptyConversationView(conversationId),
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
    const running = applyRunEvent(started, {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      runId,
      conversationId,
      type: 'tool_started',
      toolCallId: 'query-1',
      toolName: 'query_hotel_operating_data_sql',
      createdAt: '2026-08-12T03:00:00.500Z',
    });
    const failed = applyRunEvent(running, {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
      runId,
      conversationId,
      type: 'tool_failed',
      toolCallId: 'query-1',
      toolName: 'query_hotel_operating_data_sql',
      code: 'query_rejected',
      summary: '查询未通过安全校验',
      createdAt: '2026-08-12T03:00:00.750Z',
    });

    expect(failed.executions[0]?.steps).toEqual([
      {
        toolCallId: 'query-1',
        toolName: 'query_hotel_operating_data_sql',
        status: 'failed',
        failureCode: 'query_rejected',
        summary: '查询未通过安全校验',
      },
    ]);
  });
});
