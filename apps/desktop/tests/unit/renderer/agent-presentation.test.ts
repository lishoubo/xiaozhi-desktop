import { describe, expect, it } from 'vitest';
import type { AgentExecutionTrace, AgentMessage } from '@hotel-butler/api';
import {
  compactTrendAxisLabel,
  executionForDisplayedMessage,
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
