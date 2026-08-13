# Verification: Optimize Agent business workflows

## Focused evidence

- `npm run test:unit --workspace @hotel-butler/server --
  src/lib/server/agent/execution/business-intent-router.test.ts
  src/lib/server/agent/execution/deterministic-workflow-collector.test.ts
  src/lib/server/agent/execution/evidence.test.ts
  src/lib/server/agent/agent-gateway.test.ts
  src/lib/server/agent/langchain-agent-runtime.test.ts`
  - Result: 5 files passed, 33 tests passed.
- `npm run check:server`
  - Result: `svelte-check found 0 errors and 0 warnings`.
- `npm run lint --workspace @hotel-butler/server`
  - Result: passed with no diagnostics.
- `openspec validate optimize-agent-business-workflows --strict --no-interactive`
  - Result: change is valid.
- `git diff --check`
  - Result: passed with no whitespace errors.

## Real MCP audit

The configured weather MCP was invoked directly through `DeterministicWorkflowCollector`, without
an LLM collection pass. The audit observed one `tool_started` and one `tool_completed` event for
`get_weather_summary`; normalization reported `parseQuality=adapter`,
`data.format=weather_summary_v1`, and evidence assessment returned `sufficient`.

No prompt, tool arguments, evidence body or generated UI payload was emitted in phase logs.

## Completion-state monorepo verification

`npm run verify` was run once, as required by the repository completion policy. Results:

- desktop/server/API checks and lint passed;
- desktop unit: 83 files, 500 tests passed;
- server unit: 30 files, 115 tests passed;
- API unit: 2 files, 22 tests passed;
- desktop E2E: 8 tests passed;
- server E2E: 7 tests passed, 1 credential-backed Data Agent test failed.

The failing E2E routed a cross-hotel GMV ranking prompt to `hotel_operating_summary`, entered
`resolving_slots`, and then failed with `ZodError` before any collector or MCP invocation. Review
identified that model-proposed slot keys were not filtered against the selected intent registry.
The router now drops unregistered keys, with a focused regression test. The full suite was not run a
second time; therefore the credential-backed E2E is not claimed as passing after the fix. Its
cross-hotel prompt also exercises the generic-intent slot policy, which remains a separate behavior
decision from this collection optimization.

## Independent code-review pass

The review found and corrected two additional failure-boundary defects:

- rejected evidence could fall through to the ordinary Agent path; it now terminates the Run with a
  user-safe, non-retryable failure message;
- an error-status LangChain `ToolMessage` could be retained as evidence; it is now excluded, so an
  unsuccessful tool response cannot ground an answer.

The existing desktop presents live `run_failed`, send, clarification and cancellation errors, but
does not yet use the `retryable` flag for an action and does not persist the exact failure banner when
reopening a historical conversation. Those are documented follow-up UX gaps, not represented as
completed by this change.
