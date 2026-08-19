import { describe, expect, it } from 'vitest';
import { parseMcpServers, readAgentEnvironment } from './agent-config';

describe('agent configuration', () => {
	it('defaults to fast Kimi K2.6 plus analysis K3 and keeps MCP writes disabled', () => {
		expect(
			readAgentEnvironment({
				AI_KIMI_API_KEY: 'secret',
				AI_PUBLIC_WEATHER_MCP_ENABLED: 'false'
			})
		).toEqual({
			apiKey: 'secret',
			baseUrl: 'https://api.moonshot.cn/v1',
			model: 'kimi-k3',
			fastModel: 'kimi-k2.6',
			dmsDatabaseId: null,
			dmsDatabaseName: null,
			mcpServers: {}
		});
	});

	it('overrides the fast and analysis model tiers independently', () => {
		const environment = readAgentEnvironment({
			AI_KIMI_API_KEY: 'secret',
			AI_KIMI_FAST_MODEL: 'custom-fast',
			AI_KIMI_MODEL: 'custom-analysis',
			AI_PUBLIC_WEATHER_MCP_ENABLED: 'false'
		});

		expect(environment.fastModel).toBe('custom-fast');
		expect(environment.model).toBe('custom-analysis');
	});

	it('enables the pinned public weather MCP with metric units by default', () => {
		const environment = readAgentEnvironment({ AI_KIMI_API_KEY: 'secret' });

		expect(environment.mcpServers['public-weather']).toMatchObject({
			transport: 'stdio',
			command: process.execPath,
			capabilities: ['weather'],
			env: { WEATHER_UNITS: 'metric', WEATHER_TIME_FORMAT: '24h' }
		});
	});

	it('accepts an explicit HTTPS endpoint and rejects plaintext model endpoints', () => {
		expect(
			readAgentEnvironment({
				AI_KIMI_API_KEY: 'secret',
				AI_KIMI_BASE_URL: 'https://api.moonshot.ai/v1/'
			}).baseUrl
		).toBe('https://api.moonshot.ai/v1');
		expect(() =>
			readAgentEnvironment({
				AI_KIMI_API_KEY: 'secret',
				AI_KIMI_BASE_URL: 'http://api.moonshot.cn/v1'
			})
		).toThrow('AI_KIMI_BASE_URL must use HTTPS');
	});

	it('rejects plaintext remote MCP endpoints but permits loopback development', () => {
		expect(() =>
			parseMcpServers(JSON.stringify({ rms: { transport: 'http', url: 'http://rms.example/mcp' } }))
		).toThrow('Remote MCP server URLs must use HTTPS');
		expect(
			parseMcpServers(
				JSON.stringify({ local: { transport: 'http', url: 'http://127.0.0.1:9000/mcp' } })
			)
		).toHaveProperty('local.url', 'http://127.0.0.1:9000/mcp');
	});

	it('accepts tagged stdio and hotel-rate MCP capabilities', () => {
		expect(
			parseMcpServers(
				JSON.stringify({
					rates: {
						transport: 'stdio',
						command: 'node',
						args: ['rates.js'],
						capabilities: ['hotel_rates']
					}
				})
			)
		).toHaveProperty('rates.capabilities', ['hotel_rates']);
	});

	it('adds the fixed hotel data MCP only when a server-side token is configured', () => {
		const withoutToken = readAgentEnvironment({
			AI_KIMI_API_KEY: 'secret',
			AI_PUBLIC_WEATHER_MCP_ENABLED: 'false'
		});
		const withToken = readAgentEnvironment({
			AI_KIMI_API_KEY: 'secret',
			AI_PUBLIC_WEATHER_MCP_ENABLED: 'false',
			AI_DMS_MCP_BEARER_TOKEN: 'rotated-token',
			AI_DMS_DATABASE_ID: '81918192',
			AI_DMS_DATABASE_NAME: 'rms_data'
		});

		expect(withoutToken.mcpServers).toEqual({});
		expect(withToken.mcpServers['aliyun-dms-hotel-data']).toEqual({
			transport: 'sse',
			url: 'https://dms-mcpver-vjne-ndunixfhxl.cn-hangzhou.fcapp.run/sse',
			headers: { Authorization: 'Bearer rotated-token' },
			capabilities: ['hotel_data']
		});
		expect(withToken.dmsDatabaseId).toBe('81918192');
		expect(withToken.dmsDatabaseName).toBe('rms_data');
	});

	it('accepts a configurable HTTPS DMS endpoint and rejects plaintext remote endpoints', () => {
		const configured = readAgentEnvironment({
			AI_PUBLIC_WEATHER_MCP_ENABLED: 'false',
			AI_DMS_MCP_BEARER_TOKEN: 'rotated-token',
			AI_DMS_DATABASE_ID: '81918192',
			AI_DMS_DATABASE_NAME: 'rms_data',
			AI_DMS_MCP_URL: 'https://dms.example.com/sse'
		});
		expect(configured.mcpServers['aliyun-dms-hotel-data']).toHaveProperty(
			'url',
			'https://dms.example.com/sse'
		);
		expect(() =>
			readAgentEnvironment({
				AI_DMS_MCP_BEARER_TOKEN: 'rotated-token',
				AI_DMS_DATABASE_ID: '81918192',
				AI_DMS_DATABASE_NAME: 'rms_data',
				AI_DMS_MCP_URL: 'http://dms.example.com/sse'
			})
		).toThrow('AI_DMS_MCP_URL must use HTTPS');
	});

	it('rejects header injection in the DMS token', () => {
		expect(() =>
			readAgentEnvironment({
				AI_KIMI_API_KEY: 'secret',
				AI_DMS_DATABASE_ID: '81918192',
				AI_DMS_DATABASE_NAME: 'rms_data',
				AI_DMS_MCP_BEARER_TOKEN: 'token\nX-Injected: yes'
			})
		).toThrow('contains invalid characters');
	});

	it('requires an exact database name for discovery and accepts an optional pinned id', () => {
		expect(() => readAgentEnvironment({ AI_DMS_MCP_BEARER_TOKEN: 'rotated-token' })).toThrow(
			'AI_DMS_DATABASE_NAME is required'
		);
		expect(
			readAgentEnvironment({
				AI_DMS_MCP_BEARER_TOKEN: 'rotated-token',
				AI_DMS_DATABASE_NAME: 'rms_data'
			}).dmsDatabaseName
		).toBe('rms_data');
		expect(() =>
			readAgentEnvironment({
				AI_DMS_MCP_BEARER_TOKEN: 'rotated-token',
				AI_DMS_DATABASE_ID: 'rms_data',
				AI_DMS_DATABASE_NAME: 'rms_data'
			})
		).toThrow('must be a numeric DMS database ID');
	});

	it('accepts either a raw DMS token or a complete Bearer value', () => {
		const environment = readAgentEnvironment({
			AI_PUBLIC_WEATHER_MCP_ENABLED: 'false',
			AI_DMS_MCP_BEARER_TOKEN: 'Bearer rotated-token',
			AI_DMS_DATABASE_NAME: 'rms_data'
		});

		expect(environment.mcpServers['aliyun-dms-hotel-data']).toHaveProperty(
			'headers.Authorization',
			'Bearer rotated-token'
		);
	});
});
