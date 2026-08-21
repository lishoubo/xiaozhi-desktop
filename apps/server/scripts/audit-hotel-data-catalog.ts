import { readAgentEnvironment } from '../src/lib/server/agent/agent-config.ts';
import { buildHotelDataCatalogDriftSql } from '../src/lib/server/agent/hotel-data-catalog-drift.ts';
import { McpToolProvider } from '../src/lib/server/agent/mcp-tool-provider.ts';

const environment = readAgentEnvironment(process.env);
const provider = new McpToolProvider(
	environment.mcpServers,
	environment.dmsDatabaseId,
	environment.dmsDatabaseName
);

try {
	const tools = await provider.getTools(['hotel_data']);
	const query = tools.find((tool) => tool.name === 'query_hotel_operating_data_sql');
	if (!query) throw new Error('Hotel-data SQL tool is unavailable');
	const result = await query.invoke({ script: buildHotelDataCatalogDriftSql() });
	const serialized = typeof result === 'string' ? result : JSON.stringify(result);
	const hasMismatch = /\|\s*[a-z][a-z0-9_]*\s*\|\s*\d+\s*\|\s*\d+\s*\|/i.test(serialized);
	if (hasMismatch) {
		process.stderr.write(`Hotel-data catalog drift detected:\n${serialized}\n`);
		process.exitCode = 1;
	} else {
		process.stdout.write(
			'Hotel-data catalog objects and column counts match the verified registry.\n'
		);
	}
} finally {
	await provider.close();
}
