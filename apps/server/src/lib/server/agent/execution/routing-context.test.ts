import type { AgentMessage } from '@hotel-butler/api';
import { describe, expect, it } from 'vitest';
import { buildRoutingContext } from './routing-context';

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

describe('routing conversation context', () => {
	it('includes the prior failed request but excludes the current continuation message', () => {
		const currentId = '30000000-0000-4000-8000-000000000000';
		const context = buildRoutingContext({
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

	it('always provides bounded history and summary so the classifier decides relevance', () => {
		const context = buildRoutingContext({
			conversationSummary: '旧任务摘要',
			currentMessageId: '30000000-0000-4000-8000-000000000000',
			history: [message('20000000-0000-4000-8000-000000000000', 'user', '查询另一家酒店')]
		});

		expect(context).toContain('旧任务摘要');
		expect(context).toContain('查询另一家酒店');
	});

	it('provides prior user and assistant turns for natural follow-ups', () => {
		const currentId = '30000000-0000-4000-8000-000000000000';
		const history = [
			message('20000000-0000-4000-8000-000000000000', 'user', '酒店运营经理是什么角色？'),
			message(
				'21000000-0000-4000-8000-000000000000',
				'assistant',
				'酒店运营经理负责统筹酒店日常经营。'
			),
			message(currentId, 'user', '他平时一般干些什么工作呢？')
		];

		expect(
			buildRoutingContext({
				conversationSummary: null,
				currentMessageId: currentId,
				history
			})
		).toContain('酒店运营经理是什么角色');
	});

	it('makes bounded employee memory available alongside recent conversation messages', () => {
		const context = buildRoutingContext({
			conversationSummary: '旧会话摘要',
			currentMessageId: '30000000-0000-4000-8000-000000000000',
			history: [message('20000000-0000-4000-8000-000000000000', 'user', '查询另一家酒店')],
			memories: [{ key: 'default.hotel', content: '默认酒店是西湖店', importance: 4 }]
		});

		expect(context).toContain('默认酒店是西湖店');
		expect(context).toContain('查询另一家酒店');
		expect(context).toContain('旧会话摘要');
	});

	it('limits routing history to the most recent eight messages', () => {
		const context = buildRoutingContext({
			conversationSummary: null,
			currentMessageId: '30000000-0000-4000-8000-000000000000',
			history: Array.from({ length: 10 }, (_, index) =>
				message(
					`${String(index + 1).padStart(8, '0')}-0000-4000-8000-000000000000`,
					'user',
					`历史消息 ${index + 1}`
				)
			)
		});

		expect(context).not.toContain('历史消息 1"');
		expect(context).not.toContain('历史消息 2"');
		expect(context).toContain('历史消息 3');
		expect(context).toContain('历史消息 10');
	});
});
