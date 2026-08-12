import type { AgentPrincipal, GenerativeUiSpec } from '@hotel-butler/api';
import { validateHotelUi } from './hotel-ui-validator';

type MemoryRecord = Readonly<{ key: string; content: string; importance: number }>;
type RememberInput = Readonly<{ key: string; content: string; importance: number }>;

export interface AgentMemoryPort {
	listMemories(principal: AgentPrincipal): Promise<readonly MemoryRecord[]>;
	remember(principal: AgentPrincipal, input: RememberInput): Promise<void>;
}

export class HotelAgentToolHandlers {
	constructor(private readonly memories: AgentMemoryPort) {}

	async recall(principal: AgentPrincipal): Promise<string> {
		return JSON.stringify(await this.memories.listMemories(principal));
	}

	async remember(principal: AgentPrincipal, input: RememberInput): Promise<string> {
		await this.memories.remember(principal, input);
		return '已保存到当前员工的长期记忆。';
	}

	renderUi(spec: GenerativeUiSpec): GenerativeUiSpec {
		return validateHotelUi(spec);
	}
}
