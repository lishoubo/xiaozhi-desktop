import { appRouter, type ApiContext } from '@hotel-butler/api';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { randomBytes, randomUUID } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { createDesktopSessionGateway } from '$lib/server/desktop-session';
import { DrizzleDesktopSessionRepository } from '$lib/server/desktop-session-repository';
import { createServerAuthResources } from '$lib/server/server-auth-resources';
import { logTrpcFailure } from '$lib/server/logging/trpc-logging';
import { serverLogger } from '$lib/server/logging/logger';
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
import { BusinessIntentRouter } from '$lib/server/agent/execution/business-intent-router';
import { LangChainRouteClassifier } from '$lib/server/agent/execution/langchain-route-classifier';
import { BusinessSlotResolver } from '$lib/server/agent/execution/slot-resolver';
import { DmsHotelReferenceResolver } from '$lib/server/agent/execution/dms-hotel-reference-resolver';
import { DeterministicWorkflowCollector } from '$lib/server/agent/execution/deterministic-workflow-collector';
import { resolveStaffAgentPrincipal } from '$lib/server/agent/staff-agent-principal';
import type { RequestHandler } from './$types';

const endpoint = '/api/trpc';
const { employeeDirectory, phoneIdentitySourceConfigured, phoneOtp } = createServerAuthResources({
	environment: env,
	logger: serverLogger
});
const desktopSessionRepository = new DrizzleDesktopSessionRepository(db);
const agentEnvironment = readAgentEnvironment(env);
const agentRepository = new AgentRepository(db);
const skillProvider = new EmptySkillProvider();
const mcpToolProvider = new McpToolProvider(
	agentEnvironment.mcpServers,
	agentEnvironment.dmsDatabaseId,
	agentEnvironment.dmsDatabaseName
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
	serverLogger,
	new BusinessIntentRouter(new LangChainRouteClassifier(agentEnvironment)),
	new BusinessSlotResolver(new DmsHotelReferenceResolver(mcpToolProvider)),
	new DeterministicWorkflowCollector(mcpToolProvider)
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
						return resolveStaffAgentPrincipal(authorization, env, globalThis.fetch, {
							logger: locals.logger,
							requestId: locals.requestId
						});
					}
					const employee = await desktopSession.currentEmployee();
					return employee ? { employeeId: employee.id, orgId: employee.orgId } : null;
				},
				desktopSession,
				employeeDirectory,
				phoneOtp,
				phoneIdentitySourceConfigured,
				logger: locals.logger,
				requestId: locals.requestId
			};
		},
		onError: ({ error, path, type }) =>
			logTrpcFailure(locals.logger, { error, path, type: type ?? 'unknown' })
	});

export const GET = handleTrpcRequest;
export const POST = handleTrpcRequest;
