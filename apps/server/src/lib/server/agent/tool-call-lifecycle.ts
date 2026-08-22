export type ToolCallChunkFragment = Readonly<{
	id?: string;
	name?: string;
	args?: string;
	index?: number;
}>;

export type ToolCallSnapshot = Readonly<{
	id: string;
	name: string;
	args: unknown;
}>;

export type ObservedToolCall = Readonly<{
	trackingId: string;
	name: string | null;
}>;

export type CompletedToolCall = Readonly<{
	trackingId: string;
	name: string;
	args: unknown;
	mcpStartedAt: number | null;
}>;

export type ToolCallCompletion =
	| Readonly<{ kind: 'completed'; call: CompletedToolCall }>
	| Readonly<{ kind: 'duplicate' | 'suppressed' }>;

type ToolCallStatus = 'collecting' | 'started' | 'suppressed' | 'completed';

type ToolCallState = {
	readonly trackingId: string;
	readonly aliases: Set<string>;
	index: number | null;
	name: string;
	streamedArgs: string;
	snapshotArgs: unknown;
	status: ToolCallStatus;
	mcpStartedAt: number | null;
};

function mergeStreamFragment(current: string, fragment: string | undefined): string {
	if (!fragment) return current;
	if (!current || fragment.startsWith(current)) return fragment;
	return `${current}${fragment}`;
}

function parsedStreamArgs(value: string): unknown {
	if (!value) return null;
	try {
		return JSON.parse(value);
	} catch {
		// Retain malformed text so unresolved calls still have a distinct identity.
		return value;
	}
}

function argsCompleteness(value: unknown): readonly [structure: number, size: number] {
	if (value === null || value === undefined) return [0, 0];
	if (typeof value === 'string') return value.trim() ? [1, value.trim().length] : [0, 0];
	if (Array.isArray(value) && value.length === 0) return [0, 0];
	if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) {
		return [0, 0];
	}
	try {
		return [typeof value === 'object' ? 2 : 1, JSON.stringify(value)?.length ?? 0];
	} catch {
		return [typeof value === 'object' ? 2 : 1, 1];
	}
}

export function mostCompleteToolArgs(...candidates: readonly unknown[]): unknown | null {
	let selected: unknown = null;
	let selectedCompleteness: readonly [structure: number, size: number] = [0, 0];
	for (const candidate of candidates) {
		const completeness = argsCompleteness(candidate);
		if (
			completeness[0] < selectedCompleteness[0] ||
			(completeness[0] === selectedCompleteness[0] && completeness[1] <= selectedCompleteness[1])
		) {
			continue;
		}
		selected = candidate;
		selectedCompleteness = completeness;
	}
	return selected;
}

function preferredName(current: string, candidate: string | undefined): string {
	if (!candidate) return current;
	return candidate.length > current.length ? candidate : current;
}

export class ToolCallLifecycleStore {
	readonly #byTrackingId = new Map<string, ToolCallState>();
	readonly #byAlias = new Map<string, ToolCallState>();
	readonly #byIndex = new Map<number, ToolCallState>();
	#nextTrackingId = 1;

	observeChunk(fragment: ToolCallChunkFragment): ObservedToolCall | null {
		const state = this.#stateForObservation(fragment.id, fragment.index, false);
		if (fragment.id) this.#addAlias(state, fragment.id);
		state.name = mergeStreamFragment(state.name, fragment.name);
		state.streamedArgs = mergeStreamFragment(state.streamedArgs, fragment.args);
		if (fragment.index !== undefined) {
			state.index = fragment.index;
			this.#byIndex.set(fragment.index, state);
		}
		return state.aliases.size > 0 || state.name || state.streamedArgs
			? this.#observed(state)
			: null;
	}

	observeSnapshot(snapshot: ToolCallSnapshot): ObservedToolCall {
		const state = this.#stateForObservation(snapshot.id, undefined, true);
		this.#addAlias(state, snapshot.id);
		state.name = preferredName(state.name, snapshot.name);
		state.snapshotArgs = mostCompleteToolArgs(state.snapshotArgs, snapshot.args);
		return this.#observed(state);
	}

	hasStarted(trackingId: string): boolean {
		const state = this.#byTrackingId.get(trackingId);
		return state !== undefined && state.status !== 'collecting';
	}

	start(trackingId: string, mcpStartedAt: number | null): void {
		const state = this.#byTrackingId.get(trackingId);
		if (!state || state.status !== 'collecting') return;
		state.status = 'started';
		state.mcpStartedAt = mcpStartedAt;
	}

	suppress(trackingId: string): void {
		const state = this.#byTrackingId.get(trackingId);
		if (!state || state.status !== 'collecting') return;
		state.status = 'suppressed';
	}

	complete(rawCallId: string, resultName?: string): ToolCallCompletion {
		const existing = this.#byAlias.get(rawCallId);
		const state = existing ?? this.#newState(rawCallId);
		if (!existing) this.#addAlias(state, rawCallId);
		if (state.status === 'completed') return { kind: 'duplicate' };
		if (state.status === 'suppressed') {
			state.status = 'completed';
			this.#releaseIndex(state);
			return { kind: 'suppressed' };
		}
		state.status = 'completed';
		this.#releaseIndex(state);
		return {
			kind: 'completed',
			call: {
				trackingId: state.trackingId,
				name: resultName?.trim() || state.name || 'tool',
				args: mostCompleteToolArgs(state.snapshotArgs, parsedStreamArgs(state.streamedArgs)),
				mcpStartedAt: state.mcpStartedAt
			}
		};
	}

	outstandingMcpCalls(): readonly Readonly<{
		trackingId: string;
		name: string;
		startedAt: number;
	}>[] {
		return [...this.#byTrackingId.values()].flatMap((state) =>
			state.status === 'started' && state.mcpStartedAt !== null
				? [
						{
							trackingId: state.trackingId,
							name: state.name || 'mcp_tool',
							startedAt: state.mcpStartedAt
						}
					]
				: []
		);
	}

	#stateForObservation(
		id: string | undefined,
		index: number | undefined,
		preferRawId: boolean
	): ToolCallState {
		const byAlias = id ? this.#byAlias.get(id) : undefined;
		const byIndex = index === undefined ? undefined : this.#byIndex.get(index);
		const activeByAlias = byAlias?.status === 'completed' ? undefined : byAlias;
		const activeByIndex = byIndex?.status === 'completed' ? undefined : byIndex;
		return (
			activeByAlias ??
			activeByIndex ??
			this.#newState(preferRawId && id ? id : `stream-tool-call-${this.#nextTrackingId++}`)
		);
	}

	#newState(trackingId: string): ToolCallState {
		const state: ToolCallState = {
			trackingId,
			aliases: new Set(),
			index: null,
			name: '',
			streamedArgs: '',
			snapshotArgs: null,
			status: 'collecting',
			mcpStartedAt: null
		};
		this.#byTrackingId.set(trackingId, state);
		return state;
	}

	#addAlias(state: ToolCallState, alias: string): void {
		state.aliases.add(alias);
		this.#byAlias.set(alias, state);
	}

	#releaseIndex(state: ToolCallState): void {
		if (state.index !== null && this.#byIndex.get(state.index) === state) {
			this.#byIndex.delete(state.index);
		}
	}

	#observed(state: ToolCallState): ObservedToolCall {
		return {
			trackingId: state.trackingId,
			name: state.name || null
		};
	}
}
