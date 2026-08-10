import { appRouter, type ApiContext } from '@hotel-butler/api';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { randomBytes, randomUUID } from 'node:crypto';
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
import { HotelAgentRuntime } from '$lib/server/agent/hotel-agent-runtime';
import { HotelAgentGateway } from '$lib/server/agent/agent-gateway';
import { resolveStaffAgentPrincipal } from '$lib/server/agent/staff-agent-principal';
import type { RequestHandler } from './$types';

const endpoint = '/api/trpc';
const employeeDirectory = createEmployeeIdentityDirectory({
	execute: (sql, values) => rmsClient.execute(sql, values)
});
const phoneOtp = createTemporaryPhoneOtpGateway(serverLogger);
const desktopSessionRepository = new DrizzleDesktopSessionRepository(db);
const agentEnvironment = readAgentEnvironment(process.env);
const agentRepository = new AgentRepository(db);
const skillProvider = new EmptySkillProvider();
const mcpToolProvider = new McpToolProvider(
	agentEnvironment.mcpServers,
	agentEnvironment.allowMcpWriteTools
);
const agentRuntime = new HotelAgentRuntime(
	agentEnvironment,
	agentRepository,
	mcpToolProvider,
	skillProvider
);
const agentGateway = new HotelAgentGateway(
	agentEnvironment,
	agentRepository,
	agentRuntime,
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
						return resolveStaffAgentPrincipal(authorization, process.env);
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
