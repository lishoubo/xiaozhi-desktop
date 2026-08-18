import { ChatOpenAI } from '@langchain/openai';
import { Effect } from 'effect';
import type { AgentEnvironment } from '../agent-config';
import {
	agentPromise,
	AgentConfigurationError,
	AgentProtocolError,
	runAgentEffect
} from '../agent-effect';
import {
	routeClassifierOutputSchema,
	type RouteClassifier,
	type RouteClassifierOutput
} from './business-intent-router';

const SYSTEM_PROMPT = `你是酒店助手的请求路由器，只分类和抽取候选参数，不回答用户。
category 只能表示：普通对话、酒店知识、业务读、业务写或不清楚。
任何会改变订单、价格、库存、房态、支付、配置或数据的请求都属于 business_write。
已知业务读意图：
- weather_operations_advice：天气及经营建议
- hotel_operating_summary：酒店经营概览、指标、趋势
- public_hotel_rates：公开房价查询
- generic_hotel_data_query：其他安全的酒店数据读取
slots 只放用户原文中明确出现的候选值；日期原词保留，不要自行猜测。
responseMode 只有在用户明确表示“只查数据、不需要分析/建议”时才是 data_only；其余情况一律为 analysis。`;

export class LangChainRouteClassifier implements RouteClassifier {
	private readonly model: ChatOpenAI;
	private readonly configured: boolean;

	constructor(environment: AgentEnvironment) {
		this.configured = Boolean(environment.apiKey);
		this.model = new ChatOpenAI({
			model: environment.model,
			apiKey: environment.apiKey,
			maxTokens: 1_024,
			maxRetries: 2,
			timeout: 30_000,
			configuration: { baseURL: environment.baseUrl }
		});
	}

	async classify(input: Readonly<{ text: string }>): Promise<RouteClassifierOutput> {
		if (!this.configured) throw new AgentConfigurationError({ setting: 'AI_KIMI_API_KEY' });
		const structured = this.model.withStructuredOutput(routeClassifierOutputSchema, {
			name: 'route_hotel_request',
			includeRaw: true
		});
		let attempt = 0;
		const classify = Effect.gen(function* () {
			const response = yield* agentPromise({
				service: 'model',
				operation: 'classify_route',
				timeoutMs: 35_000,
				try: (signal) =>
					structured.invoke(
						[
							{ role: 'system', content: SYSTEM_PROMPT },
							{
								role: 'user',
								content:
									attempt === 0
										? input.text
										: `${input.text}\n\n上次输出未通过 schema，请只返回符合定义的结构。`
							}
						],
						{ signal }
					)
			});
			return yield* Effect.try({
				try: () => routeClassifierOutputSchema.parse(response.parsed),
				catch: (cause) =>
					new AgentProtocolError({
						operation: 'classify_route',
						reason: 'Model output did not match the route schema',
						cause
					})
			});
		}).pipe(
			Effect.retry({
				times: 1,
				while: (error) => {
					if (!(error instanceof AgentProtocolError)) return false;
					attempt += 1;
					return true;
				}
			}),
			Effect.catchIf(
				(error) => error instanceof AgentProtocolError,
				() =>
					Effect.succeed<RouteClassifierOutput>({
						category: 'unclear',
						intentCandidate: null,
						requestedEffect: 'unclear',
						responseMode: 'analysis',
						confidence: 0,
						slots: {}
					})
			)
		);
		return runAgentEffect(classify);
	}
}
