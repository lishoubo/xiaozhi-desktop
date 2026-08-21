import { describe, expect, it } from 'vitest';
import {
	HOTEL_DATA_BUSINESS_ROUTE_GUIDANCE,
	HOTEL_DATA_SCHEMA_CATALOG,
	HOTEL_DATA_TABLES,
	hotelDataDomainsForText,
	hotelDataMetricFamiliesForFields,
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
		expect(isLikelyHotelDataRequest('看看这个酒店目前评分情况')).toBe(true);
		expect(isGenericHotelDataDomainRequest('分析下这个酒店今日的流量情况')).toBe(true);
		expect(isGenericHotelDataDomainRequest('复盘这个酒店昨日成交核销情况')).toBe(false);
	});

	it('does not force generic knowledge or an explicit no-data request into DMS', () => {
		expect(isLikelyHotelDataRequest('酒店流量是什么意思')).toBe(false);
		expect(isLikelyHotelDataRequest('不要查询内部数据，只讲酒店流量分析方法')).toBe(false);
	});

	it('keeps a complete machine-readable catalog for the live hotel-data schema', () => {
		expect(HOTEL_DATA_TABLES).toHaveLength(35);
		expect(new Set(HOTEL_DATA_TABLES.map((table) => table.name)).size).toBe(35);
		expect(HOTEL_DATA_TABLES.every((table) => table.grain.length > 0)).toBe(true);
		expect(HOTEL_DATA_TABLES.every((table) => table.columns.length > 0)).toBe(true);
		expect(
			HOTEL_DATA_TABLES.every((table) =>
				table.sensitiveFields.every((field) => table.columns.includes(field))
			)
		).toBe(true);
		expect(HOTEL_DATA_TABLES.find((table) => table.name === 'ota_order')).toMatchObject({
			domain: 'orders',
			timeField: 'data_date',
			units: expect.arrayContaining(['分'])
		});
		expect(
			HOTEL_DATA_TABLES.find((table) => table.name === 'fact_search_keyword')?.columns
		).toContain('exposure_to_trade_conversion_rate');
	});

	it('derives every explicitly requested known business domain', () => {
		expect(hotelDataDomainsForText('分析流量、搜索词、评价和订单佣金')).toEqual([
			'traffic_conversion',
			'search',
			'reviews_scores',
			'orders'
		]);
		expect(hotelDataDomainsForText('搜索流量表现')).toEqual(['search']);
		expect(hotelDataDomainsForText('直播成交表现')).toEqual(['content']);
		expect(hotelDataDomainsForText('订单退款情况')).toEqual(['orders']);
	});

	it('does not mistake a conversion-rate field for a completed trade metric', () => {
		expect(hotelDataMetricFamiliesForFields(['exposure_to_trade_conversion_rate'])).toEqual([
			'conversion'
		]);
		expect(hotelDataMetricFamiliesForFields(['gmv', 'trade_user_cnt'])).toEqual([
			'conversion',
			'trade'
		]);
	});
});
