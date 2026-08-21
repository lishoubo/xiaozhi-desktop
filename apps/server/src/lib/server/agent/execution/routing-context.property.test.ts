import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { AgentMessage } from '@hotel-butler/api';
import { buildRoutingContext } from './routing-context';

function message(index: number, content: string): AgentMessage {
	return {
		id: `${String(index).padStart(8, '0')}-0000-4000-8000-000000000000`,
		conversationId: '10000000-0000-4000-8000-000000000000',
		role: index % 2 === 0 ? 'user' : 'assistant',
		content,
		ui: null,
		createdAt: '2026-08-19T00:00:00.000Z'
	};
}

describe('routing context properties', () => {
	it('keeps only the latest eight non-empty prior messages and never includes the current turn', () => {
		fc.assert(
			fc.property(
				fc.array(fc.string({ minLength: 1, maxLength: 80 }), {
					minLength: 1,
					maxLength: 30
				}),
				(contents) => {
					const current = message(contents.length + 1, 'CURRENT_TURN_MUST_NOT_LEAK');
					const nonEmptyContents = contents.filter((content) => content.trim().length > 0);
					const context = buildRoutingContext({
						conversationSummary: null,
						currentMessageId: current.id,
						history: [...contents.map((content, index) => message(index + 1, content)), current]
					});
					if (nonEmptyContents.length === 0) {
						expect(context).toBeNull();
						return;
					}
					expect(context).not.toBeNull();
					const parsed: unknown = JSON.parse(context ?? '{}');
					expect(parsed).toMatchObject({ recentMessages: expect.any(Array) });
					if (
						typeof parsed !== 'object' ||
						parsed === null ||
						!Array.isArray(Reflect.get(parsed, 'recentMessages'))
					)
						return;
					const recentMessages = Reflect.get(parsed, 'recentMessages');
					expect(recentMessages).toHaveLength(Math.min(nonEmptyContents.length, 8));
					expect(JSON.stringify(recentMessages)).not.toContain('CURRENT_TURN_MUST_NOT_LEAK');
				}
			)
		);
	});

	it('bounds every message, summary and memory regardless of generated input size', () => {
		fc.assert(
			fc.property(
				fc.string({ minLength: 2_001, maxLength: 5_000 }),
				fc.string({ minLength: 8_001, maxLength: 12_000 }),
				fc.array(fc.string({ minLength: 1_001, maxLength: 2_000 }), {
					minLength: 13,
					maxLength: 20
				}),
				(messageContent, summary, memoryContents) => {
					const context = buildRoutingContext({
						conversationSummary: summary,
						currentMessageId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
						history: [message(1, messageContent)],
						memories: memoryContents.map((content, index) => ({
							key: `memory-${index}`,
							content,
							importance: 1
						}))
					});
					const parsed: unknown = JSON.parse(context ?? '{}');
					if (typeof parsed !== 'object' || parsed === null) return;
					const recentMessages = Reflect.get(parsed, 'recentMessages');
					const memories = Reflect.get(parsed, 'memories');
					const boundedSummary = Reflect.get(parsed, 'summary');
					expect(
						typeof boundedSummary === 'string' ? boundedSummary.length : 0
					).toBeLessThanOrEqual(8_000);
					expect(Array.isArray(recentMessages) ? recentMessages : []).toHaveLength(1);
					if (Array.isArray(recentMessages)) {
						const content = Reflect.get(recentMessages[0], 'content');
						expect(typeof content === 'string' ? content.length : 0).toBeLessThanOrEqual(2_000);
					}
					expect(Array.isArray(memories) ? memories.length : 0).toBeLessThanOrEqual(12);
					if (Array.isArray(memories)) {
						for (const memory of memories) {
							const content = Reflect.get(memory, 'content');
							expect(typeof content === 'string' ? content.length : 0).toBeLessThanOrEqual(1_000);
						}
					}
				}
			),
			{ numRuns: 50 }
		);
	});
});
