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
