export type AgentSkill = Readonly<{ name: string; instructions: string }>;

export interface SkillProvider {
	list(): Promise<readonly AgentSkill[]>;
}

/** 业务 Skill 尚未确定；用显式空实现保持运行时接口稳定。 */
export class EmptySkillProvider implements SkillProvider {
	async list(): Promise<readonly AgentSkill[]> {
		return [];
	}
}
