# Proposal: Refine Agent execution results

## Why

General questions currently show a business-style execution timeline even when no tool or workflow is
needed. Generated UI is streamed before the answer is committed and accepts object-valued table cells,
which can render as `[object Object]`. The hotel operating shortcut can fall back into an iterative
schema-discovery Agent loop instead of using its deterministic read-only query. The weather shortcut is
also less valuable to daily hotel operators than a focused operating review.

## What Changes

- Keep the persisted execution state machine for every Run, but show the execution timeline only when
  an actual tool step or failed/cancelled operation needs explaining.
- Treat generated UI as a staged answer artifact: validate scalar table cells and publish it only with
  the committed assistant message, without an early placeholder or streamed frame.
- Make the operating-summary collector invoke the pinned DMS SQL tool deterministically and surface a
  bounded, diagnosable failure instead of falling into recursive schema discovery.
- Discover the DMS database with `searchDatabase` before downstream queries, require an exact schema
  match and optionally verify the resulting DatabaseId against an operator-pinned ID.
- Remove the weather quick action and add a `昨日经营复盘` shortcut that reuses the existing hotel
  operating-summary intent with a code-owned `昨天` date default.
- Preserve free-form weather questions and the existing read-only/write-denial policy.

## Success Criteria

- `你能做什么` receives a normal answer without a visible empty execution plan.
- Object-valued Table cells are rejected before reaching the desktop; no `[object Object]` cells render.
- No generated-UI frame appears before the final assistant message is committed.
- The operating-review shortcut performs one deterministic, bounded DMS query after hotel resolution
  and cannot enter a schema-discovery recursion loop.
- Every DMS table/SQL path is pinned to the program-discovered database; ambiguous or mismatched
  discovery fails before business data is queried.
- The quick-action catalog contains `昨日经营复盘` instead of the weather shortcut.

## Non-goals

- Removing the persisted execution state machine from general conversations.
- Removing weather support from free-form Agent questions.
- Adding write operations or a third-party workflow/state-machine library.
