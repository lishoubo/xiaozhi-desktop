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
business executions, incremental summaries and employee-scoped memory. A business execution may
span several Runs while its versioned state machine persists routing, clarification, workflow,
evidence and answer phases. MCP and Kimi credentials remain server-side.

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

The server SHALL run one Kimi-backed hotel Agent per run, SHALL NOT delegate to sub-Agents and SHALL
allow an authenticated employee to cancel an owned active run.

#### Scenario: Start a run

- **WHEN** an authenticated desktop employee starts an Agent run
- **THEN** the server persists the user message and run before model execution
- **AND** returns an idempotent run ID keyed by employee and client request ID

#### Scenario: Cancel an active run

- **WHEN** an employee stops an owned active run
- **THEN** the server aborts model and tool execution and persists `cancelled` as the terminal status
- **AND** the run cannot subsequently persist an assistant answer or become completed

#### Scenario: Cancel another employee's run

- **WHEN** an employee requests cancellation of a run they do not own
- **THEN** the server returns no resource data and does not affect that run

#### Scenario: Repeat cancellation

- **WHEN** cancellation is requested for an already terminal owned run
- **THEN** the server returns its existing terminal status without publishing a duplicate event

### Requirement: Explicit conversation selection

The desktop SHALL start on a new-conversation state and SHALL allow the employee to select,
continue, delete one or clear all owned historical conversations. Conversation navigation SHALL be
independent from Run execution: switching conversations or leaving the Agent page SHALL NOT cancel
an active Run; only an explicit Stop action SHALL request cancellation.

#### Scenario: Start a new conversation

- **WHEN** the employee opens the Agent page or chooses `开始新会话`
- **THEN** no historical conversation is selected
- **AND** the conversation record is created lazily when the first run starts

#### Scenario: Continue a historical conversation

- **WHEN** the employee selects an item under `继续历史会话`
- **THEN** the desktop loads and displays that conversation's complete stored messages
- **AND** a later run sends the conversation ID and new request rather than trusting a
  client-supplied history

#### Scenario: Switch away from an active conversation

- **WHEN** an employee selects a new or historical conversation while the current Run is active
- **THEN** the Run continues and its events update only its own conversation state
- **AND** the history list marks that conversation as running

#### Scenario: Return to an active conversation

- **WHEN** an employee returns to a conversation whose Run is still active
- **THEN** the desktop restores its persisted partial text, generative UI and execution trace
- **AND** resumes its event subscription after the last persisted event ID

#### Scenario: Leave the Agent page during a Run

- **WHEN** the renderer unmounts while a Run is active
- **THEN** it removes only its renderer event listener and does not request cancellation

#### Scenario: Delete one historical conversation

- **WHEN** an employee confirms deletion of an owned conversation
- **THEN** the conversation, messages, runs and run events are deleted
- **AND** employee-scoped long-term memory remains unchanged

#### Scenario: Delete the active conversation

- **WHEN** an employee deletes the active completed conversation
- **THEN** the desktop returns to the new-conversation state
- **AND** deletion controls are disabled while a run is active

#### Scenario: Clear conversation history

- **WHEN** an employee confirms clearing all conversation history
- **THEN** every conversation owned by that employee and its dependent records are deleted
- **AND** no other employee's conversation or memory is affected

### Requirement: Session-derived ownership

Agent ownership SHALL be derived from the authenticated phone cookie or validated staff Bearer session and SHALL NOT be accepted from client input.

#### Scenario: Access another employee conversation

- **WHEN** an employee requests a conversation, run, event stream or memory not owned by that employee
- **THEN** the server returns no resource data
- **AND** persistence queries retain the authenticated employee owner predicate

#### Scenario: Delete another employee's conversation

- **WHEN** an employee requests deletion of a conversation they do not own
- **THEN** the server returns no resource data and does not delete the conversation

### Requirement: Server-owned conversation context

The server SHALL reconstruct model context from the selected conversation's persisted messages.
The client SHALL NOT be authoritative for historical context.

#### Scenario: Prepare a continued conversation

- **WHEN** a run starts for an existing conversation
- **THEN** the server loads ordered messages and the stored summary cursor under the employee
  ownership predicate
- **AND** passes the prepared summary and recent history through the runtime port

#### Scenario: Continue after cancellation

- **WHEN** an employee submits new text such as `继续` after cancellation
- **THEN** the server creates a distinct Run under the same conversation
- **AND** prepares it from persisted context without restoring the cancelled Run's hidden state,
  partial draft or tool stack

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

Agent progress and cancellation SHALL be delivered through a tRPC v11 SSE subscription using
tracked event IDs. Persisted lifecycle events SHALL also project to an SDK-neutral execution trace
returned with the owned conversation. An active conversation response SHALL additionally project the
partial text, latest generative UI, UI preparation state and last persisted event ID for its newest
running Run.

#### Scenario: Reconnect a run

- **WHEN** the SSE client reconnects with its last tracked event ID
- **THEN** the server replays later persisted events in order
- **AND** does not emit an event twice within that subscription

#### Scenario: Recreate the renderer during an active Run

- **WHEN** the desktop loads a conversation with an active Run after navigation or renderer restart
- **THEN** it hydrates from the persisted active-Run projection
- **AND** Electron main replaces or starts the SSE subscription from that projection's event cursor

#### Scenario: Publish a live event

- **WHEN** runtime emits text, tool lifecycle or generative-UI output
- **THEN** the gateway persists the normalized event before notifying live SSE subscribers

#### Scenario: Reopen a completed conversation

- **WHEN** an employee reopens an owned historical conversation
- **THEN** tool steps are reconstructed from persisted run events
- **AND** the corresponding answer retains an accessible, toggleable execution-flow control

#### Scenario: Observe cancellation

- **WHEN** a run is cancelled
- **THEN** a replayable `run_cancelled` terminal event is persisted and delivered
- **AND** reopening the conversation presents the run as cancelled rather than failed

#### Scenario: Continue after a cancelled Run

- **WHEN** a cancelled Run is followed by new user input and a new Run
- **THEN** the cancelled trace remains next to its original user message
- **AND** the later execution and answer remain in chronological order

#### Scenario: Switch to an uncached conversation
- **WHEN** the employee selects a conversation whose snapshot is not in renderer memory
- **THEN** the current conversation remains rendered until the target snapshot is ready
- **AND** the target is committed without replaying message entrance animations

#### Scenario: Display a retryable failure
- **WHEN** a persisted Run failure is marked retryable
- **THEN** the desktop presents one manual retry action for the latest failed attempt
- **AND** a new attempt preserves the failed execution trace in history

### Requirement: Observable business execution phases

The server SHALL record privacy-safe duration logs for workflow collection, evidence assessment and
post-validation answer generation so time outside MCP lifecycle events is attributable.

#### Scenario: Grounded read completes

- **WHEN** a business read progresses from collection through answer generation
- **THEN** logs identify collection strategy, phase duration, assessment status and UI presence
- **AND** omit user content, tool arguments, evidence data, model output and generated UI payloads

### Requirement: Single generated result UI

One Run SHALL publish at most one successful `render_hotel_ui` lifecycle and UI specification.
Later render requests SHALL be suppressed and SHALL return the first valid UI without treating an
error ToolMessage as business evidence.

#### Scenario: Model requests a second render
- **WHEN** one valid UI has been emitted and the model requests `render_hotel_ui` again
- **THEN** the second call publishes no started/completed lifecycle events and cannot overwrite UI
- **AND** the Run completes with the first valid UI and a bounded conclusion

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

#### Scenario: Prepare memory for a Run

- **WHEN** the runtime prepares a Run
- **THEN** it loads employee memory once into the guarded system context
- **AND** does not offer the model a redundant memory-recall tool

### Requirement: Controlled extensibility

MCP tools SHALL load only from server-side configuration, and business Skills SHALL be supplied through a Skill provider that may be empty.

#### Scenario: No MCP or Skill is configured

- **WHEN** the Agent starts without configured MCP servers or Skills
- **THEN** normal Kimi conversation and local memory/UI tools remain available

#### Scenario: Load MCP tools

- **WHEN** MCP servers are configured
- **THEN** remote URLs use HTTPS except loopback development
- **AND** write-like tools remain unavailable regardless of operator or remote catalog settings
- **AND** independent server tool catalogs initialize concurrently and retain configuration order

#### Scenario: Query hotel operating data

- **WHEN** the Agent uses the configured DMS MCP
- **THEN** the provider exposes only approved read tools, constrains arguments before the call and
  compacts oversized results afterward
- **AND** pins table discovery, SQL generation and SQL execution to the server-resolved numeric DMS ID
- **AND** attempts `searchDatabase` to validate the configured schema and pinned ID when available
- **AND** falls back to the pinned ID only when discovery is unavailable or has no exact match
- **AND** rejects an explicit discovered ID conflict before exposing downstream tools
- **AND** a resolved operating-summary request uses one code-owned aggregate SELECT against
  `fact_business_daily`, while generic reads may use bounded schema discovery and SQL generation
- **AND** instance management, data-change orders and approval tools are never exposed

#### Scenario: Ground a hotel-specific business answer

- **WHEN** an answer depends on a specific hotel's current or historical operating facts
- **THEN** the Agent queries the configured hotel-data MCP before answering
- **AND** general hospitality concepts may still be answered without an unnecessary lookup
- **AND** the read-only Agent never claims that a requested business write operation was executed

### Requirement: Capability-backed quick actions

The Agent SHALL advertise a compact quick-action catalog derived from configured MCP capabilities,
and SHALL resolve quick-action prompts on the server rather than accepting prompt text from the
client. The representative catalog SHALL expose yesterday operating review and configurable-period
hotel operating-data actions when the DMS hotel-data capability is configured. Weather SHALL remain
available to natural-language routing but SHALL NOT occupy a quick-action slot.

#### Scenario: Show representative test shortcuts

- **WHEN** weather and hotel-data MCP capabilities are configured
- **THEN** the catalog exposes `昨日经营复盘` and `查看酒店经营概览`
- **AND** it does not expose a weather shortcut
- **AND** clicking the operating-data action starts a Run that requires the read-only hotel-data MCP

#### Scenario: Hotel-data MCP is unavailable

- **WHEN** the `hotel_data` capability is not configured
- **THEN** the operating-data shortcut is not advertised
- **AND** a direct request for it is rejected before Run persistence

### Requirement: Constrained generative UI

The model SHALL generate UI only through the server-side `render_hotel_ui` tool and the desktop SHALL
render it with the established json-render registry. Generated charts and tables SHALL remain
readable within the conversation width.

#### Scenario: Validate generated UI

- **WHEN** the model submits a UI spec
- **THEN** the server validates component names, references, size and link protocols
- **AND** rejects arbitrary code or unregistered components

#### Scenario: Prevent repeated UI rendering

- **WHEN** a Run has already produced one valid generated UI spec
- **THEN** a later `render_hotel_ui` attempt is not executed or displayed as another tool step
- **AND** the Run completes with the first UI instead of exhausting the Agent recursion limit

#### Scenario: Render a dense date trend

- **WHEN** a trend contains more date labels than fit without collision
- **THEN** the desktop displays compact, bounded x-axis labels while retaining exact tooltip values

#### Scenario: Prepare generated UI

- **WHEN** the runtime starts `render_hotel_ui`
- **THEN** the server validates and stages the result view without publishing a partial UI spec
- **AND** the desktop renders it only with the successful final assistant message
- **AND** no placeholder frame is displayed while rendering is incomplete

#### Scenario: Reject non-scalar table cells

- **WHEN** a generated Table contains an object, array, non-finite number or a row of the wrong width
- **THEN** the server rejects that UI candidate
- **AND** the Agent may finish with a text answer without displaying the rejected view

### Requirement: Proportional execution presentation

The desktop SHALL keep persisted Runs for audit and recovery while hiding empty successful execution
traces that add no useful information to an ordinary answer.

#### Scenario: Answer a general capability question

- **WHEN** an ordinary answer completes without tool steps, failure or cancellation
- **THEN** the assistant answer is displayed without an empty execution-plan panel
- **AND** the Run remains persisted for conversation and audit consistency

### Requirement: Safe Markdown presentation

The desktop SHALL render ordinary assistant text as Markdown after sanitizing executable and
interactive markup. User messages SHALL remain plain text and generative UI SHALL retain its
separate constrained renderer.

#### Scenario: Render a structured assistant answer

- **WHEN** an ordinary assistant answer contains headings, lists, tables, links or code
- **THEN** the desktop presents their Markdown structure within the conversation hierarchy

#### Scenario: Reject dangerous assistant markup

- **WHEN** assistant text contains scripts, event attributes, unsafe URLs or form controls
- **THEN** the desktop removes those constructs before inserting the rendered result into the DOM


### Requirement: Secret and untrusted-data isolation

Kimi keys, MCP credentials and authorization values SHALL remain server-side. Prompts, summaries,
memories and MCP results SHALL be treated as untrusted data and SHALL NOT override system rules.

#### Scenario: Untrusted content requests privilege expansion

- **WHEN** user text, a stored memory, a summary or MCP output asks to reveal credentials, change
  system rules or bypass tool restrictions
- **THEN** the Agent ignores that instruction and retains the server-defined policy

#### Scenario: Log Agent execution

- **WHEN** a run is accepted, prepares context, invokes a tool, completes or fails
- **THEN** client/server structured logs identify safe lifecycle facts, duration and failure class
- **AND** omit prompts, answers, memories, tool arguments/results and credentials

### Requirement: Business execution projection and API

Conversation responses SHALL expose business executions separately from per-Run traces and associate
messages and Runs through nullable execution identifiers. Strict owner-checked mutations SHALL
submit or cancel the current clarification without accepting client-supplied owner fields.

#### Scenario: Load a legacy conversation
- **WHEN** stored messages and Runs predate business-execution support
- **THEN** they remain readable with null business-execution associations

#### Scenario: Receive a live clarification
- **WHEN** a Run transitions to waiting for clarification
- **THEN** the update is persisted and emitted over the existing tracked SSE transport
- **AND** a fresh owned conversation query remains authoritative after reconnect

#### Scenario: Receive a terminal Run failure
- **WHEN** a Run fails while its business execution is non-terminal
- **THEN** the server persists that business execution as failed
- **AND** the desktop clears its active-execution projection when it receives `run_failed`
- **AND** a later shortcut is not blocked by the stale execution

### Requirement: Conversation viewport follows current work

The desktop SHALL open a historical Agent conversation at its latest visible content. While the
employee remains near the bottom, message, stream, tool-timeline and clarification growth SHALL keep
the viewport at the latest content. Manual upward scrolling SHALL pause that behavior until the
employee returns near the bottom or starts another interaction.

#### Scenario: Open a historical conversation
- **WHEN** an employee selects a historical Agent conversation
- **THEN** the desktop waits for its messages to render and positions the viewport at the bottom

#### Scenario: Read earlier messages during an active conversation
- **WHEN** the employee scrolls upward beyond the bottom threshold
- **THEN** subsequent rendered content does not force the viewport away from the reading position
- **AND** following resumes after the employee returns near the bottom or initiates a new interaction
