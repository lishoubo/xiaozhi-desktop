import { Data, Effect } from 'effect';

export type AgentExternalService = 'model' | 'mcp' | 'rms' | 'persistence';

export class AgentConfigurationError extends Data.TaggedError('AgentConfigurationError')<{
	readonly setting: string;
}> {}

export class AgentUpstreamError extends Data.TaggedError('AgentUpstreamError')<{
	readonly service: AgentExternalService;
	readonly operation: string;
	readonly kind: 'unavailable' | 'timeout' | 'invalid_response';
	readonly cause?: unknown;
}> {}

export class AgentProtocolError extends Data.TaggedError('AgentProtocolError')<{
	readonly operation: string;
	readonly reason: string;
	readonly cause?: unknown;
}> {}

export type AgentExecutionError = AgentConfigurationError | AgentUpstreamError | AgentProtocolError;

export function agentPromise<A>(
	options: Readonly<{
		service: AgentExternalService;
		operation: string;
		timeoutMs: number;
		try(signal: AbortSignal): PromiseLike<A>;
	}>
): Effect.Effect<A, AgentUpstreamError> {
	return Effect.tryPromise({
		try: options.try,
		catch: (cause) => {
			if (cause instanceof AgentUpstreamError) return cause;
			return new AgentUpstreamError({
				service: options.service,
				operation: options.operation,
				kind: 'unavailable',
				cause
			});
		}
	}).pipe(
		Effect.timeoutOrElse({
			duration: options.timeoutMs,
			orElse: () =>
				Effect.fail(
					new AgentUpstreamError({
						service: options.service,
						operation: options.operation,
						kind: 'timeout'
					})
				)
		})
	);
}

export function runAgentEffect<A, E>(
	effect: Effect.Effect<A, E>,
	signal?: AbortSignal
): Promise<A> {
	return Effect.runPromise(effect, signal ? { signal } : undefined);
}

export function isAgentExecutionError(error: unknown): error is AgentExecutionError {
	return (
		error instanceof AgentConfigurationError ||
		error instanceof AgentUpstreamError ||
		error instanceof AgentProtocolError
	);
}

export function agentErrorRetryable(error: unknown): boolean {
	if (error instanceof AgentConfigurationError || error instanceof AgentProtocolError) return false;
	if (error instanceof AgentUpstreamError) return true;
	return true;
}

export function agentFailureKind(error: unknown): string {
	if (error instanceof AgentConfigurationError) return 'model_not_configured';
	if (error instanceof AgentProtocolError) return 'protocol_failure';
	if (error instanceof AgentUpstreamError) {
		if (error.kind === 'timeout') return 'upstream_timeout';
		return error.service === 'mcp' ? 'tool_or_data_source' : `${error.service}_upstream`;
	}
	const detail = error instanceof Error ? `${error.name} ${error.message}` : String(error);
	if (/abort/i.test(detail)) return 'cancelled';
	if (/timeout|timed out|ETIMEDOUT/i.test(detail)) return 'upstream_timeout';
	if (/MCP|askDatabase|executeScript|dms-mcpr/i.test(detail)) return 'tool_or_data_source';
	return 'upstream_failure';
}

export function agentErrorType(error: unknown): string {
	if (error instanceof AgentConfigurationError) return error._tag;
	if (error instanceof AgentProtocolError) return error._tag;
	if (error instanceof AgentUpstreamError) return error._tag;
	return error instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(error.name)
		? error.name
		: 'UnknownError';
}
