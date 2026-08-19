import type { AgentMessage } from '@hotel-butler/api';
import { describe, expect, it } from 'vitest';
import { buildRoutingContext, isReferentialContinuation } from './routing-context';

function message(id: string, role: AgentMessage['role'], content: string): AgentMessage {
	return {
		id,
		conversationId: '10000000-0000-4000-8000-000000000000',
		role,
		content,
		ui: null,
		createdAt: '2026-08-19T00:00:00.000Z'
	};
}

describe('routing continuation context', () => {
	it('includes the prior failed request but excludes the current continuation message', () => {
		const currentId = '30000000-0000-4000-8000-000000000000';
		const context = buildRoutingContext({
			prompt: '帮我继续查询',
			conversationSummary: null,
			currentMessageId: currentId,
			history: [
				message(
					'20000000-0000-4000-8000-000000000000',
					'user',
					'查询西湖店 8 月 1 日到 8 月 7 日的入住率'
				),
				message(currentId, 'user', '帮我继续查询')
			]
		});

		expect(context).toContain('查询西湖店 8 月 1 日到 8 月 7 日的入住率');
		expect(context).not.toContain('帮我继续查询');
	});

	it('does not attach stale context to a self-contained new request', () => {
		expect(isReferentialContinuation('继续查询')).toBe(true);
		expect(isReferentialContinuation('那昨天呢')).toBe(true);
		expect(
			buildRoutingContext({
				prompt: '请解释 RevPAR 的定义',
				conversationSummary: '旧任务',
				currentMessageId: '30000000-0000-4000-8000-000000000000',
				history: []
			})
		).toBeNull();
	});

	it('makes bounded employee memory available without inheriting unrelated conversation messages', () => {
		const context = buildRoutingContext({
			prompt: '查询今天的入住率',
			conversationSummary: '旧会话摘要',
			currentMessageId: '30000000-0000-4000-8000-000000000000',
			history: [message('20000000-0000-4000-8000-000000000000', 'user', '查询另一家酒店')],
			memories: [{ key: 'default.hotel', content: '默认酒店是西湖店', importance: 4 }]
		});

		expect(context).toContain('默认酒店是西湖店');
		expect(context).not.toContain('查询另一家酒店');
		expect(context).not.toContain('旧会话摘要');
	});
});
