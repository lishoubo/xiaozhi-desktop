# Design

## Scope and approach

The implementation keeps the current registered generic workflow and bounded LangChain collector.
It adds deterministic policy around the model instead of trying to enumerate every possible user
question.

## Decisions

### Machine-readable semantic catalog

Represent each RMS object with its business domain, grain, hotel/source/date fields, measures and
units, aggregate-row risks, join guidance, freshness semantics and sensitive fields. Generate the
human-readable prompt catalog from this registry so prompt guidance and validation cannot drift.
The verified catalog is the normal query-planning source; live list/describe tools are optional and
must not be required for every run.

### Evidence coverage contract

Derive requested business domains from normalized metric text and the original request. Each SQL
evidence envelope records the referenced catalog tables and their domains. Generic evidence is
sufficient only when all explicitly requested domains are covered. Unknown long-tail concepts remain
answerable: one successful SQL result may satisfy them without inventing a missing-domain warning
when the catalog cannot classify the concept.

The three-round/eight-successful-SQL limits remain hard convergence guards, not dimensional limits.

### SQL relation authorization

Parse each complex SELECT/CTE/UNION branch. Every hotel-scoped base-table relation must either have a
direct authorized `hotel_id` predicate or be connected by `hotel_id` equality to a relation that is
already scoped. Joins only on dates or other dimensions do not propagate authorization. Ordinary
business `OR` predicates are allowed, but hotel scope must be expressed independently and remain
provable.

### Metadata discovery

Table listing always requests GUIDs. A successful response containing no table candidates is treated
as unusable discovery. The collector is instructed to use the verified catalog first and may skip
list/describe entirely. Discovery and SQL collection use separate convergence accounting.

### Provenance and presentation

Evidence normalization extracts only safe SQL provenance: referenced table names, catalog domains,
known grain/time fields and units. Raw SQL is not persisted or logged. The final
answer model receives provenance alongside bounded results. Deterministic generic presentation
combines all displayable SQL result sets, with a result-set label when their columns differ.

### Freshness, aggregation and privacy

The semantic catalog marks snapshot/event date semantics, unit mismatches, aggregate-row hazards,
JSON fallback tables and sensitive columns. The collection prompt requires latest-complete-date
checks for vague current analysis, pre-aggregation before cross-grain joins, source separation and
default exclusion of sensitive detail.

## Compatibility and risk

The evidence schema is internal and extended additively. Queries already accepted as single-table
SELECTs continue to receive server-injected hotel filters. Complex SQL that joined another hotel
table without hotel equality becomes rejected and must be regenerated safely.
