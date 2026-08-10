import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import type { DynamicStructuredTool } from '@langchain/core/tools';
import type { McpCapability, McpServerConfig } from './agent-config';

const READ_ONLY_TOOL_NAME =
	/(^|[_.:-])(get|list|read|search|find|query|inspect|lookup|fetch|check|describe)([_.:-]|$)/i;
const WRITE_TOOL_NAME =
	/(^|[_.:-])(create|update|delete|remove|set|write|mutate|execute|submit|confirm|cancel|refund|charge|pay|publish|send|sync|open|close)([_.:-]|$)/i;

export function isReadOnlyMcpToolName(name: string): boolean {
	return READ_ONLY_TOOL_NAME.test(name) && !WRITE_TOOL_NAME.test(name);
}

export class McpToolProvider {
	private client: MultiServerMCPClient | null = null;
	private tools: readonly DynamicStructuredTool[] | null = null;

	constructor(
		private readonly servers: Readonly<Record<string, McpServerConfig>>,
		private readonly allowWriteTools: boolean
	) {}

	serverCount(): number {
		return Object.keys(this.servers).length;
	}

	capabilities(): ReadonlySet<McpCapability> {
		return new Set(Object.values(this.servers).flatMap((server) => server.capabilities));
	}

	async getTools(): Promise<readonly DynamicStructuredTool[]> {
		if (this.tools) return this.tools;
		if (this.serverCount() === 0) return [];
		const connections = Object.fromEntries(
			Object.entries(this.servers).map(([name, server]) => {
				if (server.transport === 'stdio') {
					return [
						name,
						{
							transport: server.transport,
							command: server.command,
							args: server.args,
							env: server.env,
							stderr: 'pipe' as const
						}
					];
				}
				return [
					name,
					{
						transport: server.transport,
						url: server.url,
						headers: server.headers
					}
				];
			})
		);
		this.client = new MultiServerMCPClient(connections);
		const loaded = await this.client.getTools();
		this.tools = this.allowWriteTools
			? loaded
			: loaded.filter((candidate) => isReadOnlyMcpToolName(candidate.name));
		return this.tools;
	}

	async close(): Promise<void> {
		await this.client?.close();
		this.client = null;
		this.tools = null;
	}
}
