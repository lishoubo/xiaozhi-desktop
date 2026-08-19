# Hotel Agent runtime delta

## Modified requirements

### Requirement: Controlled extensibility

MCP and Skill configuration SHALL make dependencies available but SHALL NOT authorize them for an
Agent Run. Every Run SHALL deny both by default, and a server-owned business route SHALL explicitly
declare the minimum MCP capabilities and Skill names required by its fixed workflow.

#### Scenario: General Agent request

- **WHEN** a user asks a greeting, general-knowledge, weather, writing, translation or arithmetic
  question
- **THEN** the Agent answers through Kimi with conversation history and memory
- **AND** initializes no MCP client, remote tool catalog or business Skill
- **AND** may use only the local long-term-memory tool when the user explicitly asks it to remember
  something
- **AND** does not expose generative UI to the general route

#### Scenario: Obvious general request

- **WHEN** the prompt is a simple greeting or a standalone weather request
- **THEN** the server routes it without invoking the model classifier
- **AND** the selected general execution still receives history and memory

#### Scenario: Model-assisted intent classification

- **WHEN** a free-text request requires model-assisted routing
- **THEN** the fast Kimi tier uses thinking-disabled function calling for structured output
- **AND** does not rely on LangChain's inferred OpenAI JSON Schema mode

#### Scenario: Hotel knowledge without live facts

- **WHEN** a user asks for hospitality knowledge or operating advice that does not require the user's
  current or historical hotel facts
- **THEN** the Agent answers through Kimi without MCP tools

#### Scenario: Authorized hotel-data read

- **WHEN** a resolved business workflow requires the user's current or historical hotel facts
- **THEN** the selected business route authorizes the `hotel_data` capability for the collection phase
- **AND** the runtime initializes only matching configured servers

#### Scenario: Future dependency is configured but not mapped

- **WHEN** an MCP server or Skill is added without a server-owned intent dependency declaration
- **THEN** no Agent Run initializes or applies that dependency
