import type { AgentQuickAction, AgentQuickActionId } from '@hotel-butler/api';
import type { McpCapability } from './agent-config';

type QuickActionDefinition = Readonly<
	Omit<AgentQuickAction, 'available' | 'requiresMcp'> & {
		requiredCapability: McpCapability;
		prompt: string;
	}
>;

const definitions = [
	{
		id: 'today_weather',
		label: '查看今日天气',
		description: '查询指定酒店所在地今天的天气和运营影响',
		category: 'operations',
		requiredCapability: 'weather',
		prompt:
			'询问用户要查询的酒店名称或城市（如果当前会话尚未明确），然后使用公共天气 MCP 查询当地今天的实时天气、最高最低温、降水概率、风力和有效预警。结合酒店运营给出简短的到店、户外设施和出行提醒，并标注数据来源与更新时间；不得把预报写成确定事实。'
	},
	{
		id: 'weather_outlook',
		label: '未来七天天气',
		description: '查看酒店所在地未来七天趋势和风险日期',
		category: 'operations',
		requiredCapability: 'weather',
		prompt:
			'询问用户要查询的酒店名称或城市（如果当前会话尚未明确），使用公共天气 MCP 查询未来七天预报。用酒店主题的趋势图展示最高温、最低温或降水概率，突出暴雨、大风、高温、低温等风险日期，并标注数据来源、更新时间和预报不确定性。'
	},
	{
		id: 'air_quality',
		label: '空气质量提醒',
		description: '查询空气质量、紫外线和宾客出行建议',
		category: 'guest',
		requiredCapability: 'weather',
		prompt:
			'询问用户要查询的酒店名称或城市（如果当前会话尚未明确），通过公共天气 MCP 查询当地空气质量、主要污染物和紫外线信息。按数据源给出的健康分级生成简短宾客出行提醒；不要进行医学诊断，并标注数据时间与来源。'
	},
	{
		id: 'public_hotel_rates',
		label: '公开酒店价格',
		description: '搜索指定日期和酒店的公开可订价格并比较来源',
		category: 'revenue',
		requiredCapability: 'hotel_rates',
		prompt:
			'先向用户确认酒店、城市、入住日期、离店日期、入住人数和币种，再调用已配置的公开酒店价格 MCP。比较返回的携程或其他公开来源价格时，必须列出来源、房型、价型、税费口径、取消政策、采集时间和可订状态；无某个平台数据时明确说明，不得推测或抓取需要登录的页面。'
	}
] as const satisfies readonly QuickActionDefinition[];

const byId = new Map<AgentQuickActionId, QuickActionDefinition>(
	definitions.map((definition) => [definition.id, definition])
);

export function listHotelQuickActions(
	capabilities: ReadonlySet<McpCapability>
): readonly AgentQuickAction[] {
	return definitions
		.filter((definition) => capabilities.has(definition.requiredCapability))
		.map((definition) => ({
			id: definition.id,
			label: definition.label,
			description: definition.description,
			category: definition.category,
			requiresMcp: true,
			available: true
		}));
}

export function getHotelQuickAction(id: AgentQuickActionId): QuickActionDefinition {
	const definition = byId.get(id);
	if (!definition) throw new Error(`Unknown public MCP quick action: ${id}`);
	return definition;
}
