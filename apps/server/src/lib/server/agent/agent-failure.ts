import type { AgentFailureCode, AgentFailureRecovery } from '@hotel-butler/api';
import { AgentConfigurationError, AgentProtocolError, AgentUpstreamError } from './agent-effect';
import { AgentQueryInvalidError, AgentQueryRejectedError } from './agent-query-error';
import { mcpResultText } from './mcp-observability';

export type AgentFailureDescriptor = Readonly<{
	code: AgentFailureCode;
	message: string;
	recovery: AgentFailureRecovery;
	retryable: boolean;
}>;

const descriptor = (
	code: AgentFailureCode,
	message: string,
	recovery: AgentFailureRecovery
): AgentFailureDescriptor => ({ code, message, recovery, retryable: recovery === 'retry' });

function causeChain(error: unknown): readonly unknown[] {
	const chain: unknown[] = [];
	let current = error;
	for (let depth = 0; depth < 5; depth += 1) {
		chain.push(current);
		if (typeof current !== 'object' || current === null || !('cause' in current)) break;
		current = Reflect.get(current, 'cause');
		if (current === undefined) break;
	}
	return chain;
}

function chainHas(
	error: unknown,
	type: typeof AgentQueryRejectedError | typeof AgentQueryInvalidError
) {
	return causeChain(error).some((cause) => cause instanceof type);
}

export function describeAgentFailure(error: unknown): AgentFailureDescriptor {
	if (chainHas(error, AgentQueryRejectedError)) {
		return descriptor(
			'query_rejected',
			'生成的数据查询未通过安全校验，已停止执行。请换一种说法或缩小查询范围后再试。',
			'revise_request'
		);
	}
	if (chainHas(error, AgentQueryInvalidError)) {
		return descriptor(
			'query_invalid',
			'没有生成可执行的数据查询。请明确要查询的指标、酒店和日期范围后再试。',
			'revise_request'
		);
	}
	if (causeChain(error).some((cause) => cause instanceof AgentConfigurationError)) {
		return descriptor(
			'configuration_error',
			'Agent 所需服务尚未配置完成，请联系管理员处理。',
			'contact_admin'
		);
	}
	if (causeChain(error).some((cause) => cause instanceof AgentProtocolError)) {
		return descriptor(
			'execution_protocol_error',
			'本次任务的执行步骤出现异常，已安全停止。如再次出现，请联系管理员。',
			'contact_admin'
		);
	}
	if (error instanceof AgentUpstreamError) {
		if (error.service === 'mcp' || error.service === 'rms') {
			if (error.kind === 'timeout') {
				return descriptor(
					'data_source_timeout',
					'经营数据查询超时。请稍后重试，或缩小日期范围和查询范围。',
					'retry'
				);
			}
			if (error.kind === 'invalid_response' && error.operation.includes('query')) {
				return descriptor(
					'query_invalid',
					'没有生成可执行的数据查询。请明确要查询的指标、酒店和日期范围后再试。',
					'revise_request'
				);
			}
			return descriptor(
				'data_source_unavailable',
				'暂时无法连接酒店经营数据，请稍后重试。',
				'retry'
			);
		}
		if (error.service === 'model') {
			if (error.kind === 'timeout') {
				return descriptor(
					'model_timeout',
					error.operation === 'analyze_grounded_answer'
						? '经营数据和图表已展示，但分析超时；可先查看结果或稍后重试。'
						: '分析服务响应超时，请稍后重试。',
					'retry'
				);
			}
			if (error.kind === 'invalid_response') {
				return descriptor(
					'model_output_invalid',
					error.operation === 'analyze_grounded_answer'
						? '经营数据和图表已展示，但分析未完成；可先查看结果或重试。'
						: '分析结果未能完整生成，请稍后重试。',
					'retry'
				);
			}
			return descriptor('model_unavailable', '分析服务暂时繁忙，请稍后重试。', 'retry');
		}
	}
	return descriptor('unexpected_error', '小智暂时无法完成这次任务，请稍后重试。', 'retry');
}

export function evidenceFailure(reasonCode: string): AgentFailureDescriptor {
	return {
		code: 'evidence_rejected',
		message:
			reasonCode === 'evidence_scope_mismatch'
				? '返回数据与本次选择的酒店不一致，已停止生成结论。请确认酒店后重新查询。'
				: '返回数据未通过完整性校验，暂时无法生成可靠结论。请调整查询条件后再试。',
		recovery: 'revise_request',
		retryable: false
	};
}

const QUERY_POLICY_MESSAGE =
	/经营数据 SQL (?:只允许|不允许|包含不允许|过长)|酒店数据查询不允许|酒店数据查询.*酒店范围|员工酒店数据查询(?:超出|缺少|只允许)|当前账号没有可查询的酒店|酒店数据访问范围无效/i;
const DATA_SOURCE_TIMEOUT_MESSAGE = /timeout|timed out|超时|ETIMEDOUT/i;
const DATA_SOURCE_UNAVAILABLE_MESSAGE =
	/connection refused|connection reset|连接失败|连接中断|服务不可用|unavailable|ECONNREFUSED|ECONNRESET|socket hang up|SSE session/i;

export function describeToolFailure(
	toolName: string,
	resultOrError: unknown
): AgentFailureDescriptor {
	if (
		resultOrError instanceof AgentUpstreamError ||
		resultOrError instanceof AgentProtocolError ||
		resultOrError instanceof AgentConfigurationError ||
		resultOrError instanceof AgentQueryRejectedError ||
		resultOrError instanceof AgentQueryInvalidError
	) {
		return describeAgentFailure(resultOrError);
	}
	const text =
		mcpResultText(resultOrError) ?? (resultOrError instanceof Error ? resultOrError.message : '');
	if (QUERY_POLICY_MESSAGE.test(text)) {
		return descriptor(
			'query_rejected',
			'生成的数据查询未通过安全校验，已停止执行。请换一种说法或缩小查询范围后再试。',
			'revise_request'
		);
	}
	if (DATA_SOURCE_TIMEOUT_MESSAGE.test(text)) {
		return descriptor(
			'data_source_timeout',
			'经营数据查询超时。请稍后重试，或缩小日期范围和查询范围。',
			'retry'
		);
	}
	if (DATA_SOURCE_UNAVAILABLE_MESSAGE.test(text)) {
		return descriptor('data_source_unavailable', '暂时无法连接酒店经营数据，请稍后重试。', 'retry');
	}
	if (/query_hotel_operating_data_sql|executeScript/i.test(toolName)) {
		return descriptor(
			'query_invalid',
			'没有生成可执行的数据查询。请明确要查询的指标、酒店和日期范围后再试。',
			'revise_request'
		);
	}
	return descriptor('data_source_unavailable', '暂时无法连接酒店经营数据，请稍后重试。', 'retry');
}

export function toolFailureSummary(failure: AgentFailureDescriptor): string {
	switch (failure.code) {
		case 'query_rejected':
			return '查询未通过安全校验，已停止执行';
		case 'query_invalid':
			return '查询条件或语句无法执行';
		case 'data_source_timeout':
			return '经营数据查询超时';
		case 'data_source_unavailable':
			return '经营数据暂时无法连接';
		case 'model_timeout':
			return '分析服务响应超时';
		case 'model_unavailable':
			return '分析服务暂时不可用';
		case 'model_output_invalid':
			return '分析结果未能完整生成';
		case 'evidence_rejected':
			return '返回数据未通过校验';
		case 'configuration_error':
			return '所需服务尚未配置';
		case 'execution_protocol_error':
			return '执行步骤出现异常';
		case 'unexpected_error':
			return '工具执行未成功';
	}
}

export function toolFailureCause(failure: AgentFailureDescriptor): Error | undefined {
	if (failure.code === 'query_rejected') return new AgentQueryRejectedError(failure.message);
	if (failure.code === 'query_invalid') return new AgentQueryInvalidError(failure.message);
	return undefined;
}

export function toolFailureUpstreamKind(
	failure: AgentFailureDescriptor
): AgentUpstreamError['kind'] {
	if (failure.code === 'data_source_timeout') return 'timeout';
	if (failure.code === 'query_rejected' || failure.code === 'query_invalid') {
		return 'invalid_response';
	}
	return 'unavailable';
}
