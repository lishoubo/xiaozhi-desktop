import type { GenerativeUiSpec } from '@hotel-butler/api';
import {
	generativeUiSpecSchema,
	hotelDistributionChartPropsSchema,
	hotelRadarChartPropsSchema,
	hotelRadialChartPropsSchema,
	hotelTrendChartPropsSchema
} from '@hotel-butler/api';

const ALLOWED_UI_COMPONENTS = new Set([
	'Card',
	'Stack',
	'Grid',
	'Separator',
	'Tabs',
	'Accordion',
	'Collapsible',
	'Table',
	'Heading',
	'Text',
	'Badge',
	'Alert',
	'Progress',
	'HotelAreaChart',
	'HotelLineChart',
	'HotelBarChart',
	'HotelDonutChart',
	'HotelRadarChart',
	'HotelRadialChart',
	'Tooltip',
	'Popover',
	'Button',
	'Link'
]);

const HOTEL_CHART_SCHEMAS = {
	HotelAreaChart: hotelTrendChartPropsSchema,
	HotelLineChart: hotelTrendChartPropsSchema,
	HotelBarChart: hotelTrendChartPropsSchema,
	HotelDonutChart: hotelDistributionChartPropsSchema,
	HotelRadarChart: hotelRadarChartPropsSchema,
	HotelRadialChart: hotelRadialChartPropsSchema
} as const;

export function validateHotelUi(spec: GenerativeUiSpec): GenerativeUiSpec {
	const parsed = generativeUiSpecSchema.parse(spec);
	if (JSON.stringify(parsed).length > 200_000) {
		throw new Error('Generative UI exceeds the 200 KB limit');
	}
	const entries = Object.entries(parsed.elements);
	if (entries.length > 100) throw new Error('Generative UI exceeds the 100 element limit');
	if (!parsed.elements[parsed.root]) throw new Error('Generative UI root element is missing');
	for (const [id, element] of entries) {
		if (!ALLOWED_UI_COMPONENTS.has(element.type)) {
			throw new Error(`Generative UI component is not allowed: ${element.type}`);
		}
		if (element.type in HOTEL_CHART_SCHEMAS) {
			HOTEL_CHART_SCHEMAS[element.type as keyof typeof HOTEL_CHART_SCHEMAS].parse(element.props);
		}
		if (element.type === 'Table') {
			const rows = element.props.rows;
			const columns = element.props.columns;
			if (
				!Array.isArray(columns) ||
				columns.length === 0 ||
				!columns.every((column) => typeof column === 'string' && column.trim())
			) {
				throw new Error('Generative UI tables require non-empty string columns');
			}
			if (!Array.isArray(rows)) throw new Error('Generative UI tables require row arrays');
			if (Array.isArray(rows) && rows.length > 50) {
				throw new Error('Generative UI tables cannot exceed 50 rows');
			}
			if (Array.isArray(columns) && columns.length > 12) {
				throw new Error('Generative UI tables cannot exceed 12 columns');
			}
			const scalar = (value: unknown): boolean =>
				value === null ||
				typeof value === 'string' ||
				typeof value === 'boolean' ||
				(typeof value === 'number' && Number.isFinite(value));
			if (
				!rows.every(
					(row) =>
						Array.isArray(row) && row.length === columns.length && row.every((cell) => scalar(cell))
				)
			) {
				throw new Error('Generative UI tables require rectangular rows with scalar cells');
			}
		}
		if (element.type === 'Link' && typeof element.props.href === 'string') {
			const href = element.props.href;
			if (!href.startsWith('/') && new URL(href).protocol !== 'https:') {
				throw new Error('Generative UI links must use HTTPS or an application-relative path');
			}
		}
		for (const child of element.children) {
			if (!parsed.elements[child]) {
				throw new Error(`Generative UI child is missing: ${id}/${child}`);
			}
		}
	}
	return parsed;
}
