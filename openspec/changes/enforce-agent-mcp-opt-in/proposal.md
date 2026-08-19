# Proposal: Enforce opt-in MCP loading

## Why

The Agent runtime currently initializes every configured MCP catalog for an ordinary model response.
That makes greetings and other general questions depend on unrelated services, adds avoidable latency,
and can fail the whole Run when a business integration such as DMS is unavailable.

## Change

- Make MCP access deny-by-default for every Agent Run.
- Declare MCP capabilities and Skill names as part of each server-owned business route.
- Execute only the MCP and Skills declared by the selected business route.
- Keep greetings, general knowledge, weather, writing, translation, arithmetic, hospitality knowledge
  and weather-informed operating advice on the LLM-only path.
- Require every future MCP feature to add an explicit route-to-capability mapping before its catalog
  can be initialized.

## Success criteria

- “你好” and “今天天气如何” complete without initializing any MCP client or catalog.
- Hotel knowledge and advice that do not require live hotel facts complete without MCP.
- A selected business route initializes only its declared MCP capability and Skills.
- A newly configured MCP server or Skill is inert until a server-owned route explicitly declares it.

## Non-goals

- Removing the generic server-side MCP configuration format.
- Adding a web search or live weather provider.
- Expanding business writes or bypassing DMS authorization controls.
