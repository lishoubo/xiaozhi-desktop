# Proposal: Reduce Agent response latency

## Why

Agent Runs perform a redundant model-driven memory recall even though employee memory is already loaded into the system context. The first MCP load also connects configured servers serially, making cold-start latency additive.

## Change

- Keep server-side memory preload, but remove the redundant recall tool from the model tool catalog.
- Load independent MCP server tool catalogs concurrently and keep the existing shared cache.
- Reuse the immutable model client across Runs.

## Success criteria

- A Run receives employee memory without requiring an extra model tool round trip.
- Multiple configured MCP servers initialize concurrently while catalog order remains deterministic.
- Cancellation, memory writes, generated UI and MCP safety filtering remain unchanged.
