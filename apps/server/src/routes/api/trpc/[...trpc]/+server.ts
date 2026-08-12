import { appRouter, type ApiContext } from '@hotel-butler/api';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { randomBytes, randomUUID } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { rmsClient } from '$lib/server/db/rms';
import { createDesktopSessionGateway } from '$lib/server/desktop-session';
import { DrizzleDesktopSessionRepository } from '$lib/server/desktop-session-repository';
import { createEmployeeIdentityDirectory } from '$lib/server/employee-identity-directory';
import { logTrpcFailure } from '$lib/server/logging/trpc-logging';
import { serverLogger } from '$lib/server/logging/logger';
import { createTemporaryPhoneOtpGateway } from '$lib/server/temporary-phone-otp-gateway';
import { AgentRepository } from '$lib/server/agent/agent-repository';
import { readAgentEnvironment } from '$lib/server/agent/agent-config';
import { EmptySkillProvider } from '$lib/server/agent/skill-provider';
import { McpToolProvider } from '$lib/server/agent/mcp-tool-provider';
import { LangChainAgentRuntime } from '$lib/server/agent/langchain-agent-runtime';
import {
	ConversationContextService,
	contextPolicyForModel
} from '$lib/server/agent/conversation-context';
import { LangChainConversationSummaryGenerator } from '$lib/server/agent/langchain-conversation-summary-generator';
import { HotelAgentGateway } from '$lib/server/agent/agent-gateway';
import { resolveStaffAgentPrincipal } from '$lib/server/agent/staff-agent-principal';
import type { RequestHandler } from './$types';

const endpoint = '/api/trpc';
const employeeDirectory = createEmployeeIdentityDirectory({
	execute: (sql, values) => rmsClient.execute(sql, values)
});
const phoneOtp = createTemporaryPhoneOtpGateway(serverLogger);
const desktopSessionRepository = new DrizzleDesktopSessionRepository(db);
const agentEnvironment = readAgentEnvironment(env);
const agentRepository = new AgentRepository(db);
const skillProvider = new EmptySkillProvider();
const mcpToolProvider = new McpToolProvider(
	agentEnvironment.mcpServers,
	agentEnvironment.allowMcpWriteTools
);
const agentRuntime = new LangChainAgentRuntime(
	agentEnvironment,
	agentRepository,
	mcpToolProvider,
	skillProvider
);
const conversationContext = new ConversationContextService(
	agentRepository,
	new LangChainConversationSummaryGenerator(agentEnvironment),
	contextPolicyForModel(agentEnvironment.model)
);
const agentGateway = new HotelAgentGateway(
	agentEnvironment,
	agentRepository,
	agentRuntime,
	conversationContext,
	mcpToolProvider,
	skillProvider,
	serverLogger
);

const handleTrpcRequest: RequestHandler = ({ locals, request }) =>
	fetchRequestHandler({
		endpoint,
		req: request,
		router: appRouter,
		createContext: ({ req, resHeaders }): ApiContext => {
			const desktopSession = createDesktopSessionGateway({
				employeeDirectory,
				generateId: randomUUID,
				generateToken: () => randomBytes(32).toString('base64url'),
				now: () => new Date(),
				repository: desktopSessionRepository,
				requestHeaders: req.headers,
				responseHeaders: resHeaders
			});
			return {
				agent: agentGateway,
				agentPrincipal: async () => {
					const authorization = req.headers.get('authorization');
					if (authorization) {
						return resolveStaffAgentPrincipal(authorization, env);
					}
					const employee = await desktopSession.currentEmployee();
					return employee ? { employeeId: employee.id, orgId: employee.orgId } : null;
				},
				desktopSession,
				employeeDirectory,
				phoneOtp,
				logger: locals.logger,
				requestId: locals.requestId
			};
		},
		onError: ({ error, path, type }) =>
			logTrpcFailure(locals.logger, { error, path, type: type ?? 'unknown' })
	});

export const GET = handleTrpcRequest;
export const POST = handleTrpcRequest;
