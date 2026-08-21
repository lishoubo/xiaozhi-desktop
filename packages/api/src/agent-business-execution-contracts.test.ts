import { describe, expect, it } from 'vitest';
import * as contracts from './agent-contracts';

const ID = {
  conversation: '11111111-1111-4111-8111-111111111111',
  message: '22222222-2222-4222-8222-222222222222',
  run: '33333333-3333-4333-8333-333333333333',
  execution: '44444444-4444-4444-8444-444444444444',
  interaction: '55555555-5555-4555-8555-555555555555',
  request: '66666666-6666-4666-8666-666666666666',
  event: '77777777-7777-4777-8777-777777777777',
} as const;

function requireSchema(name: string) {
  const schema = Reflect.get(contracts, name);
  expect(schema, `${name} must be exported`).toBeDefined();
  if (
    !schema ||
    typeof schema !== 'object' ||
    !('safeParse' in schema) ||
    typeof schema.safeParse !== 'function'
  ) {
    throw new Error(`${name} is not a schema`);
  }
  return schema;
}

const clarification = {
  interactionId: ID.interaction,
  anchorMessageId: ID.message,
  version: 3,
  prompt: '请选择酒店并补充离店日期。',
  fields: [
    {
      kind: 'single_choice',
      slot: 'hotel',
      label: '酒店',
      required: true,
      choices: [
        { value: 'hotel-1', label: '杭州西湖店' },
        { value: 'hotel-2', label: '杭州西湖景区店' },
      ],
    },
    {
      kind: 'date',
      slot: 'checkOut',
      label: '离店日期',
      required: true,
      min: '2026-08-14',
    },
  ],
  expiresAt: '2026-08-14T00:00:00.000+08:00',
} as const;

const businessExecution = {
  id: ID.execution,
  conversationId: ID.conversation,
  triggerUserMessageId: ID.message,
  routeKind: 'business_read',
  intent: 'public_hotel_rates',
  status: 'awaiting_clarification',
  pendingClarification: clarification,
  createdAt: '2026-08-13T00:00:00.000Z',
  updatedAt: '2026-08-13T00:01:00.000Z',
  completedAt: null,
} as const;

describe('Agent business execution contracts', () => {
  it('keeps a validated draft boundary for active analysis recovery', () => {
    const schema = requireSchema('agentActiveRunSchema');

    expect(
      schema.safeParse({
        runId: ID.run,
        content: '可靠摘要\n\n未完成分析',
        ui: null,
        preparingUi: false,
        retainedContentOnFailure: '可靠摘要',
        lastEventId: null,
      }).success,
    ).toBe(true);
  });

  it('accepts bounded deterministic clarification fields and rejects extra properties', () => {
    const schema = requireSchema('agentPendingClarificationSchema');

    expect(schema.safeParse(clarification).success).toBe(true);
    expect(
      schema.safeParse({
        ...clarification,
        action: {
          kind: 'navigate',
          destination: 'hotel_management',
          label: '前往酒店管理',
        },
      }).success,
    ).toBe(true);
    expect(schema.safeParse({ ...clarification, modelPrompt: 'hidden' }).success).toBe(false);
    expect(
      schema.safeParse({
        ...clarification,
        fields: [
          { kind: 'single_choice', slot: 'hotel', label: '酒店', required: true, choices: [] },
        ],
      }).success,
    ).toBe(false);
  });

  it('keeps business execution separate from the existing per-run execution trace', () => {
    const schema = requireSchema('agentBusinessExecutionSummarySchema');

    expect(schema.safeParse(businessExecution).success).toBe(true);
    expect(
      contracts.agentExecutionTraceSchema.safeParse({
        runId: ID.run,
        businessExecutionId: ID.execution,
        userMessageId: ID.message,
        assistantMessageId: null,
        status: 'running',
        steps: [],
        createdAt: '2026-08-13T00:00:00.000Z',
        completedAt: null,
      }).success,
    ).toBe(true);
  });

  it('hydrates business executions and the one active execution with a conversation', () => {
    expect(
      contracts.agentConversationSchema.safeParse({
        conversation: {
          id: ID.conversation,
          title: '房价查询',
          activeRunId: null,
          activeBusinessExecutionId: ID.execution,
          createdAt: '2026-08-13T00:00:00.000Z',
          updatedAt: '2026-08-13T00:01:00.000Z',
        },
        messages: [
          {
            id: ID.message,
            conversationId: ID.conversation,
            businessExecutionId: ID.execution,
            role: 'user',
            content: '查西湖店明天的价格',
            ui: null,
            createdAt: '2026-08-13T00:00:00.000Z',
          },
        ],
        executions: [],
        businessExecutions: [businessExecution],
        activeBusinessExecution: businessExecution,
        activeRun: null,
      }).success,
    ).toBe(true);
  });

  it('accepts exactly one clarification input mode and rejects client ownership', () => {
    const schema = requireSchema('submitAgentClarificationInputSchema');
    const base = {
      businessExecutionId: ID.execution,
      interactionId: ID.interaction,
      expectedVersion: 3,
      clientRequestId: ID.request,
    };

    expect(schema.safeParse({ ...base, answers: { hotel: 'hotel-2' } }).success).toBe(true);
    expect(schema.safeParse({ ...base, responseText: '第二个，住两晚' }).success).toBe(true);
    expect(
      schema.safeParse({ ...base, answers: { hotel: 'hotel-2' }, responseText: '第二个' }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ ...base, answers: { hotel: 'hotel-2' }, ownerEmployeeId: 'someone' })
        .success,
    ).toBe(false);
  });

  it('streams a strict business execution update through the existing run event envelope', () => {
    expect(
      contracts.agentRunEventSchema.safeParse({
        id: ID.event,
        runId: ID.run,
        conversationId: ID.conversation,
        createdAt: '2026-08-13T00:01:00.000Z',
        type: 'business_execution_updated',
        execution: businessExecution,
      }).success,
    ).toBe(true);
  });

  it('distinguishes failed tools and categorized run failures without public technical details', () => {
    expect(
      contracts.agentRunEventSchema.safeParse({
        id: ID.event,
        runId: ID.run,
        conversationId: ID.conversation,
        createdAt: '2026-08-13T00:01:00.000Z',
        type: 'tool_failed',
        toolCallId: 'query-1',
        toolName: 'query_hotel_operating_data_sql',
        code: 'query_rejected',
        summary: '查询未通过安全校验',
      }).success,
    ).toBe(true);
    expect(
      contracts.agentRunEventSchema.safeParse({
        id: ID.event,
        runId: ID.run,
        conversationId: ID.conversation,
        createdAt: '2026-08-13T00:01:00.000Z',
        type: 'run_failed',
        code: 'data_source_timeout',
        message: '经营数据查询超时，请缩小查询范围后重试。',
        recovery: 'retry',
        retryable: true,
      }).success,
    ).toBe(true);
    expect(
      contracts.agentRunEventSchema.safeParse({
        id: ID.event,
        runId: ID.run,
        conversationId: ID.conversation,
        createdAt: '2026-08-13T00:01:00.000Z',
        type: 'tool_failed',
        toolCallId: 'query-1',
        toolName: 'query_hotel_operating_data_sql',
        code: 'query_rejected',
        summary: '查询未通过安全校验',
        sql: 'DELETE FROM hotel',
      }).success,
    ).toBe(false);
  });

  it('keeps legacy persisted run failures readable', () => {
    expect(
      contracts.agentRunEventSchema.safeParse({
        id: ID.event,
        runId: ID.run,
        conversationId: ID.conversation,
        createdAt: '2026-08-13T00:01:00.000Z',
        type: 'run_failed',
        message: '历史失败信息',
        retryable: true,
      }).success,
    ).toBe(true);
  });
});
