# Design

## Lifecycle contract

The Agent contract gains `cancelRun(principal, runId)` and an explicit `cancelled` terminal status and
`run_cancelled` event. The mutation returns the persisted terminal status. Ownership always comes
from the authenticated session; a foreign run is indistinguishable from a missing run.

Cancellation is idempotent. Cancelling an already terminal owned run returns its existing status and
does not publish another event. The server stores cancelled separately from failed so UI, logs and
replayed execution traces describe user intent accurately.

## Server coordination

`HotelAgentGateway` keeps only currently executing run controllers and completion promises in memory.
For an active run it aborts the controller and waits for the execution path to persist and publish the
cancelled terminal state. For a database run left `running` without a local controller, such as after
a process restart, it transitions that owned run directly and publishes the same terminal event.

Successful finalization and cancellation compete through conditional `running` transitions inside
PostgreSQL. Assistant-message insertion belongs to the successful-finalization transaction, so a
cancellation that wins cannot later acquire an assistant response. Abort errors are expected control
flow and use informational cancellation logs rather than failure logs.

## Desktop interaction

The stop control awaits the authenticated mutation instead of immediately unsubscribing. While that
request is pending, the composer remains disabled and the control shows a stopping state. The
`run_cancelled` event and mutation result converge the local execution trace on `cancelled`; the SSE
subscription is removed only after a terminal event or cancellation acknowledgement.

After acknowledgement the existing conversation stays selected and the composer is focused. Any
subsequent text, including `继续`, follows the ordinary `startRun` path with a fresh client request ID.
The server reconstructs context from persisted messages and summary; partial draft output and hidden
runtime state are not reused.

## Failure and restart behavior

If cancellation fails, the current run remains active in the UI and its subscription stays connected.
If the runtime ignores abort beyond a bounded upstream operation, the cancel mutation waits for the
execution path, while the shared `AbortSignal` still prevents subsequent model/tool work. A restarted
server can terminalize an orphaned `running` row even though no in-memory operation remains.
