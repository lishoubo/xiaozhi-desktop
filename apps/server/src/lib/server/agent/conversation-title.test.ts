import { describe, expect, it } from 'vitest';
import {
	normalizeGeneratedConversationTitle,
	summarizeConversationTitle
} from './conversation-title';

describe('summarizeConversationTitle', () => {
	it('turns a request into a compact topic label', () => {
		expect(summarizeConversationTitle('请帮我查询 上海浦东酒店 最近 7 天的经营情况。谢谢')).toBe(
			'查询 上海浦东酒店 最近 7 天的经营情况'
		);
	});

	it('uses the first meaningful clause and bounds long labels', () => {
		expect(
			summarizeConversationTitle(
				'麻烦帮我分析这家酒店最近一个月的入住率和平均房价变化趋势以及主要原因'
			)
		).toBe('分析这家酒店最近一个月的入住率和平均房价变化趋势…');
	});

	it('falls back for blank or punctuation-only prompts', () => {
		expect(summarizeConversationTitle(' ？！ ')).toBe('新对话');
	});

	it('normalizes a generated topic and falls back to the prompt', () => {
		expect(
			normalizeGeneratedConversationTitle('主题：上海酒店经营趋势\n忽略本行', '原始请求')
		).toBe('上海酒店经营趋势');
		expect(normalizeGeneratedConversationTitle('  ', '请帮我查询今日天气')).toBe('查询今日天气');
	});
});
