import type {
  AgentBusinessExecutionSummary,
  AgentExecutionTrace,
  AgentMessage,
} from '@hotel-butler/api';

export function messageOwnsPendingClarification(
  execution: AgentBusinessExecutionSummary | null,
  message: AgentMessage,
): boolean {
  return (
    execution !== null &&
    execution.pendingClarification !== null &&
    message.role === 'assistant' &&
    message.businessExecutionId === execution.id
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
