# Proposal: Refine general Agent routing

## Why

The model-assisted router can treat a standalone request such as “今天天气如何” as a hotel business
read. That sends the request into structured slot resolution and may ask the user to choose a hotel,
even though a normal Agent should handle weather, knowledge, writing and similar general tasks without
hotel context.

## Change

- Clarify the classifier boundary between general Agent capabilities and hotel business reads.
- Add a deterministic correction that keeps standalone weather requests out of hotel workflows even
  if the classifier proposes a business intent.
- Preserve internal-data-first behavior for questions that depend on the user's hotel facts.
- Honor an explicit request not to query internal hotel data by routing to an explanatory/general
  answer rather than starting collection.

## Success criteria

- “今天天气如何” reaches general Agent execution and never asks for a hotel.
- A request for weather-based hotel operating advice can still use the registered weather workflow.
- Hotel orders, operations, rates, inventory and other internal facts continue to prefer system data.
- General conversation keeps access to normal safe Agent tools without entering hotel slot resolution.

## Non-goals

- Adding new external tools or internet-search providers.
- Letting general conversation bypass hotel-data authorization when it actually queries hotel facts.
- Expanding the set of supported business write operations.
