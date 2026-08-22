import { describe, expect, it } from 'vitest';
import type { AgentExecutionTrace, AgentMessage } from '@hotel-butler/api';
import {
  AGENT_CHAT_DISPLAY_NAME,
  agentFailureTitle,
  agentToolStepLabel,
  chatUserDisplayName,
  compactTrendAxisLabel,
  executionForDisplayedMessage,
  isPendingBusinessExecutionConflict,
  messageOwnsPendingClarification,
  shouldDisplayExecutionTrace,
  shouldOfferFailureRetry,
  trendAxisTickSpacing,
  trendAxisTicks,
  usesWideGenerativeUiLayout,
} from '../../../src/renderer/agent-presentation';

describe('isPendingBusinessExecutionConflict', () => {
  it('distinguishes an unfinished clarification from an MCP startup failure', () => {
    expect(
      isPendingBusinessExecutionConflict(
        new Error('当前会话还有等待补充的任务，请先回答或取消该任务。'),
      ),
    ).toBe(true);
    expect(isPendingBusinessExecutionConflict(new Error('MCP server unavailable'))).toBe(false);
  });
});

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
  it('provides stable participant names with a user fallback', () => {
    expect(AGENT_CHAT_DISPLAY_NAME).toBe('小智酒店AI');
    expect(chatUserDisplayName('张经理')).toBe('张经理');
    expect(chatUserDisplayName(null)).toBe('用户');
  });

  it('widens only assistant messages that contain generated UI', () => {
    const generatedUi = {
      root: 'root',
      state: {},
      elements: {
        root: { type: 'Card', props: {}, children: [], visible: true },
      },
    };

    expect(usesWideGenerativeUiLayout({ role: 'assistant', ui: generatedUi })).toBe(true);
    expect(usesWideGenerativeUiLayout({ role: 'assistant', ui: null })).toBe(false);
    expect(usesWideGenerativeUiLayout({ role: 'user', ui: generatedUi })).toBe(false);
  });

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

    expect(
      messageOwnsPendingClarification(execution, userMessage, [userMessage, assistantMessage]),
    ).toBe(false);
    expect(
      messageOwnsPendingClarification(execution, assistantMessage, [userMessage, assistantMessage]),
    ).toBe(true);

    const submittedAnswer = {
      ...message('80000000-0000-4000-8000-000000000001', 'user'),
      businessExecutionId,
      content: '酒店：123',
    };
    expect(
      messageOwnsPendingClarification(execution, assistantMessage, [
        userMessage,
        assistantMessage,
        submittedAnswer,
      ]),
    ).toBe(false);

    const followUp = {
      ...message('90000000-0000-4000-8000-000000000001', 'assistant'),
      businessExecutionId,
      content: '请补充日期范围。',
    };
    expect(
      messageOwnsPendingClarification(execution, assistantMessage, [
        userMessage,
        assistantMessage,
        submittedAnswer,
        followUp,
      ]),
    ).toBe(false);
    expect(
      messageOwnsPendingClarification(execution, followUp, [
        userMessage,
        assistantMessage,
        submittedAnswer,
        followUp,
      ]),
    ).toBe(true);
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

  it('hides successful empty traces but keeps meaningful or failed execution details', () => {
    expect(shouldDisplayExecutionTrace(completed)).toBe(false);
    expect(
      shouldDisplayExecutionTrace({
        ...completed,
        steps: [{ toolCallId: 'tool-1', toolName: 'query', status: 'completed', summary: '完成' }],
      }),
    ).toBe(true);
    expect(shouldDisplayExecutionTrace({ ...completed, status: 'failed' })).toBe(true);
  });

  it('presents distinct business-friendly failure categories and only retries recoverable failures', () => {
    expect(agentFailureTitle('query_rejected')).toBe('查询已被安全拦截');
    expect(agentFailureTitle('data_source_timeout')).toBe('经营数据查询超时');
    expect(agentFailureTitle('data_source_unavailable')).toBe('DMS MCP 查询暂时不可用');
    expect(agentFailureTitle('configuration_error')).toBe('服务尚未配置完成');
    expect(
      shouldOfferFailureRetry({
        code: 'data_source_timeout',
        message: '经营数据查询超时。',
        recovery: 'retry',
        retryable: true,
      }),
    ).toBe(true);
    expect(
      shouldOfferFailureRetry({
        code: 'query_rejected',
        message: '查询未通过安全校验。',
        recovery: 'revise_request',
        retryable: false,
      }),
    ).toBe(false);
  });

  it('replaces technical tool names with business-readable execution labels', () => {
    expect(agentToolStepLabel('query_hotel_operating_data_sql')).toBe('查询酒店经营数据');
    expect(agentToolStepLabel('upstream_llm_analysis')).toBe('分析经营数据');
    expect(agentToolStepLabel('unknown_internal_tool')).toBe('执行辅助工具');
  });

  it('compacts common date labels and increases spacing for long labels', () => {
    expect(compactTrendAxisLabel('2026-08-12 周三')).toBe('8/12 周三');
    expect(compactTrendAxisLabel('2026年8月13日 星期四')).toBe('8/13 周四');
    expect(compactTrendAxisLabel('今天 8月12日')).toBe('8/12');
    expect(trendAxisTickSpacing([{ label: '8/12' }, { label: '8/13' }])).toBe(52);
    expect(trendAxisTickSpacing([{ label: '2026年8月12日 星期三' }])).toBe(72);
  });

  it('shows every label for a seven-point trend and becomes adaptive for larger datasets', () => {
    const sevenDays = Array.from({ length: 7 }, (_, index) => ({ label: `8/${index + 1}` }));
    const eightDays = [...sevenDays, { label: '8/8' }];

    expect(trendAxisTicks(sevenDays)).toEqual(sevenDays.map((item) => item.label));
    expect(trendAxisTicks(eightDays)).toBeUndefined();
  });
});
