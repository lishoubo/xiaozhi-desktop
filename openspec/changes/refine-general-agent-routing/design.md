# Design: Refine general Agent routing

## Routing boundary

The classifier prompt defines `weather_operations_advice` narrowly: it applies when weather is being
connected to hotel operations, staffing, pricing, occupancy or another business decision. Standalone
weather lookup is `general_conversation`, as are translation, writing, arithmetic, general knowledge
and ordinary dialogue.

Hotel-specific current or historical facts remain `business_read` by default. An explicit phrase such
as “不要查询系统数据” converts a proposed hotel read into `hotel_knowledge`, allowing a clearly
qualified general answer without collection.

## Deterministic correction

Because routing controls whether the product opens a structured clarification flow, a small code-owned
guard corrects the highest-cost ambiguity. A weather prompt with no hotel-operating context always
routes to `general_conversation`, regardless of whether the classifier proposed
`weather_operations_advice` or a generic hotel-data intent. A request containing operating context
continues through the classifier decision.

The guard does not answer the request. General runtime execution calls the LLM with conversation
history and memory but without MCP tools or business Skills; it never creates a hotel-selection card
solely for weather. Tool-loading details are superseded by
`../enforce-agent-mcp-opt-in/design.md`.
