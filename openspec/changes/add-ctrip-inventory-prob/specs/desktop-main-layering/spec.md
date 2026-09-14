## ADDED Requirements

### Requirement: Timer-driven work is owned by a scope and disposable

Recurring work driven by a timer SHALL be started only by a composition scope, and its start
operation SHALL return a dispose handle registered on that scope's disposers chain. A timer
SHALL NOT be created by `channels/`, `services/` or `ipc/` code on its own.

After a scope is disposed, its timers SHALL NOT fire and SHALL NOT keep the process alive.

#### Scenario: Window is closed while a polling round is scheduled

- **WHEN** the owning scope is disposed with a timer armed
- **THEN** the timer is cleared by the dispose handle
- **AND** no further rounds are started
- **AND** an in-flight round's result is discarded rather than delivered to a disposed scope

#### Scenario: Channel adapter needs periodic execution

- **WHEN** a channel capability must run periodically
- **THEN** the adapter exposes a single-round operation with no timer of its own
- **AND** the composition root owns the interval and the dispose handle
