## MODIFIED Requirements

### Requirement: Generated UI is committed with the final answer

The system SHALL validate generated UI as a bounded staged artifact and SHALL expose it to the desktop
only when the final assistant message is committed. Table cells SHALL be scalar values.

#### Scenario: Invalid nested table data

- **WHEN** a model proposes an object or array as a Table cell
- **THEN** the server rejects that UI candidate before it reaches the desktop

#### Scenario: UI generation is in progress

- **WHEN** the model is still constructing or reconsidering a generated UI candidate
- **THEN** the desktop shows ordinary processing feedback without an empty generated-UI frame

### Requirement: Operating summary uses a bounded deterministic query

The hotel operating-summary workflow SHALL use the server-pinned DMS SQL tool and reviewed aggregate
query. It SHALL NOT fall back to recursive schema discovery for the operating-summary shortcut.

#### Scenario: Deterministic tool unavailable

- **WHEN** the pinned DMS SQL tool is unavailable or incompatible
- **THEN** the Run fails with bounded retry guidance without invoking schema-discovery tools

### Requirement: Quick actions reflect daily hotel operations

The server-owned quick-action catalog SHALL offer a yesterday operating review and SHALL NOT advertise
the removed weather shortcut. Free-form weather questions remain supported.
