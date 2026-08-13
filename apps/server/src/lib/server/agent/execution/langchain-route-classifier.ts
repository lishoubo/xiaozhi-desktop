import { ChatOpenAI } from '@langchain/openai';
import type { AgentEnvironment } from '../agent-config';
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
slots 只放用户原文中明确出现的候选值；日期原词保留，不要自行猜测。`;

export class LangChainRouteClassifier implements RouteClassifier {
	private readonly model: ChatOpenAI;

	constructor(environment: AgentEnvironment) {
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
		const structured = this.model.withStructuredOutput(routeClassifierOutputSchema, {
			name: 'route_hotel_request'
		});
		for (let attempt = 0; attempt < 2; attempt += 1) {
			try {
				return routeClassifierOutputSchema.parse(
					await structured.invoke([
						{ role: 'system', content: SYSTEM_PROMPT },
						{
							role: 'user',
							content:
								attempt === 0
									? input.text
									: `${input.text}\n\n上次输出未通过 schema，请只返回符合定义的结构。`
						}
					])
				);
			} catch {
				// One bounded schema retry is allowed before falling back to a safe unclear route.
			}
		}
		return {
			category: 'unclear',
			intentCandidate: null,
			requestedEffect: 'unclear',
			confidence: 0,
			slots: {}
		};
	}
}
