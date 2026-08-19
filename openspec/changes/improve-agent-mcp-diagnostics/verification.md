# Verification: Improve Agent MCP diagnostics

## Focused tests

- Agent unit tests covering intent budget, stream-failure attribution, MCP lifecycle forwarding,
  safe cause classification, and deterministic collection passed: 66 tests across 5 files.
- After adding recursion-limit handling, the affected runtime, gateway, and router regression set
  passed: 54 tests across 3 files.
- `git diff --check` passed.

## Real latest-orders E2E

Command scope: the single server Playwright case
`completes a latest hotel orders query through the real DMS MCP`, using the configured Kimi model
and Aliyun DMS MCP.

The first run reproduced the production symptom and exposed the previously hidden cause:
`GraphRecursionError` occurred after `query_hotel_operating_data_sql` started. The fixed LangGraph
recursion limit of 10 was exhausted; this was not evidence that DMS was unavailable.

After scaling the recursion limit with the 15-call tool budget, the same E2E passed in 2.7 minutes:

- `list_hotel_data_tables`: completed;
- `describe_hotel_data_table`: completed;
- `generate_hotel_operating_data_sql`: completed;
- `query_hotel_operating_data_sql`: completed in about 5.2 seconds;
- evidence assessment: sufficient;
- business execution state: completed;
- result: 1 test passed, and the assistant response did not contain the DMS-unavailable message.

## Completion verification

`npm run verify` was run once. Type checks, lint, and unit tests passed (desktop 692, server 240,
shared API 25). The completion command then stopped in desktop E2E because the unrelated existing
calendar test `opens the localized calendar with the seeded holiday group` did not find its newly
saved `新日程` item. This change does not modify desktop or calendar code, and the failed full run
was not repeated in accordance with the repository's completion-test rule. The targeted server E2E
above was run afterward because the full command stopped before reaching server E2E.

## Review

- No raw SQL, MCP arguments/results, exception messages, URLs, headers, or credentials are logged.
- Failure logs contain only allow-listed correlation fields, tool names, duration, error/cause type,
  failure kind, and retryability.
- `GraphRecursionError` is classified as a workflow protocol failure and does not emit a false MCP
  failure or the hotel-data-service user message.
- No public contract, desktop UI, database schema, deployment configuration, or stable architecture
  boundary changed.
- No deployment was performed.
