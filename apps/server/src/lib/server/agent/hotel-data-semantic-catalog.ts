import { HOTEL_DATA_TABLE_COLUMNS } from './hotel-data-table-columns';

export type HotelDataDomain =
	| 'operating'
	| 'traffic_conversion'
	| 'content'
	| 'search'
	| 'crowd'
	| 'marketing'
	| 'reviews_scores'
	| 'orders'
	| 'sync';

export type HotelDataTableSemantics = Readonly<{
	name: string;
	domain: HotelDataDomain;
	description: string;
	grain: string;
	hotelField: string;
	sourceField: string | null;
	timeField: string | null;
	freshnessField: string | null;
	units: readonly string[];
	rules: readonly string[];
	sensitiveFields: readonly string[];
	fallbackOnly: boolean;
	columns: readonly string[];
}>;

type Overrides = Partial<
	Omit<HotelDataTableSemantics, 'name' | 'domain' | 'description' | 'grain'>
>;
const entry = (
	name: string,
	domain: HotelDataDomain,
	description: string,
	grain: string,
	overrides: Overrides = {}
): HotelDataTableSemantics => ({
	name,
	domain,
	description,
	grain,
	hotelField: 'hotel_id',
	sourceField: 'source',
	timeField: 'data_date',
	freshnessField: 'fetch_time',
	units: [],
	rules: [],
	sensitiveFields: [],
	fallbackOnly: false,
	columns: HOTEL_DATA_TABLE_COLUMNS[name] ?? [],
	...overrides
});

/** Verified against the 2026-08-21 live rms_data catalog: 34 tables and one view. */
export const HOTEL_DATA_TABLES: readonly HotelDataTableSemantics[] = [
	entry('data_sync_checkpoint', 'sync', '抓数检查点、状态和错误', '酒店×账号×任务×目标日', {
		freshnessField: 'updated_at',
		units: ['状态'],
		rules: ['SUCCESS 才表示目标日同步完成'],
		sensitiveFields: ['error_message']
	}),
	entry('data_sync_subscription', 'sync', '抓数订阅和回补配置', '酒店×渠道×任务', {
		timeField: null,
		freshnessField: 'updated_at',
		units: ['天'],
		sensitiveFields: ['cookie_cipher']
	}),
	entry('fact_business_daily', 'operating', '经营概览', '酒店×渠道×业务日×商品类型', {
		units: ['元', '券', '间夜', '人'],
		rules: ['product_type=ALL 与商品类型明细不可重复相加']
	}),
	entry(
		'fact_channel_analysis',
		'operating',
		'按流量场景和体裁拆分成交',
		'酒店×渠道×业务日×指标×商品类型×场景×体裁',
		{ units: ['元', '百分比'], rules: ['traffic_scene_id=-1、genre_id=-1 与明细选择单一层级'] }
	),
	entry('fact_content_card', 'content', '获客卡核心效果', '酒店×渠道×业务日×获客卡类型', {
		units: ['元', '次数', '百分比'],
		rules: ['全部类型与分类明细不可重复相加']
	}),
	entry(
		'fact_content_card_people_profile',
		'content',
		'获客卡曝光用户画像',
		'酒店×渠道×业务日×卡类型×人群标签',
		{ units: ['人', '百分比'] }
	),
	entry('fact_content_live', 'content', '直播核心指标', '酒店×渠道×业务日×直播范围', {
		units: ['元', '券', '人', '秒', '百分比'],
		rules: ['全部范围与商家/达人等明细不可重复相加']
	}),
	entry(
		'fact_content_live_list',
		'content',
		'直播间和账号明细',
		'酒店×渠道×业务日×行类型×直播间或账号',
		{
			units: ['元', '券', '人', '秒', '百分比'],
			rules: ['ROOM 单场与 AUTHOR 周期汇总不可直接合计'],
			sensitiveFields: ['author_nickname', 'author_cover_url', 'room_cover_url']
		}
	),
	entry(
		'fact_content_top_product',
		'content',
		'内容商品曝光或成交排行',
		'酒店×渠道×业务日×排行类型×商品',
		{ units: ['元', '次数', '名次'], sensitiveFields: ['product_cover_url'] }
	),
	entry('fact_content_video', 'content', '短视频核心指标', '酒店×渠道×业务日×视频范围', {
		units: ['元', '券', '人', '次', '百分比'],
		rules: ['全部范围与商家/达人等明细不可重复相加']
	}),
	entry(
		'fact_content_video_list',
		'content',
		'视频和账号明细',
		'酒店×渠道×业务日×行类型×视频或账号',
		{
			units: ['元', '券', '人', '次', '百分比'],
			rules: ['VIDEO 单条与 AUTHOR 周期汇总不可直接合计'],
			sensitiveFields: [
				'publisher_nickname',
				'author_nickname',
				'author_cover_url',
				'item_cover_url'
			]
		}
	),
	entry(
		'fact_conversion_funnel',
		'traffic_conversion',
		'三级人数转化漏斗',
		'酒店×渠道×业务日×漏斗层级',
		{ units: ['人', '百分比'], rules: ['漏斗节点不可相加'] }
	),
	entry('fact_crowd_asset_daily', 'crowd', '人群资产规模和变化', '酒店×渠道×业务日×人群资产类型', {
		units: ['人', '百分比']
	}),
	entry('fact_crowd_distribution', 'crowd', '客群维度分布', '酒店×渠道×业务日×分布维度×标签', {
		units: ['人', '百分比']
	}),
	entry('fact_crowd_rank_list', 'crowd', '人群榜单 JSON', '酒店×渠道×业务日×榜单类型', {
		units: ['JSON'],
		rules: ['需要榜单时显式 JSON_EXTRACT'],
		fallbackOnly: true
	}),
	entry('fact_marketing_daily', 'marketing', '营销概览', '酒店×渠道×业务日×营销范围', {
		units: ['元', '人', '券', '百分比'],
		rules: ['总览与工具明细不可重复相加']
	}),
	entry('fact_marketing_tool', 'marketing', '营销工具表现', '酒店×渠道×业务日×营销场景×工具', {
		units: ['元', '人', '券', '百分比'],
		rules: ['场景间指标列互斥，NULL 不代表零']
	}),
	entry(
		'fact_product_type_analysis',
		'operating',
		'按商品类型分析成交与核销',
		'酒店×渠道×业务日×商品类型',
		{ units: ['元', '券', '间夜', '人', '百分比'], rules: ['ALL 与商品类型明细不可重复相加'] }
	),
	entry('fact_refund_reason', 'operating', '按原因分析退款', '酒店×渠道×业务日×商品类型×退款原因', {
		units: ['元', '券', '百分比']
	}),
	entry('fact_review_daily', 'reviews_scores', '评价累计快照', '酒店×渠道×业务日', {
		units: ['分', '条', '百分比'],
		rules: ['data_date 是抓取日前一日累计快照，不是当日新增']
	}),
	entry('fact_review_items', 'reviews_scores', '中差评明细', '酒店×渠道×评价标识', {
		timeField: 'review_date',
		freshnessField: 'snapshot_time',
		units: ['分'],
		rules: ['仅含采集到的中差评，回复可能是首次快照'],
		sensitiveFields: ['customer_nick', 'content', 'reply_content']
	}),
	entry('fact_score_daily', 'reviews_scores', '经营分每日快照', '酒店×渠道×业务日', {
		units: ['分', '等级']
	}),
	entry('fact_score_metric', 'reviews_scores', '经营分层级指标', '酒店×渠道×业务日×指标路径', {
		units: ['分', '等级'],
		rules: ['父子指标不可直接求和']
	}),
	entry('fact_search_flow_type', 'search', '搜索类型流量表现', '酒店×渠道×业务日×搜索类型', {
		units: ['次数', '人', '元', '百分比']
	}),
	entry('fact_search_keyword', 'search', '搜索关键词排行', '酒店×渠道×业务日×搜索类型×关键词', {
		units: ['次数', '人', '元', '名次', '百分比']
	}),
	entry('fact_search_landing_genre', 'search', '搜索承接体裁', '酒店×渠道×业务日×入口×体裁', {
		units: ['次数', '人', '元', '百分比'],
		rules: ['总计体裁与内容体裁明细不可重复相加']
	}),
	entry('fact_search_overview', 'search', '精搜词和泛搜词总览', '酒店×渠道×业务日', {
		units: ['次数', '百分比']
	}),
	entry(
		'fact_store_loss_destination',
		'traffic_conversion',
		'流失用户转向门店排行',
		'酒店×渠道×业务日×目的地门店',
		{ units: ['人', '元', '分', '名次'], rules: ['lost_pay_user_cnt 可能恒为空，不据此宣称零流失'] }
	),
	entry(
		'fact_traffic_entry_source',
		'traffic_conversion',
		'曝光或门店页访问入口来源',
		'酒店×渠道×业务日×流量范围×二级入口',
		{ units: ['次数', '人', '百分比'], rules: ['GLOBAL 与 STORE_PAGE 指标列互斥'] }
	),
	entry(
		'fact_traffic_scene',
		'traffic_conversion',
		'流量场景曝光和成交',
		'酒店×渠道×业务日×流量场景',
		{ units: ['次数', '元', '百分比'], rules: ['traffic_scene_id=-1 总计与场景明细不可重复相加'] }
	),
	entry(
		'fact_user_loss_distribution',
		'traffic_conversion',
		'访问用户成交和流失分布',
		'酒店×渠道×业务日×流失范围',
		{ units: ['人'], rules: ['total、trade、lost 是漏斗关系，不可相加'] }
	),
	entry(
		'ota_daily_report_data',
		'operating',
		'未结构化 OTA 经营报表 JSON',
		'酒店×渠道×业务日×主题×版本',
		{
			units: ['JSON'],
			rules: ['只在结构化事实表不能回答时使用并显式提取 JSON'],
			fallbackOnly: true
		}
	),
	entry('ota_order', 'orders', 'OTA 订单主表', '酒店×渠道×OTA订单', {
		units: ['分', '间夜', '间', '日期时间'],
		freshnessField: 'synced_at',
		rules: ['按问题选择 booked_at、check_in_date、check_out_date 或 data_date'],
		sensitiveFields: [
			'guest_name',
			'guest_phone_masked',
			'cancel_reason',
			'remark',
			'hotel_confirm_remark',
			'platform_notice',
			'raw_payload'
		]
	}),
	entry('ota_order_price_item', 'orders', '订单优惠和费用明细', '酒店×渠道×订单×费用项', {
		timeField: 'night_date',
		freshnessField: 'updated_at',
		units: ['分'],
		rules: ['同时按 hotel_id、source、ota_order_id 关联订单']
	}),
	entry('v_hotel_current', 'sync', '当前酒店识别视图', '酒店', {
		sourceField: null,
		timeField: null,
		freshnessField: null
	})
] as const;

const tableByName = new Map(HOTEL_DATA_TABLES.map((item) => [item.name, item]));

export function hotelDataTableSemantics(name: string): HotelDataTableSemantics | null {
	return tableByName.get(name.toLowerCase()) ?? null;
}

export function describeVerifiedHotelDataTables(
	names: readonly string[]
): readonly HotelDataTableSemantics[] {
	return [...new Set(names.map((name) => name.toLowerCase()))].flatMap((name) => {
		const semantics = hotelDataTableSemantics(name);
		return semantics ? [semantics] : [];
	});
}

const domains: readonly Readonly<{ domain: HotelDataDomain; label: string; pattern: RegExp }>[] = [
	{
		domain: 'operating',
		label: '经营',
		pattern: /成交|预约|在店|核销|退款|券|间夜|新客|客单价|GMV|经营概览/i
	},
	{
		domain: 'traffic_conversion',
		label: '流量与转化',
		pattern: /流量|曝光|访问|入口|点击|转化|漏斗|流失|去向/i
	},
	{ domain: 'content', label: '内容', pattern: /直播|视频|获客卡|商品排行|内容/i },
	{ domain: 'search', label: '搜索', pattern: /搜索|精搜|泛搜|关键词/i },
	{ domain: 'crowd', label: '人群', pattern: /人群|画像|客群|受众/i },
	{ domain: 'marketing', label: '营销', pattern: /营销|促销工具|营销工具/i },
	{ domain: 'reviews_scores', label: '评价与评分', pattern: /评价|评论|中差评|评分|经营分|口碑/i },
	{
		domain: 'orders',
		label: '订单',
		pattern: /订单|入住|离店|房型|房价|佣金|优惠|结算|取消|预订/i
	},
	{ domain: 'sync', label: '同步', pattern: /同步|抓取|更新|最新数据日期|数据截至/i }
];

export function hotelDataDomainsForText(text: string): readonly HotelDataDomain[] {
	const generalMetrics = text
		.replace(/(?:搜索|精搜|泛搜|关键词)(?:流量|曝光|访问|点击|转化|成交)/g, '搜索')
		.replace(/(?:直播|视频|获客卡|内容)(?:流量|曝光|访问|点击|转化|成交|退款)/g, '内容')
		.replace(/营销(?:流量|曝光|访问|点击|转化|成交|退款)/g, '营销')
		.replace(/订单(?:成交|退款|取消|金额)/g, '订单');
	return domains
		.filter((item) =>
			item.pattern.test(
				item.domain === 'operating' || item.domain === 'traffic_conversion' ? generalMetrics : text
			)
		)
		.map((item) => item.domain);
}

export function hotelDataDomainLabel(domain: HotelDataDomain): string {
	return domains.find((item) => item.domain === domain)?.label ?? domain;
}

export function buildHotelDataSchemaCatalog(): string {
	const lines = HOTEL_DATA_TABLES.map((item) => {
		const qualifiers = [
			`粒度=${item.grain}`,
			item.timeField ? `日期=${item.timeField}` : '无统一业务日',
			item.units.length ? `单位=${item.units.join('/')}` : '',
			...item.rules,
			item.fallbackOnly ? '仅作后备' : ''
		].filter(Boolean);
		return `- ${item.name}：${item.description}；${qualifiers.join('；')}`;
	}).join('\n');
	return `当前 rms_data 已验证业务对象目录（无需为已列对象重复 list/describe）：\n${lines}\n\n通用查询口径：\n1. 从用户明确要求推导业务域和必需证据；SQL 次数只是熔断上限，不限制维度。\n2. 模糊的“当前/情况/表现/分析”先确定各域最近完整业务日；分析请求增加可比基线，无可比数据就明确限制。无目标日记录不等于指标为 0，应核对同步状态。\n3. 跨表先聚合到 hotel_id、source、业务日等共同粒度再关联；每张酒店表都按 hotel_id 隔离。\n4. 不跨 source 合计不兼容指标；元与分先归一；快照、事件、日报和明细不可混加。\n5. 汇总行与明细行选择单一层级，禁止重复相加。\n6. 默认不查询敏感字段和原始 JSON，除非问题明确需要且结果最小化。\n7. 目录、字段元数据和 SQL 不是业务证据；只有成功 SQL 返回的数据能支撑结论。`;
}
export const HOTEL_DATA_CATALOG_TOOL_NAME = 'describe_verified_hotel_data_tables';
