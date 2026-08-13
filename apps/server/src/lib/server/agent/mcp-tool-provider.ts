import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import type { DynamicStructuredTool } from '@langchain/core/tools';
import { HOTEL_DATA_MCP_SERVER_NAME } from './agent-config';
import type { McpCapability, McpServerConfig } from './agent-config';
import {
	compactHotelDataToolResult,
	constrainHotelDataGenerateSqlArgs,
	constrainHotelDataSqlArgs,
	constrainHotelDataTableDetailArgs,
	constrainHotelDataTableListArgs,
	DMS_DESCRIBE_TABLE_TOOL_NAME,
	DMS_LIST_TABLES_TOOL_NAME,
	DMS_GENERATE_SQL_TOOL_NAME,
	DMS_SQL_TOOL_NAME,
	DMS_SEARCH_DATABASE_TOOL_NAME,
	HOTEL_DATA_DESCRIBE_TABLE_TOOL_NAME,
	HOTEL_DATA_GENERATE_SQL_TOOL_NAME,
	HOTEL_DATA_LIST_TABLES_TOOL_NAME,
	HOTEL_DATA_SQL_TOOL_NAME,
	isAllowedHotelDataMcpToolName,
	selectDmsDatabaseId
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
	if (tool.name === DMS_GENERATE_SQL_TOOL_NAME) {
		tool.name = HOTEL_DATA_GENERATE_SQL_TOOL_NAME;
		tool.description =
			'根据自然语言和已配置的酒店数据库生成只读 SELECT。生成结果仍须交给受限 SQL 工具执行。';
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

	constructor(
		private readonly servers: Readonly<Record<string, McpServerConfig>>,
		private readonly dmsDatabaseId: string | null = null,
		private readonly dmsDatabaseName: string | null = null
	) {}

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
		let resolvedDmsDatabaseId = this.dmsDatabaseId;
		let resolvedDmsDatabaseName = this.dmsDatabaseName;
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
				if (name === DMS_SEARCH_DATABASE_TOOL_NAME) return;
				if (name === DMS_GENERATE_SQL_TOOL_NAME) {
					if (!resolvedDmsDatabaseId) throw new Error('DMS DatabaseId is unresolved');
					return { args: constrainHotelDataGenerateSqlArgs(args, resolvedDmsDatabaseId) };
				}
				if (name === DMS_SQL_TOOL_NAME) {
					if (!resolvedDmsDatabaseId) throw new Error('DMS DatabaseId is unresolved');
					return { args: constrainHotelDataSqlArgs(args, resolvedDmsDatabaseId) };
				}
				if (name === DMS_LIST_TABLES_TOOL_NAME) {
					if (!resolvedDmsDatabaseId) throw new Error('DMS DatabaseId is unresolved');
					return { args: constrainHotelDataTableListArgs(args, resolvedDmsDatabaseId) };
				}
				if (name === DMS_DESCRIBE_TABLE_TOOL_NAME) {
					if (!resolvedDmsDatabaseName) throw new Error('DMS database name is unresolved');
					return { args: constrainHotelDataTableDetailArgs(args, resolvedDmsDatabaseName) };
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
		const hotelDataIndex = serverNames.indexOf(HOTEL_DATA_MCP_SERVER_NAME);
		const hotelDataTools = hotelDataIndex < 0 ? [] : (loadedByServer[hotelDataIndex] ?? []);
		if (this.dmsDatabaseName) {
			const searchDatabase = hotelDataTools.find(
				(tool) => tool.name === DMS_SEARCH_DATABASE_TOOL_NAME
			);
			if (!searchDatabase) throw new Error('DMS searchDatabase tool is unavailable');
			const result = await searchDatabase.invoke({
				search_key: this.dmsDatabaseName,
				page_number: 1,
				page_size: 50
			});
			resolvedDmsDatabaseId = selectDmsDatabaseId(result, this.dmsDatabaseName, this.dmsDatabaseId);
			resolvedDmsDatabaseName = this.dmsDatabaseName;
		}
		if (hotelDataTools.length > 0 && !resolvedDmsDatabaseId) {
			throw new Error('DMS DatabaseId is unresolved');
		}
		const selected: DynamicStructuredTool[] = [];
		for (const [index, name] of serverNames.entries()) {
			const loaded = loadedByServer[index] ?? [];
			if (name === HOTEL_DATA_MCP_SERVER_NAME) {
				selected.push(
					...loaded
						.filter(
							(tool) =>
								tool.name !== DMS_SEARCH_DATABASE_TOOL_NAME &&
								isAllowedHotelDataMcpToolName(tool.name)
						)
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
