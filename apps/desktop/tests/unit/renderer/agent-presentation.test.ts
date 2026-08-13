import { describe, expect, it } from 'vitest';
import type { AgentExecutionTrace, AgentMessage } from '@hotel-butler/api';
import {
  compactTrendAxisLabel,
  executionForDisplayedMessage,
  messageOwnsPendingClarification,
  trendAxisTickSpacing,
} from '../../../src/renderer/agent-presentation';

const cancelled: AgentExecutionTrace = {
  runId: '10000000-0000-4000-8000-000000000001',
  userMessageId: '20000000-0000-4000-8000-000000000001',
  assistantMessageId: null,
  status: 'cancelled',
  steps: [],
  createdAt: '2026-08-12T00:00:00.000Z',
  completedAt: '2026-08-12T00:00:01.000Z',
};
const completed: AgentExecutionTrace = {
  ...cancelled,
  runId: '10000000-0000-4000-8000-000000000002',
  userMessageId: '20000000-0000-4000-8000-000000000002',
  assistantMessageId: '30000000-0000-4000-8000-000000000002',
  status: 'completed',
};

function message(id: string, role: AgentMessage['role']): AgentMessage {
  return {
    id,
    conversationId: '40000000-0000-4000-8000-000000000001',
    role,
    content: role === 'user' ? '继续' : '分析结果',
    ui: null,
    createdAt: '2026-08-12T00:00:00.000Z',
  };
}

describe('Agent result presentation', () => {
  it('attaches pending clarification only to its assistant message', () => {
    const businessExecutionId = '50000000-0000-4000-8000-000000000001';
    const execution = {
      id: businessExecutionId,
      conversationId: '40000000-0000-4000-8000-000000000001',
      triggerUserMessageId: cancelled.userMessageId,
      routeKind: 'business_read' as const,
      intent: 'hotel_operating_summary' as const,
      status: 'awaiting_clarification' as const,
      pendingClarification: {
        interactionId: '60000000-0000-4000-8000-000000000001',
        anchorMessageId: cancelled.userMessageId,
        version: 1,
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
        expiresAt: '2026-08-13T12:00:00.000Z',
      },
      createdAt: '2026-08-12T00:00:00.000Z',
      updatedAt: '2026-08-12T00:00:01.000Z',
      completedAt: null,
    };
    const userMessage = message(cancelled.userMessageId, 'user');
    const assistantMessage = {
      ...message('70000000-0000-4000-8000-000000000001', 'assistant'),
      businessExecutionId,
    };

    expect(messageOwnsPendingClarification(execution, userMessage)).toBe(false);
    expect(messageOwnsPendingClarification(execution, assistantMessage)).toBe(true);
  });

  it('keeps a cancelled trace with its originating user message', () => {
    const executions = [cancelled, completed];

    expect(executionForDisplayedMessage(executions, message(cancelled.userMessageId, 'user'))).toBe(
      cancelled,
    );
    expect(
      executionForDisplayedMessage(
        executions,
        message('30000000-0000-4000-8000-000000000002', 'assistant'),
      ),
    ).toBe(completed);
    expect(executionForDisplayedMessage(executions, message(completed.userMessageId, 'user'))).toBe(
      null,
    );
  });

  it('compacts common date labels and increases spacing for long labels', () => {
    expect(compactTrendAxisLabel('2026-08-12 周三')).toBe('8/12 周三');
    expect(compactTrendAxisLabel('2026年8月13日 星期四')).toBe('8/13 周四');
    expect(compactTrendAxisLabel('今天 8月12日')).toBe('8/12');
    expect(trendAxisTickSpacing([{ label: '8/12' }, { label: '8/13' }])).toBe(52);
    expect(trendAxisTickSpacing([{ label: '2026年8月12日 星期三' }])).toBe(72);
  });
});
