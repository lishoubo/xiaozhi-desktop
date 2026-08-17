import { describe, expect, it, vi } from 'vitest';
import { HotelAgentToolHandlers } from './hotel-agent-tool-handlers';

const principal = { employeeId: 'employee-1', orgId: 'org-1' };

describe('HotelAgentToolHandlers', () => {
	it('delegates employee-scoped memory operations to the repository', async () => {
		const remember = vi.fn().mockResolvedValue(undefined);
		const handlers = new HotelAgentToolHandlers({ remember });

		await expect(
			handlers.remember(principal, {
				key: 'report.language',
				content: '使用中文',
				importance: 3
			})
		).resolves.toBe('已保存到当前员工的长期记忆。');
		expect(remember).toHaveBeenCalledWith(principal, {
			key: 'report.language',
			content: '使用中文',
			importance: 3
		});
	});

	it('validates generated UI before returning it to an SDK adapter', () => {
		const handlers = new HotelAgentToolHandlers({
			remember: vi.fn()
		});

		expect(() =>
			handlers.renderUi({
				root: 'root',
				state: {},
				elements: {
					root: { type: 'Script', props: {}, children: [], visible: true }
				}
			})
		).toThrow('component is not allowed');
	});
});
