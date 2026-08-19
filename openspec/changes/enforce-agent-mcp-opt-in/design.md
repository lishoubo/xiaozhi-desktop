# Design: Enforce opt-in MCP loading

## Tool authorization boundary

`AgentRuntimeRunOptions` carries explicit MCP-capability and Skill-name allowlists. The gateway always
supplies both lists. The runtime selects only configured dependencies declared by the active route and
returns no remote tools without constructing an MCP client when the lists are empty.

The intent registry is the policy owner for business routes. General conversation passes empty MCP
and Skill lists, retains the local long-term-memory write tool, and excludes generative UI. A resolved
business read derives its dependency lists from its registered intent definition; for example,
operating-data workflows authorize `hotel_data`. Evidence-grounded answer and analysis phases receive
only the local tools declared by that business route.

## Routing boundary

Weather does not imply a weather tool. Standalone weather remains general conversation. Weather
advice connected to hotel operations is hotel knowledge unless the same request explicitly asks for
the user's real hotel facts; both LLM-only routes receive history and memory but no MCP tools. An
explicit real-data request continues through the business-read flow and may use DMS for the hotel
facts only.

## Extensibility

Configuration makes an MCP server available to the application; it does not authorize use. Adding a
future MCP feature requires all of the following server-owned changes:

1. register the business intent and its fixed workflow;
2. declare the MCP capabilities and Skill names required by that intent;
3. add routing and no-cross-capability tests.

Until those conditions are met, the configured MCP catalog or Skill is never loaded during a Run.
