import { createRequire } from 'node:module';
import { z } from 'zod';

export const mcpCapabilitySchema = z.enum(['weather', 'hotel_rates', 'hotel_data']);
export type McpCapability = z.infer<typeof mcpCapabilitySchema>;

export const HOTEL_DATA_MCP_SERVER_NAME = 'aliyun-dms-hotel-data';
const HOTEL_DATA_MCP_URL = 'https://dms-mcpr-bfobse-vcyndjbctk.cn-hangzhou.fcapp.run/sse';

const mcpMetadataSchema = z.object({
	capabilities: z.array(mcpCapabilitySchema).default([])
});
const httpMcpServerSchema = z
	.strictObject({
		transport: z.enum(['http', 'sse']),
		url: z.string().url(),
		headers: z.record(z.string(), z.string()).optional()
	})
	.and(mcpMetadataSchema);
const stdioMcpServerSchema = z
	.strictObject({
		transport: z.literal('stdio'),
		command: z.string().min(1),
		args: z.array(z.string()).default([]),
		env: z.record(z.string(), z.string()).optional()
	})
	.and(mcpMetadataSchema);
const mcpServerSchema = z.union([httpMcpServerSchema, stdioMcpServerSchema]);

export type McpServerConfig = z.infer<typeof mcpServerSchema>;

function isLoopback(url: URL): boolean {
	return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
}

export function parseMcpServers(
	raw: string | undefined
): Readonly<Record<string, McpServerConfig>> {
	if (!raw?.trim()) return {};
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch (cause) {
		throw new Error('AI_MCP_SERVERS_JSON must be valid JSON', { cause });
	}
	const parsed = z.record(z.string().regex(/^[a-zA-Z0-9_-]+$/), mcpServerSchema).parse(value);
	for (const server of Object.values(parsed)) {
		if (server.transport === 'stdio') continue;
		const url = new URL(server.url);
		if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url))) {
			throw new Error('Remote MCP server URLs must use HTTPS');
		}
	}
	return parsed;
}

export type AgentEnvironment = Readonly<{
	apiKey: string;
	baseUrl: string;
	model: string;
	mcpServers: Readonly<Record<string, McpServerConfig>>;
}>;

function parseKimiBaseUrl(raw: string | undefined): string {
	const value = raw?.trim() || 'https://api.moonshot.cn/v1';
	const url = new URL(value);
	if (url.protocol !== 'https:') throw new Error('AI_KIMI_BASE_URL must use HTTPS');
	return url.toString().replace(/\/$/, '');
}

function publicWeatherServer(): McpServerConfig {
	return {
		transport: 'stdio',
		command: process.execPath,
		args: [createRequire(import.meta.url).resolve('@dangahagan/weather-mcp')],
		env: {
			ENABLED_TOOLS: 'basic,+air_quality',
			WEATHER_UNITS: 'metric',
			WEATHER_TIME_FORMAT: '24h',
			LOG_LEVEL: '2'
		},
		capabilities: ['weather']
	};
}

function hotelDataServer(token: string): McpServerConfig {
	if (/\r|\n/.test(token)) throw new Error('AI_DMS_MCP_BEARER_TOKEN contains invalid characters');
	const credential = token.replace(/^Bearer\s+/i, '').trim();
	if (!credential) throw new Error('AI_DMS_MCP_BEARER_TOKEN is empty');
	return {
		transport: 'sse',
		url: HOTEL_DATA_MCP_URL,
		headers: { Authorization: `Bearer ${credential}` },
		capabilities: ['hotel_data']
	};
}

export function readAgentEnvironment(environment: NodeJS.ProcessEnv): AgentEnvironment {
	const configuredServers = parseMcpServers(environment.AI_MCP_SERVERS_JSON);
	const publicWeatherEnabled = !['0', 'false', 'no', 'off'].includes(
		(environment.AI_PUBLIC_WEATHER_MCP_ENABLED ?? '').trim().toLowerCase()
	);
	const dmsBearerToken = environment.AI_DMS_MCP_BEARER_TOKEN?.trim() ?? '';
	const bundledServers: Record<string, McpServerConfig> = { ...configuredServers };
	if (publicWeatherEnabled) bundledServers['public-weather'] = publicWeatherServer();
	if (dmsBearerToken) bundledServers[HOTEL_DATA_MCP_SERVER_NAME] = hotelDataServer(dmsBearerToken);
	return {
		apiKey: environment.AI_KIMI_API_KEY?.trim() ?? '',
		baseUrl: parseKimiBaseUrl(environment.AI_KIMI_BASE_URL),
		model: environment.AI_KIMI_MODEL?.trim() || 'kimi-k3',
		mcpServers: bundledServers
	};
}
