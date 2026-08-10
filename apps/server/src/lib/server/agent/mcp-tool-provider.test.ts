import { describe, expect, it } from 'vitest';
import { isReadOnlyMcpToolName } from './mcp-tool-provider';

describe('isReadOnlyMcpToolName', () => {
	it('allows explicit read operations', () => {
		expect(isReadOnlyMcpToolName('reservation.list')).toBe(true);
		expect(isReadOnlyMcpToolName('inventory-check')).toBe(true);
	});

	it('rejects disguised or explicit write operations', () => {
		expect(isReadOnlyMcpToolName('reservation.get_and_delete')).toBe(false);
		expect(isReadOnlyMcpToolName('inventory.update')).toBe(false);
		expect(isReadOnlyMcpToolName('refund.execute')).toBe(false);
	});
});
