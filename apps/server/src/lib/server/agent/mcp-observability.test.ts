import { describe, expect, it } from 'vitest';
import { mcpResultIsError, summarizeMcpResult } from './mcp-observability';

describe('MCP result protocol status', () => {
	it('recognizes a DMS SQL engine diagnostic returned as ordinary text', () => {
		const result = [
			{
				type: 'text',
				text: "Unknown column 'store_page_visit_cnt' in 'field list' 【解决方案】请检查SQL"
			}
		];

		expect(mcpResultIsError(result)).toBe(true);
		expect(summarizeMcpResult(result).protocolStatus).toBe('error');
	});

	it('recognizes a compacted JSON-encoded MCP text block as an error', () => {
		const result = JSON.stringify([
			{
				type: 'text',
				text: "Unknown column 'trade_user_cnt' in 'field list' 【解决方案】请检查SQL",
				structuredContent: {
					result: "Unknown column 'trade_user_cnt' in 'field list' 【解决方案】请检查SQL"
				}
			}
		]);

		expect(mcpResultIsError(result)).toBe(true);
		expect(summarizeMcpResult(result).protocolStatus).toBe('error');
	});

	it('does not mistake tabular business data containing error fields for a tool failure', () => {
		const result =
			'| status | error_message |\n| --- | --- |\n| FAILED | Unknown column reported by OTA |';

		expect(mcpResultIsError(result)).toBe(false);
	});
});
