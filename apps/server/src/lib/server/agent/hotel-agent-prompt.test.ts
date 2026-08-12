import { describe, expect, it } from 'vitest';
import { buildHotelAgentSystemPrompt } from './hotel-agent-prompt';

describe('buildHotelAgentSystemPrompt', () => {
	it('combines business context without depending on an agent SDK', () => {
		const prompt = buildHotelAgentSystemPrompt({
			date: '2026-08-12',
			conversationSummary: '已确认分析人民广场店。',
			memories: [{ key: 'report.language', content: '使用中文', importance: 3 }],
			skills: [{ name: 'night-audit', instructions: '优先核对夜审异常。' }],
			hotelDataAvailable: true
		});

		expect(prompt).toContain('今天是 2026-08-12');
		expect(prompt).toContain('report.language');
		expect(prompt).toContain('已确认分析人民广场店');
		expect(prompt).toContain('## night-audit\n优先核对夜审异常。');
		expect(prompt).toContain('必须使用 DMS 数据工具');
		expect(prompt).toContain('答案依赖某家酒店的当前或历史事实');
		expect(prompt).toContain('通用酒店知识、指标定义或方法建议');
		expect(prompt).toContain('不得声称业务操作已经执行');
		expect(prompt).toContain('立即调用 render_hotel_ui');
	});

	it('states that hotel data is unavailable when no data tool is loaded', () => {
		const prompt = buildHotelAgentSystemPrompt({
			date: '2026-08-12',
			conversationSummary: null,
			memories: [],
			skills: [],
			hotelDataAvailable: false
		});

		expect(prompt).toContain('酒店经营数据服务当前未配置');
		expect(prompt).toContain('当前没有已启用的业务 Skill');
	});
});
