import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ToolCallLifecycleStore } from './tool-call-lifecycle';

describe('ToolCallLifecycleStore', () => {
	it('preserves complete streamed arguments when a later snapshot is empty', () => {
		const store = new ToolCallLifecycleStore();

		const observed = store.observeChunk({
			id: 'call-1',
			name: 'query_hotel_operating_data_sql',
			args: '{"script":"SELECT ',
			index: 0
		});
		store.observeChunk({ args: 'hotel_id FROM fact_traffic_scene"}', index: 0 });
		store.observeSnapshot({
			id: 'call-1',
			name: 'query_hotel_operating_data_sql',
			args: {}
		});

		expect(observed).not.toBeNull();
		if (!observed) return;
		store.start(observed.trackingId, 100);
		expect(store.complete('call-1')).toEqual({
			kind: 'completed',
			call: {
				trackingId: observed.trackingId,
				name: 'query_hotel_operating_data_sql',
				args: { script: 'SELECT hotel_id FROM fact_traffic_scene' },
				mcpStartedAt: 100
			}
		});
	});

	it('isolates parallel calls and reuses an index only after the prior call completes', () => {
		const store = new ToolCallLifecycleStore();
		const first = store.observeChunk({
			id: 'call-1a',
			name: 'query',
			args: '{"script":"A',
			index: 0
		});
		const same = store.observeChunk({ id: 'call-1b', args: '"}', index: 0 });
		const parallel = store.observeChunk({
			id: 'call-2',
			name: 'query',
			args: '{"script":"B"}',
			index: 1
		});

		expect(same?.trackingId).toBe(first?.trackingId);
		expect(parallel?.trackingId).not.toBe(first?.trackingId);
		if (!first) return;
		store.start(first.trackingId, 10);
		expect(store.complete('call-1b').kind).toBe('completed');

		const reused = store.observeChunk({ id: 'call-3', name: 'query', args: '{}', index: 0 });
		expect(reused?.trackingId).not.toBe(first.trackingId);
	});

	it('does not duplicate cumulative argument chunks and prefers a complete snapshot', () => {
		const store = new ToolCallLifecycleStore();
		const observed = store.observeChunk({
			id: 'call-1',
			name: 'query',
			args: '{"script":"A',
			index: 0
		});
		store.observeChunk({ args: '{"script":"A"}', index: 0 });
		store.observeSnapshot({ id: 'call-1', name: 'query', args: { script: 'A complete query' } });

		if (!observed) return;
		store.start(observed.trackingId, null);
		expect(store.complete('call-1')).toMatchObject({
			kind: 'completed',
			call: { args: { script: 'A complete query' } }
		});
	});

	it('keeps terminal and suppressed calls out of the outstanding MCP set', () => {
		const store = new ToolCallLifecycleStore();
		const active = store.observeSnapshot({ id: 'active', name: 'query', args: { script: 'A' } });
		const suppressed = store.observeSnapshot({ id: 'suppressed', name: 'query', args: {} });

		store.start(active.trackingId, 20);
		store.suppress(suppressed.trackingId);
		expect(store.outstandingMcpCalls()).toEqual([
			{ trackingId: active.trackingId, name: 'query', startedAt: 20 }
		]);
		expect(store.complete('suppressed')).toEqual({ kind: 'suppressed' });
		store.complete('active');
		expect(store.outstandingMcpCalls()).toEqual([]);
		expect(store.complete('active')).toEqual({ kind: 'duplicate' });
		expect(store.complete('unobserved', 'query').kind).toBe('completed');
		expect(store.complete('unobserved')).toEqual({ kind: 'duplicate' });
	});

	it('never lets empty snapshots erase resolved streamed arguments', () => {
		fc.assert(
			fc.property(fc.string({ minLength: 1 }), fc.nat({ max: 20 }), (script, emptyCount) => {
				const store = new ToolCallLifecycleStore();
				const encoded = JSON.stringify({ script });
				const splitAt = Math.floor(encoded.length / 2);
				const observed = store.observeChunk({
					id: 'call',
					name: 'query',
					args: encoded.slice(0, splitAt),
					index: 0
				});
				store.observeChunk({ args: encoded.slice(splitAt), index: 0 });
				for (let index = 0; index < emptyCount; index += 1) {
					store.observeSnapshot({ id: 'call', name: 'query', args: {} });
				}
				expect(observed).not.toBeNull();
				if (!observed) return;
				store.start(observed.trackingId, null);
				expect(store.complete('call')).toMatchObject({
					kind: 'completed',
					call: { args: { script } }
				});
			})
		);
	});
});
