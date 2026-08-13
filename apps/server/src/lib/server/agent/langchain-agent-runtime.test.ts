import type { GenerativeUiSpec } from '@hotel-butler/api';
import { describe, expect, it } from 'vitest';
import {
	DuplicateUiRenderError,
	recoverCompletedUiAfterRenderLimit,
	selectWorkflowToolNames,
	shouldCaptureToolEvidence,
	shouldSuppressUiRenderCall,
	shouldStopDuplicateUiRender
} from './langchain-agent-runtime';

const ui: GenerativeUiSpec = {
	root: 'root',
	state: {},
	elements: {
		root: { type: 'Table', props: {}, children: [], visible: true }
	}
};

describe('recoverCompletedUiAfterRenderLimit', () => {
	it('allows correction until a valid UI exists, then stops another render', () => {
		expect(shouldStopDuplicateUiRender(false, ['render_hotel_ui'])).toBe(false);
		expect(shouldStopDuplicateUiRender(true, ['query_weather'])).toBe(false);
		expect(shouldStopDuplicateUiRender(true, ['render_hotel_ui'])).toBe(true);
	});

	it('completes with the first UI when the model attempts to render again', () => {
		const error = new DuplicateUiRenderError();

		expect(recoverCompletedUiAfterRenderLimit(error, '天气数据已获取：', ui)).toEqual({
			content: '天气数据已获取：\n\n结果视图已经生成，请结合上方数据查看。',
			ui
		});
	});

	it('does not hide unrelated failures or a failed first render', () => {
		expect(recoverCompletedUiAfterRenderLimit(new Error('upstream'), '', ui)).toBeNull();
		expect(recoverCompletedUiAfterRenderLimit(new DuplicateUiRenderError(), '', null)).toBeNull();
	});
});

describe('selectWorkflowToolNames', () => {
	const available = [
		'query_hotel_operating_data',
		'query_weather_forecast',
		'search_room_rates',
		'update_room_rate'
	];

	it('narrows evidence collection to the intent allowlist and removes MCP tools after validation', () => {
		const workflowRequest = {
			routeKind: 'business_read' as const,
			intent: 'hotel_operating_summary' as const,
			slots: {}
		};
		expect(selectWorkflowToolNames({ workflowRequest }, available)).toEqual([
			'query_hotel_operating_data'
		]);
		expect(selectWorkflowToolNames({ workflowRequest, validatedEvidence: [] }, available)).toEqual([
			'render_hotel_ui'
		]);
	});
});

describe('tool evidence capture', () => {
	it('does not treat an error ToolMessage as business evidence', () => {
		expect(shouldCaptureToolEvidence('error')).toBe(false);
		expect(shouldCaptureToolEvidence('success')).toBe(true);
		expect(shouldCaptureToolEvidence(undefined)).toBe(true);
	});

	it('suppresses lifecycle publication for every render call after the first call id', () => {
		expect(shouldSuppressUiRenderCall('render_hotel_ui', 'render-1', null)).toBe(false);
		expect(shouldSuppressUiRenderCall('render_hotel_ui', 'render-1', 'render-1')).toBe(false);
		expect(shouldSuppressUiRenderCall('render_hotel_ui', 'render-2', 'render-1')).toBe(true);
		expect(shouldSuppressUiRenderCall('query_weather', 'weather-1', 'render-1')).toBe(false);
	});
});
