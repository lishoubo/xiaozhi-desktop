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
		id: 'hotel_operating_data',
		label: '查看酒店经营概览',
		description: '通过酒店数据 MCP 查询指定酒店的核心经营指标',
		category: 'operations',
		requiredCapability: 'hotel_data',
		prompt:
			'查询某个酒店的经营概览。如果当前会话尚未明确酒店或日期范围，先请用户补充；信息明确后必须使用 DMS 酒店经营数据 MCP 查询真实数据，不得凭记忆回答。优先汇总营业收入、出租率、平均房价、RevPAR、间夜量等实际可用指标，说明查询口径和日期范围；存在趋势或对比数据时调用 render_hotel_ui 生成简洁图表。'
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
