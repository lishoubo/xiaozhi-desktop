import type { GenerativeUiSpec } from '@hotel-butler/api';
import type { AgentPrincipal } from '@hotel-butler/api/router';
import { validateHotelUi } from './hotel-ui-validator';

type RememberInput = Readonly<{ key: string; content: string; importance: number }>;

export interface AgentMemoryPort {
	remember(principal: AgentPrincipal, input: RememberInput): Promise<void>;
}

export class HotelAgentToolHandlers {
	constructor(private readonly memories: AgentMemoryPort) {}

	async remember(principal: AgentPrincipal, input: RememberInput): Promise<string> {
		await this.memories.remember(principal, input);
		return '已保存到当前员工的长期记忆。';
	}

	renderUi(spec: GenerativeUiSpec): GenerativeUiSpec {
		return validateHotelUi(spec);
	}
}
