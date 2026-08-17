import type { ExecuteValues } from 'mysql2';
import { agentPromise, AgentUpstreamError, runAgentEffect } from '../agent-effect';
import type { HotelCandidate, HotelReferenceResolver } from './slot-resolver';

export interface HotelQueryExecutor {
	execute(sql: string, values: ExecuteValues): Promise<readonly [unknown, unknown]>;
}

type HotelRow = Readonly<{
	id: string | number;
	name: string;
	short_name: string;
}>;

function isHotelRow(value: unknown): value is HotelRow {
	if (typeof value !== 'object' || value === null) return false;
	const id = Reflect.get(value, 'id');
	return (
		((typeof id === 'string' && /^\d+$/.test(id)) ||
			(typeof id === 'number' && Number.isSafeInteger(id) && id > 0)) &&
		typeof Reflect.get(value, 'name') === 'string' &&
		typeof Reflect.get(value, 'short_name') === 'string'
	);
}

function normalized(value: string): string {
	return value
		.trim()
		.toLocaleLowerCase('zh-CN')
		.replace(/[\s·・_-]/g, '');
}

export class RmsHotelReferenceResolver implements HotelReferenceResolver {
	constructor(private readonly executor: HotelQueryExecutor) {}

	async resolve(reference: string, orgId: string): Promise<readonly HotelCandidate[]> {
		const query = reference.trim();
		if (!query || !/^\d+$/.test(orgId)) return [];
		const [rows] = await runAgentEffect(
			agentPromise({
				service: 'rms',
				operation: 'resolve_hotel_reference',
				timeoutMs: 10_000,
				try: () =>
					this.executor.execute(
						`SELECT id, name, short_name
				 FROM hotel
			 WHERE org_id = ?
			   AND status = 1
			   AND (
			     name = ? OR short_name = ?
			     OR LOCATE(?, name) > 0 OR LOCATE(?, short_name) > 0
			   )
			 ORDER BY CASE WHEN name = ? OR short_name = ? THEN 0 ELSE 1 END, id ASC
			 LIMIT 10`,
						[orgId, query, query, query, query, query, query]
					)
			})
		);
		if (!Array.isArray(rows)) {
			throw new AgentUpstreamError({
				service: 'rms',
				operation: 'resolve_hotel_reference',
				kind: 'invalid_response'
			});
		}

		const target = normalized(query);
		return rows.map((row) => {
			if (!isHotelRow(row)) {
				throw new AgentUpstreamError({
					service: 'rms',
					operation: 'resolve_hotel_reference',
					kind: 'invalid_response'
				});
			}
			const name = row.name.trim();
			const shortName = row.short_name.trim();
			const normalizedName = normalized(name);
			const normalizedShortName = normalized(shortName);
			const match =
				normalizedName === target || normalizedShortName === target
					? 'exact'
					: normalizedName.includes(target) || normalizedShortName.includes(target)
						? 'alias'
						: 'fuzzy';
			return {
				id: String(row.id),
				label: name,
				match,
				accessScope: 'shared_dms_token' as const
			};
		});
	}
}
