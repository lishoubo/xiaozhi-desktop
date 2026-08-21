import { describe, expect, it } from 'vitest';
import {
	HOTEL_DATA_BUSINESS_ROUTE_GUIDANCE,
	HOTEL_DATA_SCHEMA_CATALOG,
	isGenericHotelDataDomainRequest,
	isLikelyHotelDataRequest
} from './hotel-data-business-catalog';

describe('hotel data business catalog', () => {
	it('maps the live DMS traffic domains to natural hotel requests', () => {
		expect(HOTEL_DATA_BUSINESS_ROUTE_GUIDANCE).toContain('流量、曝光、访问');
		expect(HOTEL_DATA_SCHEMA_CATALOG).toContain('fact_traffic_scene');
		expect(HOTEL_DATA_SCHEMA_CATALOG).toContain('fact_conversion_funnel');
		expect(HOTEL_DATA_SCHEMA_CATALOG).toContain('fact_user_loss_distribution');
		expect(isLikelyHotelDataRequest('分析下这个酒店今日的流量情况')).toBe(true);
		expect(isLikelyHotelDataRequest('看看本店昨天直播转化表现')).toBe(true);
		expect(isGenericHotelDataDomainRequest('分析下这个酒店今日的流量情况')).toBe(true);
		expect(isGenericHotelDataDomainRequest('复盘这个酒店昨日成交核销情况')).toBe(false);
	});

	it('does not force generic knowledge or an explicit no-data request into DMS', () => {
		expect(isLikelyHotelDataRequest('酒店流量是什么意思')).toBe(false);
		expect(isLikelyHotelDataRequest('不要查询内部数据，只讲酒店流量分析方法')).toBe(false);
	});
});
