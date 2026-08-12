# Hotel Agent runtime

## Purpose

Define the current Hotel Agent boundaries, conversation lifecycle, context compression,
single-Agent execution, streaming, persistence and employee isolation across desktop and server.

## Architecture

The renderer accesses Agent capabilities only through preload. Electron main validates IPC,
delegates to `AgentService`, and calls the shared tRPC contract over HTTPS. The server resolves the
authenticated employee before delegating to `HotelAgentGateway`.

`HotelAgentGateway` owns orchestration and depends on the SDK-neutral `AgentRuntime` port.
`LangChainAgentRuntime` is the current Kimi/LangChain adapter; prompts, local tool handlers,
generative-UI validation and conversation-context policy remain independent modules rather than
SDK-owned application logic.

PostgreSQL is the source of truth for conversations, complete messages, runs, replayable events,
incremental summaries and employee-scoped memory. MCP and Kimi credentials remain server-side.

See the [current architecture diagram](../../../docs/arch/2026-08-12-hotel-agent-architecture.mmd).
## Requirements

### Requirement: Shared contract and client trust boundaries

Agent schemas and the tRPC gateway contract SHALL live in `packages/api`; renderer code SHALL use
preload, and Electron main SHALL own the HTTPS tRPC client and SSE subscription.

#### Scenario: Renderer invokes an Agent capability

- **WHEN** renderer lists conversations, opens a conversation or starts a run
- **THEN** preload validates the response schema and IPC validates the request and trusted sender
- **AND** desktop does not import the server implementation

### Requirement: Replaceable runtime boundary

Run orchestration SHALL depend on the SDK-neutral `AgentRuntime` interface. SDK-specific model,
message-stream and tool-call behavior SHALL remain in an adapter implementation.

#### Scenario: Replace the Agent SDK

- **WHEN** a second Agent SDK is introduced
- **THEN** it implements `AgentRuntime.run` and emits normalized runtime events
- **AND** conversation persistence, context compression, prompt construction, tool handlers, UI
  validation, tRPC/SSE delivery and desktop rendering do not require a rewrite

### Requirement: Authenticated single-Agent execution

The server SHALL run one Kimi-backed hotel Agent per run and SHALL NOT delegate to sub-Agents.

#### Scenario: Start a run

- **WHEN** an authenticated desktop employee starts an Agent run
- **THEN** the server persists the user message and run before model execution
- **AND** returns an idempotent run ID keyed by employee and client request ID

### Requirement: Explicit conversation selection

The desktop SHALL start on a new-conversation state and SHALL allow the employee to select an
owned historical conversation to continue.

#### Scenario: Start a new conversation

- **WHEN** the employee opens the Agent page or chooses `开始新会话`
- **THEN** no historical conversation is selected
- **AND** the conversation record is created lazily when the first run starts

#### Scenario: Continue a historical conversation

- **WHEN** the employee selects an item under `继续历史会话`
- **THEN** the desktop loads and displays that conversation's complete stored messages
- **AND** a later run sends the conversation ID and new request rather than trusting a
  client-supplied history

### Requirement: Session-derived ownership

Agent ownership SHALL be derived from the authenticated phone cookie or validated staff Bearer session and SHALL NOT be accepted from client input.

#### Scenario: Access another employee conversation

- **WHEN** an employee requests a conversation, run, event stream or memory not owned by that employee
- **THEN** the server returns no resource data
- **AND** persistence queries retain the authenticated employee owner predicate

### Requirement: Server-owned conversation context

The server SHALL reconstruct model context from the selected conversation's persisted messages.
The client SHALL NOT be authoritative for historical context.

#### Scenario: Prepare a continued conversation

- **WHEN** a run starts for an existing conversation
- **THEN** the server loads ordered messages and the stored summary cursor under the employee
  ownership predicate
- **AND** passes the prepared summary and recent history through the runtime port

### Requirement: Incremental context compression

Context compression SHALL preserve all original messages and SHALL store only an incremental
summary plus the last summarized message ID on the conversation.

For `kimi-k3`, the policy SHALL use the configured 1,048,576-token context capacity, trigger at an
estimated 262,144 tokens, retain approximately 32,768 recent tokens and at least eight recent
messages, and bound a generated summary to 4,096 tokens. Unknown models SHALL use a conservative
131,072-token fallback window with the same proportional trigger policy.

#### Scenario: Context remains below the threshold

- **WHEN** the stored summary and unsummarized messages are below the trigger
- **THEN** no summary model call occurs
- **AND** the stored summary and all unsummarized messages are sent to the runtime

#### Scenario: Context reaches the threshold

- **WHEN** estimated context reaches the configured trigger
- **THEN** the service summarizes only the older unsummarized messages together with any previous
  summary
- **AND** keeps the recent token target and minimum recent-message count verbatim
- **AND** saves the new summary with a compare-and-set cursor update

#### Scenario: Compression fails or races

- **WHEN** summary generation fails
- **THEN** the run falls back to the complete stored conversation without blocking the user
- **WHEN** another run advances the summary cursor concurrently
- **THEN** the service reloads context and retries once instead of overwriting newer state

### Requirement: Recoverable streaming

Agent progress SHALL be delivered through a tRPC v11 SSE subscription using tracked event IDs.

#### Scenario: Reconnect a run

- **WHEN** the SSE client reconnects with its last tracked event ID
- **THEN** the server replays later persisted events in order
- **AND** does not emit an event twice within that subscription

#### Scenario: Publish a live event

- **WHEN** runtime emits text, tool lifecycle or generative-UI output
- **THEN** the gateway persists the normalized event before notifying live SSE subscribers

### Requirement: Persistent conversations and memory

Conversation messages SHALL survive process restarts, and employee-scoped long-term memory SHALL be available across that employee's conversations.

#### Scenario: Start another conversation

- **WHEN** the same employee creates a later conversation
- **THEN** the Agent may read that employee's stored long-term memories
- **AND** cannot read another employee's memories

#### Scenario: Save a long-term memory

- **WHEN** the model calls the memory tool for an explicitly stable user preference or fact
- **THEN** the server upserts the employee-and-key memory record
- **AND** conversation summaries and long-term memories remain separate data sets

### Requirement: Controlled extensibility

MCP tools SHALL load only from server-side configuration, and business Skills SHALL be supplied through a Skill provider that may be empty.

#### Scenario: No MCP or Skill is configured

- **WHEN** the Agent starts without configured MCP servers or Skills
- **THEN** normal Kimi conversation and local memory/UI tools remain available

#### Scenario: Load MCP tools

- **WHEN** MCP servers are configured
- **THEN** remote URLs use HTTPS except loopback development
- **AND** write-like tools remain disabled unless the operator explicitly enables them

#### Scenario: Query hotel operating data

- **WHEN** the Agent uses the configured DMS MCP
- **THEN** the provider exposes only approved read tools, constrains arguments before the call and
  compacts oversized results afterward

### Requirement: Constrained generative UI

The model SHALL generate UI only through the server-side `render_hotel_ui` tool and the desktop SHALL render it with the established json-render registry.

#### Scenario: Validate generated UI

- **WHEN** the model submits a UI spec
- **THEN** the server validates component names, references, size and link protocols
- **AND** rejects arbitrary code or unregistered components

### Requirement: Secret and untrusted-data isolation

Kimi keys, MCP credentials and authorization values SHALL remain server-side. Prompts, summaries,
memories and MCP results SHALL be treated as untrusted data and SHALL NOT override system rules.

#### Scenario: Untrusted content requests privilege expansion

- **WHEN** user text, a stored memory, a summary or MCP output asks to reveal credentials, change
  system rules or bypass tool restrictions
- **THEN** the Agent ignores that instruction and retains the server-defined policy
