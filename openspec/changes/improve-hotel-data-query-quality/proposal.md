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

## Success criteria

- A generic business question produces a bounded domain-aware query plan and only stops when its
  required domains have evidence or a material limitation is explicit.
- Multi-table SQL cannot read an unscoped hotel fact table.
- Empty DMS table-list responses do not trigger repeated describe calls.
- Final answers receive table, domain, grain, time and unit provenance and can present multiple SQL
  result sets.
- Existing dedicated operating queries and read-only DMS protections remain compatible.

## Non-goals

- Writing hotel business data or changing employee authorization sources.
- Building deterministic templates for every possible natural-language question.
- Redesigning the desktop Agent interface or deploying the change.
