import { describe, expect, it } from 'vitest';
import { routeStructuredOutputConfig } from './langchain-route-classifier';

describe('LangChain route classifier configuration', () => {
	it('uses Kimi-compatible function calling instead of inferred OpenAI JSON Schema mode', () => {
		expect(routeStructuredOutputConfig).toEqual({
			name: 'route_hotel_request',
			method: 'functionCalling',
			strict: true,
			includeRaw: true
		});
	});
});
