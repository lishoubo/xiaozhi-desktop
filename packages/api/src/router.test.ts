import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { appRouter } from './router';
import type { AgentGateway } from './router';

describe('appRouter', () => {
  const activeEmployee = {
    id: '9007199254740993',
    orgId: '42',
    username: 'front-desk-1',
    fullName: '测试员工',
    phone: '13800138000',
    roleCode: 'FRONT_DESK',
  } as const;

  function createCaller({
    requestPhoneCode = vi.fn().mockResolvedValue({ accepted: true, expiresInSeconds: 300 }),
    loginWithPhoneCode = vi.fn().mockResolvedValue(activeEmployee),
    currentSession = vi.fn().mockResolvedValue(null),
    logout = vi.fn().mockResolvedValue({ success: true }),
    health = vi.fn().mockReturnValue({
      status: 'ok',
      authentication: {
        staff: true,
        phone: true,
        phoneIdentitySourceConfigured: true,
      },
    }),
    logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    agent = {
      capabilities: vi.fn(),
      quickActions: vi.fn(),
      listConversations: vi.fn(),
      createConversation: vi.fn(),
      getConversation: vi.fn(),
      deleteConversation: vi.fn(),
      clearConversations: vi.fn(),
      startRun: vi.fn(),
      cancelRun: vi.fn(),
      retryRun: vi.fn(),
      submitClarification: vi.fn(),
      cancelBusinessExecution: vi.fn(),
      events: vi.fn(),
    } as AgentGateway,
    agentPrincipal = vi.fn().mockResolvedValue(null),
  } = {}) {
    return appRouter.createCaller({
      agent,
      agentPrincipal,
      desktopApi: { requestPhoneCode, loginWithPhoneCode, currentSession, logout, health },
      logger,
      requestId: 'request-123',
    });
  }

  it('reports the server transport as healthy', async () => {
    const debug = vi.fn();
    const caller = createCaller({
      logger: {
        debug,
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    });

    await expect(caller.system.health()).resolves.toEqual({
      status: 'ok',
      authentication: {
        staff: true,
        phone: true,
        phoneIdentitySourceConfigured: true,
      },
    });
    expect(debug).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'trpc.procedure.completed',
        procedure: 'system.health',
        procedureType: 'query',
        requestId: 'request-123',
      }),
      'tRPC procedure completed',
    );
    expect(JSON.stringify(debug.mock.calls)).not.toContain('input');
  });

  it('delegates validated auth calls to the request-scoped desktop endpoint', async () => {
    const requestPhoneCode = vi
      .fn()
      .mockResolvedValue({ accepted: true, expiresInSeconds: 300 });
    const loginWithPhoneCode = vi.fn().mockResolvedValue(activeEmployee);
    const caller = createCaller({
      requestPhoneCode,
      loginWithPhoneCode,
    });

    await expect(caller.auth.requestPhoneCode({ phone: '13800138000' })).resolves.toEqual({
      accepted: true,
      expiresInSeconds: 300,
    });
    await expect(
      caller.auth.loginWithPhoneCode({ phone: '13800138000', code: '654321' }),
    ).resolves.toEqual(activeEmployee);
    expect(requestPhoneCode).toHaveBeenCalledWith({ phone: '13800138000' });
    expect(loginWithPhoneCode).toHaveBeenCalledWith({
      phone: '13800138000',
      code: '654321',
    });
  });

  it('derives Agent ownership from the authenticated session and never from client input', async () => {
    const getConversation = vi.fn().mockResolvedValue({
      conversation: {
        id: '11111111-1111-4111-8111-111111111111',
        title: '用户 A 会话',
        activeRunId: null,
        createdAt: '2026-08-10T00:00:00.000Z',
        updatedAt: '2026-08-10T00:00:00.000Z',
      },
      messages: [],
      executions: [],
      activeRun: null,
    });
    const agent = {
      capabilities: vi.fn(),
      quickActions: vi.fn(),
      listConversations: vi.fn(),
      createConversation: vi.fn(),
      getConversation,
      deleteConversation: vi.fn(),
      clearConversations: vi.fn(),
      startRun: vi.fn(),
      cancelRun: vi.fn(),
      retryRun: vi.fn(),
      submitClarification: vi.fn(),
      cancelBusinessExecution: vi.fn(),
      events: vi.fn(),
    } as AgentGateway;
    const principal = { employeeId: '1001', orgId: '42' } as const;
    const caller = createCaller({
      agent,
      agentPrincipal: vi.fn().mockResolvedValue(principal),
    });

    await caller.agent.getConversation({
      conversationId: '11111111-1111-4111-8111-111111111111',
    });

    expect(getConversation).toHaveBeenCalledWith(principal, '11111111-1111-4111-8111-111111111111');
    await expect(
      caller.agent.getConversation({
        conversationId: '11111111-1111-4111-8111-111111111111',
        ownerEmployeeId: '2002',
      } as never),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('routes run cancellation through the authenticated principal', async () => {
    const principal = { employeeId: '1001', orgId: '42' } as const;
    const runId = '33333333-3333-4333-8333-333333333333';
    const cancelRun = vi.fn().mockResolvedValue({ runId, status: 'cancelled' });
    const agent = {
      capabilities: vi.fn(),
      quickActions: vi.fn(),
      listConversations: vi.fn(),
      createConversation: vi.fn(),
      getConversation: vi.fn(),
      deleteConversation: vi.fn(),
      clearConversations: vi.fn(),
      startRun: vi.fn(),
      cancelRun,
      retryRun: vi.fn(),
      submitClarification: vi.fn(),
      cancelBusinessExecution: vi.fn(),
      events: vi.fn(),
    } as AgentGateway;
    const caller = createCaller({
      agent,
      agentPrincipal: vi.fn().mockResolvedValue(principal),
    });

    await expect(caller.agent.cancelRun({ runId })).resolves.toEqual({
      runId,
      status: 'cancelled',
    });
    expect(cancelRun).toHaveBeenCalledWith(principal, runId);
  });

  it('routes run retry through the authenticated principal', async () => {
    const principal = { employeeId: '1001', orgId: '42' } as const;
    const failedRunId = '33333333-3333-4333-8333-333333333333';
    const clientRequestId = '55555555-5555-4555-8555-555555555555';
    const retryRun = vi.fn().mockResolvedValue({
      runId: '77777777-7777-4777-8777-777777777777',
      businessExecutionId: '88888888-8888-4888-8888-888888888888',
      userMessage: {
        id: '22222222-2222-4222-8222-222222222222',
        conversationId: '44444444-4444-4444-8444-444444444444',
        businessExecutionId: '88888888-8888-4888-8888-888888888888',
        role: 'user',
        content: '重新尝试上次请求',
        ui: null,
        createdAt: '2026-08-13T00:00:00.000Z',
      },
    });
    const caller = createCaller({
      agent: {
        capabilities: vi.fn(),
        quickActions: vi.fn(),
        listConversations: vi.fn(),
        createConversation: vi.fn(),
        getConversation: vi.fn(),
        deleteConversation: vi.fn(),
        clearConversations: vi.fn(),
        startRun: vi.fn(),
        cancelRun: vi.fn(),
        retryRun,
        submitClarification: vi.fn(),
        cancelBusinessExecution: vi.fn(),
        events: vi.fn(),
      },
      agentPrincipal: vi.fn().mockResolvedValue(principal),
    });

    await caller.agent.retryRun({ failedRunId, clientRequestId });

    expect(retryRun).toHaveBeenCalledWith(principal, { failedRunId, clientRequestId });
  });

  it('routes clarification and waiting-execution cancellation through the authenticated principal', async () => {
    const principal = { employeeId: '1001', orgId: '42' } as const;
    const businessExecutionId = '44444444-4444-4444-8444-444444444444';
    const interactionId = '55555555-5555-4555-8555-555555555555';
    const clientRequestId = '66666666-6666-4666-8666-666666666666';
    const submitClarification = vi.fn().mockResolvedValue({
      runId: '33333333-3333-4333-8333-333333333333',
      businessExecutionId,
      userMessage: {
        id: '22222222-2222-4222-8222-222222222222',
        conversationId: '11111111-1111-4111-8111-111111111111',
        businessExecutionId,
        role: 'user',
        content: '第二个',
        ui: null,
        createdAt: '2026-08-13T00:00:00.000Z',
      },
    });
    const cancelBusinessExecution = vi.fn().mockResolvedValue({
      businessExecutionId,
      status: 'cancelled',
      userMessage: {
        id: '77777777-7777-4777-8777-777777777777',
        conversationId: '11111111-1111-4111-8111-111111111111',
        businessExecutionId,
        role: 'user',
        content: '取消本次任务',
        ui: null,
        createdAt: '2026-08-13T00:00:01.000Z',
      },
      assistantMessage: {
        id: '88888888-8888-4888-8888-888888888888',
        conversationId: '11111111-1111-4111-8111-111111111111',
        businessExecutionId,
        role: 'assistant',
        content: '好的，本次任务已取消。',
        ui: null,
        createdAt: '2026-08-13T00:00:01.001Z',
      },
    });
    const caller = createCaller({
      agent: {
        capabilities: vi.fn(),
        quickActions: vi.fn(),
        listConversations: vi.fn(),
        createConversation: vi.fn(),
        getConversation: vi.fn(),
        deleteConversation: vi.fn(),
        clearConversations: vi.fn(),
        startRun: vi.fn(),
        cancelRun: vi.fn(),
        retryRun: vi.fn(),
        submitClarification,
        cancelBusinessExecution,
        events: vi.fn(),
      },
      agentPrincipal: vi.fn().mockResolvedValue(principal),
    });

    const submission = {
      businessExecutionId,
      interactionId,
      expectedVersion: 3,
      clientRequestId,
      answers: { hotel: 'hotel-2' },
    };
    const submit = Reflect.get(caller.agent, 'submitClarification');
    const cancel = Reflect.get(caller.agent, 'cancelBusinessExecution');
    expect(typeof submit).toBe('function');
    expect(typeof cancel).toBe('function');
    if (typeof submit !== 'function' || typeof cancel !== 'function') return;

    await submit(submission);
    await cancel({ businessExecutionId, expectedVersion: 4 });

    expect(submitClarification).toHaveBeenCalledWith(principal, submission);
    expect(cancelBusinessExecution).toHaveBeenCalledWith(principal, businessExecutionId, 4);
    await expect(submit({ ...submission, ownerEmployeeId: '2002' } as never)).rejects.toMatchObject(
      { code: 'BAD_REQUEST' },
    );
  });

  it('rejects Agent access before calling the gateway when no session principal exists', async () => {
    const getConversation = vi.fn();
    const agent = {
      capabilities: vi.fn(),
      quickActions: vi.fn(),
      listConversations: vi.fn(),
      createConversation: vi.fn(),
      getConversation,
      deleteConversation: vi.fn(),
      clearConversations: vi.fn(),
      startRun: vi.fn(),
      cancelRun: vi.fn(),
      retryRun: vi.fn(),
      submitClarification: vi.fn(),
      cancelBusinessExecution: vi.fn(),
      events: vi.fn(),
    } as AgentGateway;
    const caller = createCaller({ agent });

    await expect(
      caller.agent.getConversation({
        conversationId: '11111111-1111-4111-8111-111111111111',
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(getConversation).not.toHaveBeenCalled();
  });

  it('routes conversation deletion only through the authenticated principal', async () => {
    const deleteConversation = vi.fn().mockResolvedValue({ deletedCount: 1 });
    const clearConversations = vi.fn().mockResolvedValue({ deletedCount: 3 });
    const principal = { employeeId: '1001', orgId: '42' } as const;
    const agent = {
      capabilities: vi.fn(),
      quickActions: vi.fn(),
      listConversations: vi.fn(),
      createConversation: vi.fn(),
      getConversation: vi.fn(),
      deleteConversation,
      clearConversations,
      startRun: vi.fn(),
      cancelRun: vi.fn(),
      retryRun: vi.fn(),
      submitClarification: vi.fn(),
      cancelBusinessExecution: vi.fn(),
      events: vi.fn(),
    } as AgentGateway;
    const caller = createCaller({
      agent,
      agentPrincipal: vi.fn().mockResolvedValue(principal),
    });
    const conversationId = '11111111-1111-4111-8111-111111111111';

    await expect(caller.agent.deleteConversation({ conversationId })).resolves.toEqual({
      deletedCount: 1,
    });
    await expect(caller.agent.clearConversations()).resolves.toEqual({ deletedCount: 3 });

    expect(deleteConversation).toHaveBeenCalledWith(principal, conversationId);
    expect(clearConversations).toHaveBeenCalledWith(principal);
  });

  it('returns the server-owned quick-action catalog and accepts only its identifier', async () => {
    const principal = { employeeId: '1001', orgId: '42' } as const;
    const quickActions = vi.fn().mockResolvedValue([
      {
        id: 'yesterday_operating_review',
        label: '昨日经营复盘',
        description: '查询酒店昨日经营表现',
        category: 'operations',
        requiresMcp: true,
        available: true,
      },
    ]);
    const startRun = vi.fn().mockResolvedValue({
      runId: '33333333-3333-4333-8333-333333333333',
      userMessage: {
        id: '22222222-2222-4222-8222-222222222222',
        conversationId: '11111111-1111-4111-8111-111111111111',
        role: 'user',
        content: '生成交班摘要',
        ui: null,
        createdAt: '2026-08-10T00:00:00.000Z',
      },
    });
    const agent = {
      capabilities: vi.fn(),
      quickActions,
      listConversations: vi.fn(),
      createConversation: vi.fn(),
      getConversation: vi.fn(),
      deleteConversation: vi.fn(),
      clearConversations: vi.fn(),
      startRun,
      cancelRun: vi.fn(),
      retryRun: vi.fn(),
      submitClarification: vi.fn(),
      cancelBusinessExecution: vi.fn(),
      events: vi.fn(),
    } as AgentGateway;
    const caller = createCaller({
      agent,
      agentPrincipal: vi.fn().mockResolvedValue(principal),
    });

    await expect(caller.agent.quickActions()).resolves.toHaveLength(1);
    await caller.agent.startRun({
      conversationId: '11111111-1111-4111-8111-111111111111',
      quickActionId: 'yesterday_operating_review',
      clientRequestId: '44444444-4444-4444-8444-444444444444',
    });

    expect(quickActions).toHaveBeenCalledWith();
    expect(startRun).toHaveBeenCalledWith(principal, {
      conversationId: '11111111-1111-4111-8111-111111111111',
      quickActionId: 'yesterday_operating_review',
      clientRequestId: '44444444-4444-4444-8444-444444444444',
    });
    await expect(
      caller.agent.startRun({
        conversationId: '11111111-1111-4111-8111-111111111111',
        quickActionId: 'yesterday_operating_review',
        prompt: '覆盖服务端提示词',
        clientRequestId: '55555555-5555-4555-8555-555555555555',
      } as never),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('rejects malformed inputs and does not expose a direct identity router', async () => {
    const caller = createCaller();

    await expect(caller.auth.requestPhoneCode({ phone: 'employee-1' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(
      caller.auth.loginWithPhoneCode({ phone: '13800138000', code: '12345' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect('identity' in caller).toBe(false);
  });

  it('does not include auth inputs in successful procedure logs', async () => {
    const info = vi.fn();
    const caller = createCaller({
      logger: { debug: vi.fn(), info, warn: vi.fn(), error: vi.fn() },
    });

    await caller.auth.requestPhoneCode({ phone: '13800138000' });
    await caller.auth.loginWithPhoneCode({ phone: '13800138000', code: '654321' });

    expect(info).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(info.mock.calls)).not.toContain('13800138000');
    expect(JSON.stringify(info.mock.calls)).not.toContain('654321');
  });
});
