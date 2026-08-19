# Proposal: Complete empty hotel-data Runs normally

## Why

A successful hotel-data query can return a valid table with headers and zero rows. The current
evidence boundary does not recognize that representation as empty data, and downstream handling can
surface a technical DMS failure or an overly technical insufficient-evidence message. Hotel staff
should not need to know the internal data-service name, and absence of matching rows is a valid
business outcome rather than a failed Run.

## Change

- Recognize successful hotel SQL results that contain an empty array or a valid header-only table as
  a distinct no-data evidence outcome.
- End that business execution without another collection or answer-model call.
- Persist a normal assistant text message that names the requested period where available and gives
  a friendly suggestion to adjust the date range.
- Keep transport, authentication, protocol and SQL execution errors on the existing failure path.

## Success criteria

- A successful empty hotel query produces a user message and a completed Run.
- The response contains no `DMS`, MCP, SQL, internal endpoint or protocol terminology.
- No generated chart/table is shown for an empty result.
- A genuine MCP error remains a retryable failed Run.

## Non-goals

- Treating malformed or ambiguous tool output as confirmed no data.
- Fabricating zero-valued metrics for dates that have no source rows.
- Changing how non-hotel MCP providers represent empty results.
