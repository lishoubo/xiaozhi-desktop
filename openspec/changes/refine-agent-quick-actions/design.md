# Design: Refine Agent quick actions

## Decision

Add `hotel_operating_data` to the shared quick-action identifier schema and bind its server definition to the existing `hotel_data` capability. Remove the redundant weather outlook and air-quality actions from the shared catalog and server definitions.

The new prompt asks for hotel and date range when absent, then requires the DMS hotel-data MCP to return a compact operating overview covering revenue, occupancy and available room-night metrics. The model may use `render_hotel_ui` when a comparison or trend improves comprehension.

The system grounding rule also follows an MCP-first boundary: hotel-specific current or historical facts require a lookup, while general hospitality knowledge and metric definitions do not. Read-only tools may support an operational recommendation but must never be represented as having executed a write operation.

## Data flow

1. Server inspects configured MCP capabilities.
2. `listHotelQuickActions` returns `today_weather` and, when available, `hotel_operating_data`.
3. Desktop renders the server-owned catalog without manufacturing unavailable actions.
4. Clicking the action sends only its ID; the server resolves the prompt and starts the Run.

## Compatibility

Removed weather-action IDs are rejected at the shared input boundary. Quick actions are ephemeral commands rather than persisted data, so no migration is required. No persistence or deployment setting changes.
