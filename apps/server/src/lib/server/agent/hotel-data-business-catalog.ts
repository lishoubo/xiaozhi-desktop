import {
	buildHotelDataSchemaCatalog,
	describeVerifiedHotelDataTables,
	hotelDataDomainLabel,
	hotelDataDomainsForText,
	hotelDataTableSemantics,
	HOTEL_DATA_TABLES,
	HOTEL_DATA_CATALOG_TOOL_NAME,
	type HotelDataDomain,
	type HotelDataTableSemantics
} from './hotel-data-semantic-catalog';

export {
	hotelDataDomainLabel,
	hotelDataDomainsForText,
	hotelDataTableSemantics,
	describeVerifiedHotelDataTables,
	HOTEL_DATA_TABLES,
	HOTEL_DATA_CATALOG_TOOL_NAME,
	type HotelDataDomain,
	type HotelDataTableSemantics
};

export const HOTEL_DATA_BUSINESS_ROUTE_GUIDANCE = `酒店真实业务数据不仅包括“经营概览”，还包括以下用户自然语言：
- 成交、预约、在店、核销、退款、券数、间夜、人数、新客、核销单价；
- 流量、曝光、访问、入口来源、推荐分享、搜索、团购商城、点击、转化率、转化漏斗、流失及流失去向；
- 直播、视频、获客卡、商品排行、内容带来的成交或核销；
- 搜索词、精搜词、泛搜词、搜索承接体裁；
- 人群资产、用户画像、客群分布和榜单；
- 营销概览、营销工具表现；
- 评分、评价、中差评、经营分和分项指标；
- OTA 订单、入住离店、房型、价格、佣金、优惠、结算、取消；
- 数据抓取进度、同步状态、最新数据日期和更新时间。
只要用户询问某家酒店或其有权限酒店的上述现状、历史、数量、趋势、构成、排行、对比、异常、原因、复盘或建议，就属于 business_read；不要因为用户使用“看看、情况、表现、流量”等口语而归为普通对话或酒店知识。`;

export const HOTEL_DATA_SCHEMA_CATALOG = buildHotelDataSchemaCatalog();

const HOTEL_DATA_REQUEST_TERM =
	/(成交|预约|在店|核销|退款|券数|间夜|新客|客单价|流量|曝光|访问|入口|点击|转化|漏斗|流失|搜索词|精搜|泛搜|直播|视频|获客卡|商品排行|人群|画像|客群|营销|评分|评价|评论|中差评|经营分|订单|入住|离店|房型|价格|房价|佣金|优惠|结算|取消|渠道|同步|抓取|GMV)/i;
const HOTEL_DATA_REQUEST_ACTION =
	/(查|看|显示|列出|获取|统计|多少|分析|复盘|比较|对比|趋势|构成|占比|排行|表现|情况|异常|原因|变化|增长|下降|建议|最新|截至)/i;
const HOTEL_DATA_SCOPE =
	/(酒店|门店|本店|这个店|这家店|今日|今天|昨日|昨天|本周|本月|近\s*\d+\s*天|当前|历史|渠道)/i;
const EXPLICIT_NO_INTERNAL_DATA =
	/(不要|不用|无需|禁止).{0,8}(查|查询|调用|使用).{0,8}(内部|系统|酒店|经营|MCP|数据库).{0,4}(数据)?/i;
const GENERIC_HOTEL_DATA_DOMAIN =
	/(流量|曝光|访问|入口|点击|转化|漏斗|流失|搜索词|精搜|泛搜|直播|视频|获客卡|商品排行|人群|画像|客群|营销|评分|评价|评论|中差评|经营分|同步|抓取)/i;

export function isLikelyHotelDataRequest(text: string): boolean {
	return (
		!EXPLICIT_NO_INTERNAL_DATA.test(text) &&
		HOTEL_DATA_REQUEST_TERM.test(text) &&
		HOTEL_DATA_REQUEST_ACTION.test(text) &&
		HOTEL_DATA_SCOPE.test(text)
	);
}

export function isGenericHotelDataDomainRequest(text: string): boolean {
	return isLikelyHotelDataRequest(text) && GENERIC_HOTEL_DATA_DOMAIN.test(text);
}
