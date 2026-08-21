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
		expect(prompt).toContain('必须先查询 DMS');
		expect(prompt).toContain('依赖某家酒店当前或历史');
		expect(prompt).toContain('通用行业知识和指标定义');
		expect(prompt).toContain('不得声称已执行');
		expect(prompt).toContain('调用一次 render_hotel_ui');
		expect(prompt).toContain('成功后不得');
		expect(prompt).toContain('代词和省略的主语');
		expect(prompt).toContain('最近的用户与助手消息');
		expect(prompt).toContain('fact_traffic_scene');
		expect(prompt).toContain('三级人数转化漏斗');
		expect(prompt).toContain('无目标日记录不等于指标为 0');
		expect(prompt).toContain('database_id 由服务端注入');
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
