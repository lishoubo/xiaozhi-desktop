# Improve hotel-data query quality

## Why

The generic Hotel Agent can query the complete RMS schema, but it currently treats any successful
SQL result as sufficient evidence, depends on a DMS table-discovery chain that may return an empty
successful result, and does not validate hotel scope for every relation in a complex query. This can
produce incomplete analysis, repeated metadata calls, incorrect multi-table aggregation, or
cross-hotel data mixing.

## What changes

- Replace per-request schema exploration with a code-owned, machine-readable semantic catalog for
  the current RMS hotel-data schema while retaining bounded DMS metadata as an optional refresh path.
- Plan and validate evidence coverage by requested business domains instead of equating one
  successful SQL call with completion.
- Attach safe query provenance to evidence and preserve all useful SQL result sets in presentation.
- Enforce hotel isolation for every hotel-scoped relation in complex SQL and permit ordinary business
  `OR` predicates when they cannot weaken hotel scope.
- Distinguish discovery, SQL-round and repeated-query failure budgets; reject semantically empty
  table discovery.
- Reject and refresh transiently empty MCP tool catalogs instead of caching them as healthy.
- Separate requested, effective and observed query scope; enforce sensitive-column policy before SQL
  reaches DMS.
- Validate requested metrics and latest-complete-data evidence, detect schema drift out of band, and
  preserve evidence across retry and multi-result presentation.

## Success criteria

- A generic business question produces a bounded domain-aware query plan and only stops when its
  required domains have evidence or a material limitation is explicit.
- Multi-table SQL cannot read an unscoped hotel fact table.
- Empty DMS table-list responses do not trigger repeated describe calls.
- Final answers receive table, domain, grain, time and unit provenance and can present multiple SQL
  result sets.
- Existing dedicated operating queries and read-only DMS protections remain compatible.
- A transient empty MCP catalog fails fast or recovers once, and never poisons the process cache.
- Evidence cannot claim a hotel or date merely because it appeared in the request.
- Sensitive columns and fallback JSON cannot enter model evidence through generic SQL.

## Non-goals

- Writing hotel business data or changing employee authorization sources.
- Building deterministic templates for every possible natural-language question.
- Redesigning the desktop Agent interface or deploying the change.
