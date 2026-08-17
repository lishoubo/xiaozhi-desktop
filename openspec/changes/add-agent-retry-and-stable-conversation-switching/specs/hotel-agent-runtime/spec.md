# Delta: Hotel Agent runtime

## ADDED Requirements

### Requirement: Stable conversation switching

The desktop SHALL keep the current conversation surface mounted while loading an uncached target
and SHALL commit target selection together with its hydrated snapshot.

#### Scenario: Switch to an uncached conversation
- **WHEN** the employee selects a conversation whose view is not cached
- **THEN** the current messages remain visible until the target snapshot succeeds
- **AND** the page does not flash the new-conversation empty state

### Requirement: Single generated UI invocation

A grounded answer Run SHALL execute at most one successful `render_hotel_ui` call and SHALL not emit
tool lifecycle events for a suppressed duplicate request.

#### Scenario: Model requests UI twice
- **WHEN** one valid UI has already been emitted and the next model turn requests rendering again
- **THEN** the runtime returns the first UI with a bounded textual conclusion
- **AND** no second render tool start or completion event is published
