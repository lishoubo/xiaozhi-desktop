import { appRouter, type ApiContext } from '@hotel-butler/api/router';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { randomBytes, randomUUID } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import {
	createDesktopSessionGateway,
	DESKTOP_SESSION_COOKIE_NAME
} from '$lib/server/desktop-session';
import { DrizzleDesktopSessionRepository } from '$lib/server/desktop-session-repository';
import { createDesktopApiEndpoint } from '$lib/server/desktop-api-endpoint';
import { initializeServerAuthResources } from '$lib/server/server-auth-resources-runtime';
import { logTrpcFailure } from '$lib/server/logging/trpc-logging';
import { serverLogger } from '$lib/server/logging/logger';
import { AgentRepository } from '$lib/server/agent/agent-repository';
import { readAgentEnvironment } from '$lib/server/agent/agent-config';
import { EmptySkillProvider } from '$lib/server/agent/skill-provider';
import { McpToolProvider } from '$lib/server/agent/mcp-tool-provider';
import { LangChainAgentRuntime } from '$lib/server/agent/langchain-agent-runtime';
import { LangChainModelGateway } from '$lib/server/agent/model-gateway';
import {
	ConversationContextService,
	contextPolicyForModel
} from '$lib/server/agent/conversation-context';
import { LangChainConversationSummaryGenerator } from '$lib/server/agent/langchain-conversation-summary-generator';
import { LangChainConversationTitleGenerator } from '$lib/server/agent/langchain-conversation-title-generator';
import { HotelAgentGateway } from '$lib/server/agent/agent-gateway';
import { BusinessIntentRouter } from '$lib/server/agent/execution/business-intent-router';
import { LangChainRouteClassifier } from '$lib/server/agent/execution/langchain-route-classifier';
import { BusinessSlotResolver } from '$lib/server/agent/execution/slot-resolver';
import { DmsHotelReferenceResolver } from '$lib/server/agent/execution/dms-hotel-reference-resolver';
import { DeterministicWorkflowCollector } from '$lib/server/agent/execution/deterministic-workflow-collector';
import { resolveStaffAgentPrincipal } from '$lib/server/agent/staff-agent-principal';
import type { RequestHandler } from './$types';

const endpoint = '/api/trpc';
const desktopSessionRepository = new DrizzleDesktopSessionRepository(db);
const agentEnvironment = readAgentEnvironment(env);
const agentRepository = new AgentRepository(db);
const skillProvider = new EmptySkillProvider();
const modelGateway = new LangChainModelGateway(agentEnvironment, serverLogger);
const mcpToolProvider = new McpToolProvider(
	agentEnvironment.mcpServers,
	agentEnvironment.dmsDatabaseId,
	agentEnvironment.dmsDatabaseName,
	serverLogger
);
const agentRuntime = new LangChainAgentRuntime(
	modelGateway,
	agentRepository,
	mcpToolProvider,
	skillProvider
);
const conversationContext = new ConversationContextService(
	agentRepository,
	new LangChainConversationSummaryGenerator(modelGateway),
	contextPolicyForModel(agentEnvironment.fastModel)
);
const agentGateway = new HotelAgentGateway(
	agentEnvironment,
	agentRepository,
	agentRuntime,
	conversationContext,
	mcpToolProvider,
	skillProvider,
	serverLogger,
	new BusinessIntentRouter(new LangChainRouteClassifier(modelGateway)),
	new BusinessSlotResolver(new DmsHotelReferenceResolver(mcpToolProvider)),
	new DeterministicWorkflowCollector(mcpToolProvider),
	new LangChainConversationTitleGenerator(modelGateway)
);

function requiresPhoneIdentitySource(request: Request): boolean {
	const procedurePath = new URL(request.url).pathname;
	if (procedurePath.includes('/auth.')) return true;
	if (request.headers.has('authorization')) return false;
	return request.headers.get('cookie')?.includes(`${DESKTOP_SESSION_COOKIE_NAME}=`) ?? false;
}

const handleTrpcRequest: RequestHandler = ({ locals, request }) =>
	fetchRequestHandler({
		endpoint,
		req: request,
		router: appRouter,
		createContext: async ({ req, resHeaders }): Promise<ApiContext> => {
			const {
				employeeDirectory,
				employeeHotelAccessDirectory,
				phoneIdentitySourceConfigured,
				phoneOtp
			} = await initializeServerAuthResources({
				waitForRetry: requiresPhoneIdentitySource(req)
			});
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
					if (!employee) return null;
					return {
						employeeId: employee.id,
						orgId: employee.orgId,
						hotelAccess: await employeeHotelAccessDirectory.findByEmployeeId(
							employee.id,
							employee.orgId
						)
					};
				},
				desktopApi: createDesktopApiEndpoint({
					desktopSession,
					employeeDirectory,
					logger: locals.logger,
					phoneOtp,
					phoneIdentitySourceConfigured,
					requestId: locals.requestId
				}),
				logger: locals.logger,
				requestId: locals.requestId
			};
		},
		onError: ({ error, path, type }) =>
			logTrpcFailure(locals.logger, { error, path, type: type ?? 'unknown' })
	});

export const GET = handleTrpcRequest;
export const POST = handleTrpcRequest;
