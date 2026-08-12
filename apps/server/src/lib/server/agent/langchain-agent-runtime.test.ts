import type { GenerativeUiSpec } from '@hotel-butler/api';
import { describe, expect, it } from 'vitest';
import {
	DuplicateUiRenderError,
	recoverCompletedUiAfterRenderLimit,
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
