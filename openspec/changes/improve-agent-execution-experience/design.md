# Design

## Event model

The current tRPC SSE stream remains the transport. Its normalized events are not AG-UI events even
though AG-UI packages are installed. `packages/api` gains an `AgentExecutionTrace` read model made
from persisted `agent_run` and `agent_run_event` rows. It contains run ownership-neutral IDs,
status, timestamps and tool steps; it never contains prompts, model output or tool payloads.

`AgentConversation` returns complete messages plus execution traces. The server repository derives
each trace from persisted events and links it to the assistant message ID carried by the terminal
`run_completed` event. The renderer maintains the same shape during a live run, so completion does
not replace the component or discard its steps.

## Presentation

The execution trace is a reusable Svelte component. Running traces start expanded; completed
historical traces start collapsed but remain toggleable. A compact timeline represents analysis,
tool calls and terminal status without claiming that the model emitted a formal plan.

Existing `enter` and AutoAnimate motion primitives animate message insertion, trace expansion and
step changes. Motion durations remain short and reduced-motion preferences continue to disable
movement. The history rail uses smaller type, compact spacing, a subtle selected indicator and a
quiet updated-time label.

Ordinary assistant text uses `marked` for runtime GFM parsing and `DOMPurify` before insertion into
the DOM. User messages remain plain text, and generated UI continues through the constrained
json-render registry rather than Markdown. Interactive form elements, scripts, event attributes and
unsafe URLs are removed from model-provided markup.

## Logging

`AgentService` and `HotelAgentGateway` log structured lifecycle events at their client/server
orchestration boundaries:

- run accepted or idempotently reused;
- event subscription replay state;
- execution started and context prepared;
- tool started/completed;
- execution completed with duration and output shape;
- summary fallback and run failure with a safe failure classification and error type.

Text deltas, prompts, answers, memory content, tool arguments/results and credentials are never
logged. This keeps debug logs useful without turning them into a second conversation store.

## Compatibility

Adding `executions` to the strict conversation response is a shared contract change, so server,
desktop main/preload and tests update together. The streaming event schema does not change.
