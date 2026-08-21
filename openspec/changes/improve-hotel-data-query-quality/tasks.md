# Tasks

## 1. Semantic planning and metadata

- [x] Add focused tests and implement a complete machine-readable RMS semantic catalog.
- [x] Generate prompt guidance and requested-domain coverage from the catalog.
- [x] Require table GUIDs during DMS listing and reject semantically empty discovery.

## 2. Safe SQL and evidence

- [x] Add Red tests for unscoped joined relations, CTEs, UNIONs and legitimate business `OR`, then
  enforce per-relation hotel authorization.
- [x] Extract safe table/domain/grain/time/unit provenance from validated SQL into evidence.
- [x] Make generic evidence assessment require coverage of explicitly requested catalog domains and
  retain material freshness/filtering limitations.

## 3. Runtime convergence and answers

- [x] Update the collector prompt and middleware to prefer the verified catalog, use latest-complete
  data, pre-aggregate joins and separate sources/units.
- [x] Key repeated MCP failure handling by tool, normalized arguments and failure kind.
- [x] Present all useful SQL evidence sets instead of only the final query result.

## 4. Verification

- [x] Run directly affected unit tests during implementation.
- [x] Run one affected server completion suite, type/lint checks, OpenSpec validation and
  `git diff --check`.
- [x] Record independent verification and code-review findings in `verification.md`.

## 5. Reliability and privacy hardening

- [x] Reject/refresh empty or incomplete hotel-data MCP catalogs without caching unhealthy results.
- [x] Separate requested/effective/observed evidence scope and validate date proof.
- [x] Enforce sensitive-column and raw-JSON projection policy in SQL.

## 6. Query quality and latency

- [x] Add metric-family coverage and latest-complete-data evidence requirements.
- [x] Add a read-only semantic-catalog drift checker.
- [x] Add a total collection deadline, catalog prewarm and preinject relevant verified schemas.

## 7. Recovery and presentation

- [x] Restore and deduplicate persisted evidence during retry/follow-up.
- [x] Allocate and label multiple result sets without starving later evidence.
- [x] Run focused tests and record the new verification and code-review evidence.
