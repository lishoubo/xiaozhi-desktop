# Verification

## Automated evidence

- `npm run test:unit:server`: completion run executed once; 278 of 279 tests passed. The sole
  failure was an existing prompt assertion for the freshness sentence after the prompt catalog was
  generated from the new registry. The sentence was restored without reverting the new behavior.
- Targeted regression after that fix: 6 files and 93 tests passed for catalog routing, SQL policy,
  prompt, evidence, runtime, gateway and MCP-provider behavior.
- Targeted deterministic presentation regression: 1 file and 5 tests passed.
- `npm run check:server`: passed with 0 errors and 0 warnings.
- `npm run lint:server`: passed.
- Real read-only DMS E2E: 2 scenarios passed. The generic flow used one local verified-schema lookup
  and two SQL calls, with no remote list/describe calls.
- Live read-only DMS metadata smoke: table listing still returned zero objects even with GUIDs
  requested. The generic workflow no longer depends on that endpoint, and the provider now rejects
  the empty result instead of treating it as usable discovery.

## Independent verification pass

- Confirmed the verified catalog contains 35 unique live RMS objects and exact column inventories.
- Confirmed complex JOIN, derived-table, CTE and UNION paths require each relation to be directly
  hotel-scoped or connected through `hotel_id` equality; date-only and Cartesian joins are rejected.
- Confirmed ordinary metric `OR` predicates remain valid when hotel scope is independently provable.
- Confirmed evidence assessment combines successful SQL results across both collection passes and
  requires all explicitly recognized request domains before grounded answering.
- Confirmed deterministic presentation preserves multiple useful SQL result sets and reports local
  row/column filtering.

## Code-review findings

No unresolved high- or medium-severity finding remains in the reviewed change. Two documentation
statements were corrected during review so they no longer claimed a persisted query fingerprint or
a mandatory warning for unclassified long-tail concepts.

Operational observation: live DMS table discovery remains misconfigured or incompatible upstream.
It is isolated from the generic hotel-data workflow by the verified local catalog, but should still
be repaired before another product path relies on live discovery.

No deployment or remote write was performed.

## Reliability hardening follow-up

- `npm run test:unit:server -- src/lib/server/agent`: 31 files and 231 tests passed after one
  assertion exposed and corrected an overly broad metric-field matcher.
- `npm run check:server`: passed with 0 errors and 0 warnings after the recovery, date-policy and
  presentation changes.
- `node_modules/.bin/tsx --env-file=apps/server/.env.production
  apps/server/scripts/audit-hotel-data-catalog.ts`: the read-only live DMS audit reported that all
  the 35 verified objects and their column counts match the current `rms_data` catalog.
- Retry regression confirms persisted envelopes retain observed scope and are deduplicated by query
  fingerprint. Presentation regression confirms a large first result set cannot hide a later set.
- Natural-language operating analysis now keeps date optional at slot resolution; an omitted date
  is handled in the bounded SQL collector and evidence is accepted only when it proves the latest
  complete business day and a comparison baseline.
- A final focused date/drift regression passed 18 tests, including non-keyword analysis wording and
  date-less data-only freshness proof. The drift query also detects unexpected new live objects.
- `npm run lint:server`, strict OpenSpec change validation and `git diff --check` passed.

## Reliability follow-up review

The review found and corrected two material edge cases: conversion-rate column names could
incorrectly satisfy raw exposure/trade metric coverage, and the first drift query did not detect an
unexpected newly added RMS object. No unresolved high- or medium-severity finding remains in the
follow-up implementation.

No deployment or remote write was performed in this follow-up.
