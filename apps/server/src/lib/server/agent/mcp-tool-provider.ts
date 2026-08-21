import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import type { DynamicStructuredTool } from '@langchain/core/tools';
import { Effect } from 'effect';
import { HOTEL_DATA_MCP_SERVER_NAME } from './agent-config';
import type { McpCapability, McpServerConfig } from './agent-config';
import { agentPromise, AgentProtocolError, runAgentEffect } from './agent-effect';
import { currentHotelDataAccessScope } from './hotel-data-access-scope';
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
	HOTEL_DATA_RESULT_ROW_LIMIT,
	HOTEL_DATA_SQL_TOOL_NAME,
	isEmptyHotelDataTableListResult,
	isAllowedHotelDataMcpToolName,
	resolveDmsDatabaseId
} from './hotel-data-mcp';

const READ_ONLY_TOOL_NAME =
	/(^|[_.:-])(get|list|read|search|find|query|inspect|lookup|fetch|check|describe)([_.:-]|$)/i;
const WRITE_TOOL_NAME =
	/(^|[_.:-])(create|update|delete|remove|set|write|mutate|execute|submit|confirm|cancel|refund|charge|pay|publish|send|sync|open|close)([_.:-]|$)/i;

type McpToolProviderLogger = Readonly<{
	info?(fields: Readonly<Record<string, unknown>>, message: string): void;
	warn(fields: Readonly<Record<string, unknown>>, message: string): void;
	error?(fields: Readonly<Record<string, unknown>>, message: string): void;
}>;

export function isReadOnlyMcpToolName(name: string): boolean {
	return READ_ONLY_TOOL_NAME.test(name) && !WRITE_TOOL_NAME.test(name);
}

export function makeServerInjectedDatabaseIdOptional(schema: unknown): void {
	if (typeof schema !== 'object' || schema === null) return;
	const required = Reflect.get(schema, 'required');
	if (Array.isArray(required)) {
		Reflect.set(
			schema,
			'required',
			required.filter((name) => name !== 'database_id')
		);
	}
	const properties = Reflect.get(schema, 'properties');
	if (typeof properties !== 'object' || properties === null) return;
	const databaseId = Reflect.get(properties, 'database_id');
	if (typeof databaseId === 'object' && databaseId !== null) {
		Reflect.set(databaseId, 'description', '由服务端安全注入，请勿填写或猜测');
	}
}

export function loadMcpServerToolsInOrder<T>(
	serverNames: readonly string[],
	load: (serverName: string) => Promise<readonly T[]>
): Promise<readonly (readonly T[])[]> {
	return runAgentEffect(
		Effect.forEach(
			serverNames,
			(serverName) =>
				agentPromise({
					service: 'mcp',
					operation: `load_tool_catalog:${serverName}`,
					timeoutMs: 50_000,
					try: () => load(serverName)
				}),
			{ concurrency: 'unbounded' }
		)
	);
}

export function selectMcpServersByCapabilities(
	servers: Readonly<Record<string, McpServerConfig>>,
	capabilities: readonly McpCapability[]
): Readonly<Record<string, McpServerConfig>> {
	const allowed = new Set(capabilities);
	return Object.fromEntries(
		Object.entries(servers).filter(([, server]) =>
			server.capabilities.some((capability) => allowed.has(capability))
		)
	);
}

export function hotelDataToolCatalogIsHealthy(
	capabilities: readonly McpCapability[],
	tools: readonly Readonly<{ name: string }>[]
): boolean {
	return (
		!capabilities.includes('hotel_data') ||
		tools.some((tool) => tool.name === HOTEL_DATA_SQL_TOOL_NAME)
	);
}

function configureHotelDataTool(tool: DynamicStructuredTool): DynamicStructuredTool {
	if (
		tool.name === DMS_GENERATE_SQL_TOOL_NAME ||
		tool.name === DMS_SQL_TOOL_NAME ||
		tool.name === DMS_LIST_TABLES_TOOL_NAME
	) {
		makeServerInjectedDatabaseIdOptional(tool.schema);
	}
	if (tool.name === DMS_GENERATE_SQL_TOOL_NAME) {
		tool.name = HOTEL_DATA_GENERATE_SQL_TOOL_NAME;
		tool.description =
			'可选辅助：根据自然语言生成只读 SELECT。database_id 由服务端注入，不要填写；生成结果不是数据证据，仍须交给查询工具执行。';
	} else if (tool.name === DMS_SQL_TOOL_NAME) {
		tool.name = HOTEL_DATA_SQL_TOOL_NAME;
		tool.description = `执行酒店业务只读 SQL，可查询经营、流量曝光与转化、内容、搜索、人群、营销、评价、评分、订单和同步状态，支持 JOIN、子查询、CTE、UNION。只填写 script，database_id 由服务端注入。SQL 使用不带数据库名前缀的表名，并用 hotel_id 限定授权酒店。系统拒绝写操作、高风险查询并限制为 ${HOTEL_DATA_RESULT_ROW_LIMIT} 行。`;
	} else if (tool.name === DMS_LIST_TABLES_TOOL_NAME) {
		tool.name = HOTEL_DATA_LIST_TABLES_TOOL_NAME;
		tool.description =
			'列出或按 search_name 搜索 rms_data 业务表，覆盖经营、流量、转化、内容、搜索、人群、营销、评价、评分、订单和同步状态。database_id 由服务端注入，请勿填写。';
	} else {
		tool.name = HOTEL_DATA_DESCRIBE_TABLE_TOOL_NAME;
		tool.description =
			'读取 list_hotel_data_tables 返回的 table_guid 对应字段、类型、业务口径和索引；写 SQL 前用它核验字段及枚举。只读。';
	}
	return tool;
}

export class McpToolProvider {
	private readonly clients = new Set<MultiServerMCPClient>();
	private readonly toolsPromises = new Map<string, Promise<readonly DynamicStructuredTool[]>>();
	private readonly clientsByCacheKey = new Map<string, MultiServerMCPClient>();
	private readonly refreshPromises = new Map<string, Promise<readonly DynamicStructuredTool[]>>();

	constructor(
		private readonly servers: Readonly<Record<string, McpServerConfig>>,
		private readonly dmsDatabaseId: string | null = null,
		private readonly dmsDatabaseName: string | null = null,
		private readonly logger?: McpToolProviderLogger
	) {}

	serverCount(): number {
		return Object.keys(this.servers).length;
	}

	capabilities(): ReadonlySet<McpCapability> {
		return new Set(Object.values(this.servers).flatMap((server) => server.capabilities));
	}

	prewarm(capabilities: readonly McpCapability[]): void {
		void this.getTools(capabilities).catch(() => {
			// getTools already emits a structured failure log; the foreground request will retry once.
		});
	}

	getTools(capabilities: readonly McpCapability[]): Promise<readonly DynamicStructuredTool[]> {
		const normalizedCapabilities = [...new Set(capabilities)].sort();
		const cacheKey = normalizedCapabilities.join(',') || 'none';
		const cached = this.toolsPromises.get(cacheKey);
		if (cached) return cached;
		const selectedServers = selectMcpServersByCapabilities(this.servers, normalizedCapabilities);
		const selectedServerCount = Object.keys(selectedServers).length;
		if (selectedServerCount === 0) return Promise.resolve([]);
		{
			const startedAt = performance.now();
			this.logger?.info?.(
				{ event: 'agent.mcp.catalog.load.started', serverCount: selectedServerCount, cacheKey },
				'MCP tool catalog load started'
			);
			const loading = this.loadTools(selectedServers, cacheKey)
				.then((tools) => {
					if (!hotelDataToolCatalogIsHealthy(normalizedCapabilities, tools)) {
						throw new AgentProtocolError({
							operation: 'load_hotel_data_tool_catalog',
							reason: 'Required DMS executeScript tool is unavailable'
						});
					}
					this.logger?.info?.(
						{
							event: 'agent.mcp.catalog.load.completed',
							serverCount: selectedServerCount,
							cacheKey,
							toolCount: tools.length,
							durationMs: Math.max(0, Math.round(performance.now() - startedAt))
						},
						'MCP tool catalog load completed'
					);
					return tools;
				})
				.catch((error: unknown) => {
					this.logger?.error?.(
						{
							event: 'agent.mcp.catalog.load.failed',
							serverCount: selectedServerCount,
							cacheKey,
							durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
							errorType: error instanceof Error ? error.name : 'UnknownError'
						},
						'MCP tool catalog load failed'
					);
					this.toolsPromises.delete(cacheKey);
					throw error;
				});
			this.toolsPromises.set(cacheKey, loading);
			return loading;
		}
	}

	refreshTools(capabilities: readonly McpCapability[]): Promise<readonly DynamicStructuredTool[]> {
		const normalizedCapabilities = [...new Set(capabilities)].sort();
		const cacheKey = normalizedCapabilities.join(',') || 'none';
		const refreshing = this.refreshPromises.get(cacheKey);
		if (refreshing) return refreshing;
		const startedAt = performance.now();
		this.logger?.warn(
			{ event: 'agent.mcp.catalog.refresh.started', cacheKey },
			'MCP tool catalog refresh started'
		);
		const refresh = (async () => {
			this.toolsPromises.delete(cacheKey);
			const staleClient = this.clientsByCacheKey.get(cacheKey);
			this.clientsByCacheKey.delete(cacheKey);
			if (staleClient) {
				this.clients.delete(staleClient);
				try {
					await staleClient.close();
				} catch (error) {
					this.logger?.warn(
						{
							event: 'agent.mcp.connection.close.failed',
							cacheKey,
							errorType: error instanceof Error ? error.name : 'UnknownError'
						},
						'Stale MCP connection could not be closed cleanly'
					);
				}
			}
			const tools = await this.getTools(normalizedCapabilities);
			this.logger?.info?.(
				{
					event: 'agent.mcp.catalog.refresh.completed',
					cacheKey,
					toolCount: tools.length,
					durationMs: Math.max(0, Math.round(performance.now() - startedAt))
				},
				'MCP tool catalog refresh completed'
			);
			return tools;
		})().catch((error: unknown) => {
			this.logger?.error?.(
				{
					event: 'agent.mcp.catalog.refresh.failed',
					cacheKey,
					durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
					errorType: error instanceof Error ? error.name : 'UnknownError'
				},
				'MCP tool catalog refresh failed'
			);
			throw error;
		});
		this.refreshPromises.set(cacheKey, refresh);
		const clearRefresh = () => {
			if (this.refreshPromises.get(cacheKey) === refresh) this.refreshPromises.delete(cacheKey);
		};
		void refresh.then(clearRefresh, clearRefresh);
		return refresh;
	}

	private async loadTools(
		servers: Readonly<Record<string, McpServerConfig>>,
		cacheKey: string
	): Promise<readonly DynamicStructuredTool[]> {
		let resolvedDmsDatabaseId = this.dmsDatabaseId;
		let resolvedDmsDatabaseName = this.dmsDatabaseName;
		const connections = Object.fromEntries(
			Object.entries(servers).map(([name, server]) => {
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
					return {
						args: constrainHotelDataSqlArgs(
							args,
							resolvedDmsDatabaseId,
							currentHotelDataAccessScope()?.hotelIds,
							resolvedDmsDatabaseName ?? undefined
						)
					};
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
			afterToolCall: ({ serverName, name, result }) => {
				if (serverName !== HOTEL_DATA_MCP_SERVER_NAME) return;
				if (name === DMS_LIST_TABLES_TOOL_NAME && isEmptyHotelDataTableListResult(result[0])) {
					throw new AgentProtocolError({
						operation: 'list_hotel_data_tables',
						reason: 'DMS table discovery returned no table metadata'
					});
				}
				return { result: compactHotelDataToolResult(result) };
			}
		});
		this.clients.add(client);
		this.clientsByCacheKey.set(cacheKey, client);

		const serverNames = Object.keys(servers);
		const loadedByServer = await loadMcpServerToolsInOrder(serverNames, (name) =>
			client.getTools(name)
		);
		const hotelDataIndex = serverNames.indexOf(HOTEL_DATA_MCP_SERVER_NAME);
		const hotelDataTools = hotelDataIndex < 0 ? [] : (loadedByServer[hotelDataIndex] ?? []);
		if (hotelDataIndex >= 0 && this.dmsDatabaseName) {
			const discoveryStartedAt = performance.now();
			const searchDatabase = hotelDataTools.find(
				(tool) => tool.name === DMS_SEARCH_DATABASE_TOOL_NAME
			);
			if (!searchDatabase && !this.dmsDatabaseId) {
				this.logger?.error?.(
					{
						event: 'agent.mcp.database_discovery.failed',
						reason: 'tool_unavailable',
						durationMs: Math.max(0, Math.round(performance.now() - discoveryStartedAt)),
						errorType: 'AgentProtocolError'
					},
					'DMS database discovery failed'
				);
				throw new AgentProtocolError({
					operation: 'discover_dms_database',
					reason: 'DMS searchDatabase tool is unavailable'
				});
			}
			let discoveryResult: unknown;
			let fallbackReason = searchDatabase ? 'search_failed' : 'tool_unavailable';
			let fallbackErrorType: string | undefined;
			if (searchDatabase) {
				try {
					discoveryResult = await runAgentEffect(
						agentPromise({
							service: 'mcp',
							operation: 'discover_dms_database',
							timeoutMs: 50_000,
							try: (signal) =>
								searchDatabase.invoke(
									{
										search_key: this.dmsDatabaseName ?? '',
										page_number: 1,
										page_size: 50
									},
									{ signal }
								)
						})
					);
				} catch (error) {
					if (!this.dmsDatabaseId) {
						this.logger?.error?.(
							{
								event: 'agent.mcp.database_discovery.failed',
								reason: 'search_failed',
								durationMs: Math.max(0, Math.round(performance.now() - discoveryStartedAt)),
								errorType: error instanceof Error ? error.name : 'UnknownError'
							},
							'DMS database discovery failed'
						);
						throw error;
					}
					fallbackErrorType = error instanceof Error ? error.name : 'UnknownError';
				}
			}
			let resolution;
			try {
				resolution = resolveDmsDatabaseId(
					discoveryResult === undefined
						? { status: 'unavailable' }
						: { status: 'completed', result: discoveryResult },
					this.dmsDatabaseName,
					this.dmsDatabaseId
				);
			} catch (error) {
				this.logger?.error?.(
					{
						event: 'agent.mcp.database_discovery.failed',
						reason: 'identity_validation_failed',
						durationMs: Math.max(0, Math.round(performance.now() - discoveryStartedAt)),
						errorType: error instanceof Error ? error.name : 'UnknownError'
					},
					'DMS database discovery failed'
				);
				throw error;
			}
			resolvedDmsDatabaseId = resolution.databaseId;
			if (resolution.source === 'configured_fallback') {
				if (discoveryResult !== undefined) fallbackReason = 'no_exact_match';
				this.logger?.warn(
					{
						event: 'agent.mcp.database_discovery_fallback',
						reason: fallbackReason,
						durationMs: Math.max(0, Math.round(performance.now() - discoveryStartedAt)),
						...(fallbackErrorType ? { errorType: fallbackErrorType } : {})
					},
					'DMS database discovery fell back to the configured database ID'
				);
			} else {
				this.logger?.info?.(
					{
						event: 'agent.mcp.database_discovery.completed',
						resolutionSource: resolution.source,
						durationMs: Math.max(0, Math.round(performance.now() - discoveryStartedAt))
					},
					'DMS database discovery completed'
				);
			}
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
		const clients = [...this.clients];
		try {
			await Promise.all(
				clients.map((client) =>
					runAgentEffect(
						agentPromise({
							service: 'mcp',
							operation: 'close_connections',
							timeoutMs: 10_000,
							try: () => client.close()
						})
					)
				)
			);
		} finally {
			this.clients.clear();
			this.clientsByCacheKey.clear();
			this.toolsPromises.clear();
			this.refreshPromises.clear();
		}
	}
}
