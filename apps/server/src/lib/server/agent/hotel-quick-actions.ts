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
		id: 'yesterday_operating_review',
		label: '昨日经营复盘',
		description: '按酒店查看昨日成交、预约、核销、退款和间夜表现',
		category: 'operations',
		requiredCapability: 'hotel_data',
		prompt:
			'复盘指定酒店昨天的经营表现。如果当前会话尚未明确酒店，先请用户补充；日期由系统固定为昨天。必须使用 DMS 酒店经营数据 MCP 查询真实数据，汇总实际可用的成交、预约、核销、退款金额及券数、间夜量和核销单价，说明数据口径；有多渠道对比时可生成简洁图表。'
	},
	{
		id: 'last_7_days_operating_trend',
		label: '近 7 日经营趋势',
		description: '查看最近 7 个完整自然日的核心指标变化',
		category: 'operations',
		requiredCapability: 'hotel_data',
		prompt:
			'分析指定酒店最近 7 个完整自然日的经营趋势。如果当前会话尚未明确酒店，先请用户补充；日期由系统固定。必须使用 DMS 酒店经营数据 MCP 查询真实数据，按日比较成交、预约、核销、退款、间夜量和核销单价等实际可用指标，指出趋势、峰谷和异常，并在数据适合时生成简洁趋势图。'
	},
	{
		id: 'month_to_date_operating_progress',
		label: '本月经营进度',
		description: '汇总本月截至当前可用日期的经营进度和阶段表现',
		category: 'operations',
		requiredCapability: 'hotel_data',
		prompt:
			'查看指定酒店本月截至当前可用日期的经营进度。如果当前会话尚未明确酒店，先请用户补充；日期由系统固定。必须使用 DMS 酒店经营数据 MCP 查询真实数据，汇总成交、预约、核销、退款、间夜量和核销单价等实际可用指标，说明阶段变化和数据口径；没有目标值时不要虚构完成率。'
	},
	{
		id: 'channel_operating_comparison',
		label: '渠道经营对比',
		description: '比较最近 7 个完整自然日各渠道的贡献与差异',
		category: 'revenue',
		requiredCapability: 'hotel_data',
		prompt:
			'比较指定酒店最近 7 个完整自然日各渠道的经营表现。如果当前会话尚未明确酒店，先请用户补充；日期和指标由系统固定。必须使用 DMS 酒店经营数据 MCP 查询真实数据，按实际存在的渠道比较成交、预约、核销、退款、间夜量和核销单价，指出主要贡献渠道与异常差异；适合时生成渠道对比图。'
	},
	{
		id: 'hotel_operating_data',
		label: '查看酒店经营概览',
		description: '按酒店和日期查询核心经营指标',
		category: 'operations',
		requiredCapability: 'hotel_data',
		prompt:
			'查询某个酒店的经营概览。如果当前会话尚未明确酒店或日期范围，先请用户补充；信息明确后必须使用 DMS 酒店经营数据 MCP 查询真实数据，不得凭记忆回答。优先汇总实际可用的成交、预约、核销、退款金额及券数、间夜量和核销单价，说明查询口径和日期范围；存在趋势或对比数据时调用 render_hotel_ui 生成简洁图表。'
	},
	{
		id: 'public_hotel_rates',
		label: '查询公开房价',
		description: '补充酒店和入住日期后，比较各来源的公开可订价格',
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
