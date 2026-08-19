import type { AgentMessage, AgentPrincipal } from '@hotel-butler/api';
import { describe, expect, it, vi } from 'vitest';
import {
	ConversationContextService,
	contextPolicyForModel,
	estimateConversationTokens
} from './conversation-context';

const principal: AgentPrincipal = { employeeId: 'employee-1', orgId: 'org-1' };

function message(index: number, content = `message-${index}`): AgentMessage {
	return {
		id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
		conversationId: '10000000-0000-4000-8000-000000000000',
		role: index % 2 === 0 ? 'assistant' : 'user',
		content,
		ui: null,
		createdAt: new Date(Date.UTC(2026, 7, 12, 0, 0, index)).toISOString()
	};
}

describe('conversation context policy', () => {
	it('uses the measured Kimi K3 context window with a conservative trigger', () => {
		expect(contextPolicyForModel('kimi-k3')).toEqual({
			contextWindowTokens: 1_048_576,
			triggerTokens: 262_144,
			recentTokenTarget: 32_768,
			minimumRecentMessages: 8,
			summaryMaxTokens: 4_096
		});
	});

	it('uses the documented Kimi K2.6 context window for the fast tier', () => {
		expect(contextPolicyForModel('kimi-k2.6')).toEqual({
			contextWindowTokens: 262_144,
			triggerTokens: 65_536,
			recentTokenTarget: 16_384,
			minimumRecentMessages: 8,
			summaryMaxTokens: 4_096
		});
	});

	it('estimates Chinese and ASCII content without depending on an SDK tokenizer', () => {
		expect(estimateConversationTokens('酒店入住率')).toBe(5);
		expect(estimateConversationTokens('occupancy rate')).toBe(4);
	});
});

describe('ConversationContextService', () => {
	it('returns all unsummarized messages below the trigger', async () => {
		const messages = [message(1), message(2)];
		const repository = {
			getConversationContext: vi.fn().mockResolvedValue({
				conversationId: messages[0].conversationId,
				summary: null,
				summarizedThroughMessageId: null,
				messages
			}),
			saveConversationSummary: vi.fn()
		};
		const generator = { summarize: vi.fn() };
		const service = new ConversationContextService(repository, generator, {
			...contextPolicyForModel('unknown'),
			triggerTokens: 100
		});

		await expect(service.prepare(principal, messages[0].conversationId)).resolves.toEqual({
			summary: null,
			history: messages
		});
		expect(generator.summarize).not.toHaveBeenCalled();
	});

	it('summarizes older messages and keeps recent messages verbatim', async () => {
		const messages = Array.from({ length: 12 }, (_, index) => message(index + 1, '酒店经营数据'));
		const repository = {
			getConversationContext: vi.fn().mockResolvedValue({
				conversationId: messages[0].conversationId,
				summary: null,
				summarizedThroughMessageId: null,
				messages
			}),
			saveConversationSummary: vi.fn().mockResolvedValue(true)
		};
		const generator = { summarize: vi.fn().mockResolvedValue('首次会话摘要') };
		const service = new ConversationContextService(repository, generator, {
			contextWindowTokens: 100,
			triggerTokens: 20,
			recentTokenTarget: 8,
			minimumRecentMessages: 4,
			summaryMaxTokens: 10
		});

		const prepared = await service.prepare(principal, messages[0].conversationId);

		expect(prepared.summary).toBe('首次会话摘要');
		expect(prepared.history).toEqual(messages.slice(-4));
		expect(generator.summarize).toHaveBeenCalledWith({
			previousSummary: null,
			messages: messages.slice(0, -4),
			maxTokens: 10
		});
		expect(repository.saveConversationSummary).toHaveBeenCalledWith(principal, {
			conversationId: messages[0].conversationId,
			expectedThroughMessageId: null,
			summary: '首次会话摘要',
			throughMessageId: messages.at(-5)?.id
		});
	});

	it('merges an existing summary with only newly eligible messages', async () => {
		const messages = Array.from({ length: 16 }, (_, index) => message(index + 1, '经营异常明细'));
		const repository = {
			getConversationContext: vi.fn().mockResolvedValue({
				conversationId: messages[0].conversationId,
				summary: '旧摘要',
				summarizedThroughMessageId: messages[3].id,
				messages
			}),
			saveConversationSummary: vi.fn().mockResolvedValue(true)
		};
		const generator = { summarize: vi.fn().mockResolvedValue('增量摘要') };
		const service = new ConversationContextService(repository, generator, {
			contextWindowTokens: 100,
			triggerTokens: 20,
			recentTokenTarget: 8,
			minimumRecentMessages: 4,
			summaryMaxTokens: 10
		});

		const prepared = await service.prepare(principal, messages[0].conversationId);

		expect(prepared).toEqual({ summary: '增量摘要', history: messages.slice(-4) });
		expect(generator.summarize).toHaveBeenCalledWith({
			previousSummary: '旧摘要',
			messages: messages.slice(4, -4),
			maxTokens: 10
		});
	});
});
