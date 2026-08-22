import { describe, expect, it } from 'vitest';
import { buildHotelAgentSystemPrompt } from './hotel-agent-prompt';

describe('buildHotelAgentSystemPrompt', () => {
	it('combines business context without depending on an agent SDK', () => {
		const prompt = buildHotelAgentSystemPrompt({
			date: '2026-08-12',
			conversationSummary: '已确认分析人民广场店。',
			memories: [{ key: 'report.language', content: '使用中文', importance: 3 }],
			skills: [{ name: 'night-audit', instructions: '优先核对夜审异常。' }]
		});

		expect(prompt).toContain('今天是 2026-08-12');
		expect(prompt).toContain('report.language');
		expect(prompt).toContain('已确认分析人民广场店');
		expect(prompt).toContain('## night-audit\n优先核对夜审异常。');
		expect(prompt).toContain('必须先通过 DMS MCP 查询');
		expect(prompt).toContain('依赖某家酒店当前或历史');
		expect(prompt).toContain('通用行业知识和指标定义');
		expect(prompt).toContain('不得声称已执行');
		expect(prompt).toContain('调用一次 render_hotel_ui');
		expect(prompt).toContain('成功后不得');
		expect(prompt).toContain('代词和省略的主语');
		expect(prompt).toContain('最近的用户与助手消息');
		expect(prompt).not.toContain('fact_traffic_scene');
		expect(prompt).not.toContain('当前 rms_data 已验证业务对象目录');
		expect(prompt).toContain('database_id 由服务端注入');
	});

	it('always describes DMS MCP as the only hotel business data path', () => {
		const prompt = buildHotelAgentSystemPrompt({
			date: '2026-08-12',
			conversationSummary: null,
			memories: [],
			skills: []
		});

		expect(prompt).toContain('酒店业务数据的唯一查询路径是 DMS MCP');
		expect(prompt).not.toContain('酒店经营数据服务当前未配置');
		expect(prompt).not.toContain('自行连接数据库');
		expect(prompt).toContain('当前没有已启用的业务 Skill');
	});
});
