import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import type { DynamicStructuredTool } from '@langchain/core/tools';
import { HOTEL_DATA_MCP_SERVER_NAME } from './agent-config';
import type { McpCapability, McpServerConfig } from './agent-config';
import {
	compactHotelDataToolResult,
	constrainHotelDataQueryArgs,
	constrainHotelDataSqlArgs,
	constrainHotelDataTableListArgs,
	DMS_LIST_TABLES_TOOL_NAME,
	DMS_QUERY_TOOL_NAME,
	DMS_SQL_TOOL_NAME,
	HOTEL_DATA_DESCRIBE_TABLE_TOOL_NAME,
	HOTEL_DATA_LIST_TABLES_TOOL_NAME,
	HOTEL_DATA_SQL_TOOL_NAME,
	HOTEL_DATA_TOOL_NAME,
	isAllowedHotelDataMcpToolName
} from './hotel-data-mcp';

const READ_ONLY_TOOL_NAME =
	/(^|[_.:-])(get|list|read|search|find|query|inspect|lookup|fetch|check|describe)([_.:-]|$)/i;
const WRITE_TOOL_NAME =
	/(^|[_.:-])(create|update|delete|remove|set|write|mutate|execute|submit|confirm|cancel|refund|charge|pay|publish|send|sync|open|close)([_.:-]|$)/i;

export function isReadOnlyMcpToolName(name: string): boolean {
	return READ_ONLY_TOOL_NAME.test(name) && !WRITE_TOOL_NAME.test(name);
}

export function loadMcpServerToolsInOrder<T>(
	serverNames: readonly string[],
	load: (serverName: string) => Promise<readonly T[]>
): Promise<readonly (readonly T[])[]> {
	return Promise.all(serverNames.map((serverName) => load(serverName)));
}

function configureHotelDataTool(tool: DynamicStructuredTool): DynamicStructuredTool {
	if (tool.name === DMS_QUERY_TOOL_NAME) {
		tool.name = HOTEL_DATA_TOOL_NAME;
		tool.description =
			'用自然语言查询酒店经营数据。优先用于简单指标；若无法生成 SQL，先查看表和字段，再使用受限 SQL 查询工具。只读。';
	} else if (tool.name === DMS_SQL_TOOL_NAME) {
		tool.name = HOTEL_DATA_SQL_TOOL_NAME;
		tool.description =
			'执行一条酒店经营数据 SELECT/CTE 查询。系统会拒绝写操作、多语句、注释、文件操作、锁和高风险函数，并将结果限制为 50 行。';
	} else if (tool.name === DMS_LIST_TABLES_TOOL_NAME) {
		tool.name = HOTEL_DATA_LIST_TABLES_TOOL_NAME;
		tool.description = '列出或搜索 DMS 当前数据库中的业务表。只读。';
	} else {
		tool.name = HOTEL_DATA_DESCRIBE_TABLE_TOOL_NAME;
		tool.description = '读取指定 DMS 业务表的字段和索引元数据。只读。';
	}
	return tool;
}

export class McpToolProvider {
	private client: MultiServerMCPClient | null = null;
	private toolsPromise: Promise<readonly DynamicStructuredTool[]> | null = null;

	constructor(private readonly servers: Readonly<Record<string, McpServerConfig>>) {}

	serverCount(): number {
		return Object.keys(this.servers).length;
	}

	capabilities(): ReadonlySet<McpCapability> {
		return new Set(Object.values(this.servers).flatMap((server) => server.capabilities));
	}

	getTools(): Promise<readonly DynamicStructuredTool[]> {
		if (!this.toolsPromise) {
			this.toolsPromise = this.loadTools().catch((error: unknown) => {
				this.toolsPromise = null;
				throw error;
			});
		}
		return this.toolsPromise;
	}

	private async loadTools(): Promise<readonly DynamicStructuredTool[]> {
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
		const client = new MultiServerMCPClient({
			mcpServers: connections,
			defaultToolTimeout: 45_000,
			onConnectionError: ({ serverName, error }) => {
				if (serverName !== HOTEL_DATA_MCP_SERVER_NAME) throw error;
			},
			beforeToolCall: ({ serverName, name, args }) => {
				if (serverName !== HOTEL_DATA_MCP_SERVER_NAME) return;
				if (name === DMS_QUERY_TOOL_NAME) return { args: constrainHotelDataQueryArgs(args) };
				if (name === DMS_SQL_TOOL_NAME) return { args: constrainHotelDataSqlArgs(args) };
				if (name === DMS_LIST_TABLES_TOOL_NAME) {
					return { args: constrainHotelDataTableListArgs(args) };
				}
			},
			afterToolCall: ({ serverName, result }) => {
				if (serverName !== HOTEL_DATA_MCP_SERVER_NAME) return;
				return { result: compactHotelDataToolResult(result) };
			}
		});
		this.client = client;

		const serverNames = Object.keys(this.servers);
		const loadedByServer = await loadMcpServerToolsInOrder(serverNames, (name) =>
			client.getTools(name)
		);
		const selected: DynamicStructuredTool[] = [];
		for (const [index, name] of serverNames.entries()) {
			const loaded = loadedByServer[index] ?? [];
			if (name === HOTEL_DATA_MCP_SERVER_NAME) {
				selected.push(
					...loaded
						.filter((tool) => isAllowedHotelDataMcpToolName(tool.name))
						.map(configureHotelDataTool)
				);
				continue;
			}
			selected.push(...loaded.filter((candidate) => isReadOnlyMcpToolName(candidate.name)));
		}
		return selected;
	}

	async close(): Promise<void> {
		await this.client?.close();
		this.client = null;
		this.toolsPromise = null;
	}
}
