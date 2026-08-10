import { describe, expect, it } from 'vitest';
import { parseMcpServers, readAgentEnvironment } from './agent-config';

describe('agent configuration', () => {
	it('defaults to Kimi K3 and keeps MCP writes disabled', () => {
		expect(
			readAgentEnvironment({
				AI_KIMI_API_KEY: 'secret',
				AI_PUBLIC_WEATHER_MCP_ENABLED: 'false'
			})
		).toEqual({
			apiKey: 'secret',
			baseUrl: 'https://api.moonshot.cn/v1',
			model: 'kimi-k3',
			mcpServers: {},
			allowMcpWriteTools: false
		});
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
});
