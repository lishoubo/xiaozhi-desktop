import type { StructuredToolInterface } from '@langchain/core/tools';
import { HOTEL_DATA_SQL_TOOL_NAME } from '../../hotel-data-mcp';
import type { BusinessWorkflowHandler } from '../business-workflow';
import type { ResolvedBusinessRequest } from '../business-execution-state';
import { buildDeterministicOperatingAnswer } from '../deterministic-operating-answer';
import { assessDefaultWorkflowEvidence } from './default-evidence-policy';
import { schemaAccepts, slotString } from './workflow-tool-schema';

function operatingSummaryArgs(
	tool: StructuredToolInterface,
	request: ResolvedBusinessRequest
): Readonly<Record<string, unknown>> | null {
	const hotel = slotString(request.slots, 'hotelReference');
	const range = request.slots.dateRange;
	if (!hotel || typeof range !== 'object' || range === null || Array.isArray(range)) return null;
	const start = Reflect.get(range, 'start');
	const end = Reflect.get(range, 'end');
	const metrics = slotString(request.slots, 'metrics');
	if (
		typeof start !== 'string' ||
		typeof end !== 'string' ||
		!/^[0-9]+$/.test(hotel) ||
		!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(start) ||
		!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(end)
	) {
		return null;
	}
	const dailyTrend = metrics === '@metrics:daily-trend';
	return {
		database_id: 'server-configured',
		script: dailyTrend
			? `SELECT hotel_id, data_date, SUM(gmv) AS gmv, SUM(booking_amount) AS booking_amount, SUM(verified_amount) AS verified_amount, SUM(refund_amount) AS refund_amount, SUM(gmv_coupon_cnt) AS gmv_coupon_cnt, SUM(booking_coupon_cnt) AS booking_coupon_cnt, SUM(verified_coupon_cnt) AS verified_coupon_cnt, SUM(refund_coupon_cnt) AS refund_coupon_cnt, SUM(gmv_room_night) AS gmv_room_night, SUM(booking_room_night) AS booking_room_night, SUM(verified_room_night) AS verified_room_night, SUM(refund_room_night) AS refund_room_night, CASE WHEN SUM(verified_coupon_cnt) > 0 THEN SUM(verified_amount) / SUM(verified_coupon_cnt) ELSE NULL END AS verified_unit_price FROM fact_business_daily WHERE hotel_id = ${hotel} AND data_date BETWEEN '${start}' AND '${end}' AND product_type = 'ALL' GROUP BY hotel_id, data_date ORDER BY data_date ASC`
			: `SELECT hotel_id, MIN(data_date) AS period_start, MAX(data_date) AS period_end, SUM(gmv) AS gmv, SUM(booking_amount) AS booking_amount, SUM(verified_amount) AS verified_amount, SUM(refund_amount) AS refund_amount, SUM(gmv_coupon_cnt) AS gmv_coupon_cnt, SUM(booking_coupon_cnt) AS booking_coupon_cnt, SUM(verified_coupon_cnt) AS verified_coupon_cnt, SUM(refund_coupon_cnt) AS refund_coupon_cnt, SUM(gmv_room_night) AS gmv_room_night, SUM(booking_room_night) AS booking_room_night, SUM(verified_room_night) AS verified_room_night, SUM(refund_room_night) AS refund_room_night, CASE WHEN SUM(verified_coupon_cnt) > 0 THEN SUM(verified_amount) / SUM(verified_coupon_cnt) ELSE NULL END AS verified_unit_price FROM fact_business_daily WHERE hotel_id = ${hotel} AND data_date BETWEEN '${start}' AND '${end}' AND product_type = 'ALL' GROUP BY hotel_id`
	};
}

export const hotelOperatingSummaryWorkflow: BusinessWorkflowHandler = {
	id: 'hotel_operating_summary.v1',
	intent: 'hotel_operating_summary',
	requiresToolCatalog: (request) => !Array.isArray(request.slots.hotelReference),
	planCollection: (request, tools) => {
		if (Array.isArray(request.slots.hotelReference)) {
			return { kind: 'agent', reason: 'agent_required' };
		}
		if (request.slots.dateRange === undefined) {
			return { kind: 'agent', reason: 'agent_required' };
		}
		const tool = tools.find((candidate) => candidate.name === HOTEL_DATA_SQL_TOOL_NAME);
		const args = tool ? operatingSummaryArgs(tool, request) : null;
		if (!tool || !args || !schemaAccepts(tool.schema, args)) {
			return {
				kind: 'protocol_error',
				operation: 'select_hotel_operating_tool',
				reason: 'Pinned hotel operating SQL tool is unavailable or incompatible'
			};
		}
		return { kind: 'direct', tool, args };
	},
	assessEvidence: assessDefaultWorkflowEvidence,
	present: buildDeterministicOperatingAnswer
};
