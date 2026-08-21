import { describe, expect, it } from 'vitest';
import { describeAgentFailure, describeToolFailure } from './agent-failure';
import { AgentConfigurationError, AgentProtocolError, AgentUpstreamError } from './agent-effect';
import { AgentQueryRejectedError } from './agent-query-error';

describe('agent failure presentation', () => {
	it('classifies a query policy rejection without exposing internal details', () => {
		const failure = describeToolFailure(
			'query_hotel_operating_data_sql',
			new Error('经营数据 SQL 不允许 UPDATE secret_table SET password = 1')
		);

		expect(failure).toEqual({
			code: 'query_rejected',
			message: '生成的数据查询未通过安全校验，已停止执行。请换一种说法或缩小查询范围后再试。',
			recovery: 'revise_request',
			retryable: false
		});
		expect(failure.message).not.toContain('secret_table');
	});

	it('preserves a typed query rejection through an upstream cause', () => {
		const failure = describeAgentFailure(
			new AgentUpstreamError({
				service: 'mcp',
				operation: 'query_hotel_operating_data_sql',
				kind: 'invalid_response',
				cause: new AgentQueryRejectedError('private SQL diagnostics')
			})
		);

		expect(failure).toMatchObject({ code: 'query_rejected', recovery: 'revise_request' });
		expect(failure.message).not.toContain('private SQL diagnostics');
	});

	it('distinguishes data timeouts from administrator configuration failures', () => {
		expect(
			describeAgentFailure(
				new AgentUpstreamError({
					service: 'mcp',
					operation: 'query_hotel_operating_data_sql',
					kind: 'timeout'
				})
			)
		).toMatchObject({ code: 'data_source_timeout', recovery: 'retry', retryable: true });
		expect(
			describeAgentFailure(new AgentConfigurationError({ setting: 'HOTEL_DATA_MCP_URL' }))
		).toMatchObject({
			code: 'configuration_error',
			recovery: 'contact_admin',
			retryable: false
		});
	});

	it('preserves configuration and protocol failures through wrapper causes', () => {
		expect(
			describeAgentFailure(
				new AgentUpstreamError({
					service: 'mcp',
					operation: 'load_tool_catalog',
					kind: 'unavailable',
					cause: new AgentConfigurationError({ setting: 'HOTEL_DATA_MCP_URL' })
				})
			)
		).toMatchObject({ code: 'configuration_error', recovery: 'contact_admin', retryable: false });
		expect(
			describeAgentFailure(
				new AgentUpstreamError({
					service: 'model',
					operation: 'run_agent_stream',
					kind: 'invalid_response',
					cause: new AgentProtocolError({ operation: 'workflow', reason: 'invalid state' })
				})
			)
		).toMatchObject({
			code: 'execution_protocol_error',
			recovery: 'contact_admin',
			retryable: false
		});
	});

	it('distinguishes an MCP connection failure from an invalid query result', () => {
		expect(
			describeToolFailure('query_hotel_operating_data_sql', {
				isError: true,
				content: [{ type: 'text', text: 'connection refused by upstream service' }]
			})
		).toMatchObject({ code: 'data_source_unavailable', recovery: 'retry' });
		expect(
			describeToolFailure('query_hotel_operating_data_sql', {
				isError: true,
				content: [{ type: 'text', text: 'SQL syntax error near FROM' }]
			})
		).toMatchObject({ code: 'query_invalid', recovery: 'revise_request' });
	});
});
