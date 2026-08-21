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

export const HOTEL_DATA_SCHEMA_CATALOG = `当前 rms_data 业务库表目录（以实时 describe 工具返回的字段为最终准绳）：
- fact_business_daily：经营概览；成交/预约/在店/核销/退款金额、券数、间夜、人数、新客、核销单价。
- fact_channel_analysis：按流量场景和内容体裁拆分成交；可看来源构成。
- fact_product_type_analysis：按商品类型分析成交与核销。
- fact_refund_reason：按退款原因分析退款。
- fact_traffic_scene：流量场景曝光、曝光变化、成交金额及变化。
- fact_traffic_entry_source：全店曝光或门店页访问的一级/二级入口来源。
- fact_conversion_funnel：三级人数转化漏斗。
- fact_user_loss_distribution：访问用户的成交、流失及流失后去向汇总。
- fact_store_loss_destination：流失用户转向的候选门店排行。
- fact_content_live / fact_content_live_list：直播核心指标、直播间和账号明细。
- fact_content_video / fact_content_video_list：视频核心指标、视频和账号明细。
- fact_content_card / fact_content_card_people_profile：获客卡效果和曝光用户画像。
- fact_content_top_product：商品曝光或成交排行。
- fact_search_overview / fact_search_flow_type / fact_search_keyword / fact_search_landing_genre：搜索总览、搜索类型、关键词排行和承接体裁。
- fact_crowd_asset_daily / fact_crowd_distribution / fact_crowd_rank_list：人群资产、客群分布和人群榜单。
- fact_marketing_daily / fact_marketing_tool：营销概览和营销工具表现。
- fact_review_daily / fact_review_items：评价分和中差评明细。
- fact_score_daily / fact_score_metric：经营分和层级指标明细。
- ota_order / ota_order_price_item：OTA 订单与价格、优惠、费用明细。
- ota_daily_report_data：尚未结构化的 OTA 经营报表 JSON 区块，仅在结构化事实表不能回答时使用。
- data_sync_checkpoint / data_sync_subscription：数据同步进度、失败状态及抓取订阅，不用于直接计算经营指标。

查询口径规则：
1. 先根据用户业务词选择最相关的事实表；需要跨域解释时可以查询多张表，不要把“流量”缩减为经营 GMV。
2. 每张事实表通常用 hotel_id、source、data_date、fetch_time 定位酒店、渠道、业务日和抓取时间；字段及枚举必须先经 describe_hotel_data_table 核验。
3. “今日/当前/最新”可能是未完结数据：查询目标日的同时核对 MAX(data_date) 和 MAX(fetch_time)，明确数据截至时间；无目标日记录不等于指标为 0。
4. ALL、总计、-1 等聚合行和维度明细通常并存，必须选一种口径，禁止把总计行与明细行重复相加。
5. fact_* 金额通常已是元、比例字段通常已是百分比；ota_order 的 *_cents 是分。不得再次错误换算，最终以字段描述为准。
6. 分析类请求至少给出规模、结构/来源、转化或结果、环比字段/可比日期和异常点中实际可获得的部分；缺少可比数据时如实说明。
7. 目录、字段元数据、生成的 SQL 都不是业务证据；只有 query_hotel_operating_data_sql 成功返回的数据才能支撑结论。`;

const HOTEL_DATA_REQUEST_TERM =
	/(成交|预约|在店|核销|退款|券数|间夜|新客|客单价|流量|曝光|访问|入口|点击|转化|漏斗|流失|搜索词|精搜|泛搜|直播|视频|获客卡|商品排行|人群|画像|客群|营销|评价|中差评|经营分|订单|入住|离店|房型|价格|房价|佣金|优惠|结算|取消|渠道|同步|抓取|GMV)/i;
const HOTEL_DATA_REQUEST_ACTION =
	/(查|看|显示|列出|获取|统计|多少|分析|复盘|比较|对比|趋势|构成|占比|排行|表现|情况|异常|原因|变化|增长|下降|建议|最新|截至)/i;
const HOTEL_DATA_SCOPE =
	/(酒店|门店|本店|这个店|这家店|今日|今天|昨日|昨天|本周|本月|近\s*\d+\s*天|当前|历史|渠道)/i;
const EXPLICIT_NO_INTERNAL_DATA =
	/(不要|不用|无需|禁止).{0,8}(查|查询|调用|使用).{0,8}(内部|系统|酒店|经营|MCP|数据库).{0,4}(数据)?/i;
const GENERIC_HOTEL_DATA_DOMAIN =
	/(流量|曝光|访问|入口|点击|转化|漏斗|流失|搜索词|精搜|泛搜|直播|视频|获客卡|商品排行|人群|画像|客群|营销|评价|中差评|经营分|同步|抓取)/i;

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
