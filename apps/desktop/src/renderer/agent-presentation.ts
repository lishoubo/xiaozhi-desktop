import type {
  AgentBusinessExecutionSummary,
  AgentExecutionTrace,
  AgentFailureCode,
  AgentMessage,
} from '@hotel-butler/api';

export const AGENT_CHAT_DISPLAY_NAME = '小智酒店AI';

export function chatUserDisplayName(name: string | null): string {
  return name?.trim() || '用户';
}

export function messageOwnsPendingClarification(
  execution: AgentBusinessExecutionSummary | null,
  message: AgentMessage,
  messages: readonly AgentMessage[],
): boolean {
  const latestExecutionMessage = messages.findLast(
    (candidate) => candidate.businessExecutionId === execution?.id,
  );
  return (
    execution !== null &&
    execution.pendingClarification !== null &&
    message.role === 'assistant' &&
    message.businessExecutionId === execution.id &&
    latestExecutionMessage?.id === message.id
  );
}

export function executionForDisplayedMessage(
  executions: readonly AgentExecutionTrace[],
  message: AgentMessage,
): AgentExecutionTrace | null {
  const completed = executions.find((execution) => execution.assistantMessageId === message.id);
  if (completed) return completed;
  if (message.role !== 'user') return null;
  return (
    executions.find(
      (execution) =>
        execution.userMessageId === message.id &&
        execution.assistantMessageId === null &&
        execution.status !== 'running',
    ) ?? null
  );
}

export function shouldDisplayExecutionTrace(trace: AgentExecutionTrace): boolean {
  return trace.steps.length > 0 || trace.status === 'failed' || trace.status === 'cancelled';
}

export function agentFailureTitle(code: AgentFailureCode): string {
  switch (code) {
    case 'query_rejected':
      return '查询已被安全拦截';
    case 'query_invalid':
      return '查询条件需要调整';
    case 'data_source_timeout':
      return '经营数据查询超时';
    case 'data_source_unavailable':
      return '经营数据暂时无法连接';
    case 'model_timeout':
      return '分析服务响应超时';
    case 'model_unavailable':
      return '分析服务暂时繁忙';
    case 'model_output_invalid':
      return '分析结果生成不完整';
    case 'evidence_rejected':
      return '数据校验未通过';
    case 'configuration_error':
      return '服务尚未配置完成';
    case 'execution_protocol_error':
      return '任务执行步骤异常';
    case 'unexpected_error':
      return '本次任务未完成';
  }
}

export function shouldOfferFailureRetry(failure: AgentExecutionTrace['failure']): boolean {
  return failure?.recovery === 'retry' && failure.retryable;
}

export function agentToolStepLabel(toolName: string): string {
  switch (toolName) {
    case 'query_hotel_operating_data_sql':
      return '查询酒店经营数据';
    case 'list_hotel_data_tables':
      return '查找经营数据表';
    case 'describe_hotel_data_table':
      return '读取经营指标字段';
    case 'render_hotel_ui':
      return '生成经营数据视图';
    case 'upstream_llm_analysis':
      return '分析经营数据';
    default:
      return '执行辅助工具';
  }
}

export function usesWideGenerativeUiLayout(message: Pick<AgentMessage, 'role' | 'ui'>): boolean {
  return message.role === 'assistant' && message.ui !== null;
}

export function isPendingBusinessExecutionConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    /等待补充的任务|先回答或取消|active business execution/i.test(error.message)
  );
}

export function compactTrendAxisLabel(label: string): string {
  const normalized = label.trim().replace(/\s+/g, ' ');
  const date = normalized.match(/(?:\d{4}\s*[-/.年]\s*)?(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?/);
  if (date) {
    const weekday = normalized.match(/(?:星期|周)([一二三四五六日天])/);
    return `${Number(date[1])}/${Number(date[2])}${weekday ? ` 周${weekday[1] === '天' ? '日' : weekday[1]}` : ''}`;
  }
  return normalized.length > 8 ? `${normalized.slice(0, 7)}…` : normalized;
}

export function trendAxisTickSpacing(data: readonly { label: string }[]): number {
  const longest = data.reduce((length, item) => Math.max(length, item.label.trim().length), 0);
  if (longest > 10) return 72;
  if (longest > 6) return 64;
  return 52;
}

export function trendAxisTicks(data: readonly { label: string }[]): string[] | undefined {
  return data.length > 0 && data.length <= 7 ? data.map((item) => item.label) : undefined;
}

export function formatConversationUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const includeYear = date.getFullYear() !== now.getFullYear();
  return new Intl.DateTimeFormat('zh-CN', {
    ...(includeYear ? { year: 'numeric' as const } : {}),
    month: 'numeric',
    day: 'numeric',
  }).format(date);
}
