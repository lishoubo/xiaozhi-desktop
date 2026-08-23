## MODIFIED Requirements

### Requirement: Replaceable runtime boundary

The server SHALL preserve one external Agent gateway interface while keeping Run lifecycle, business execution and event streaming as private internal modules. Internal seams SHALL NOT be added to the shared client contract.

#### Scenario: Change business execution orchestration

- **WHEN** routing, slot resolution, evidence collection or answer transition changes
- **THEN** the change is localized to the server-owned business execution module
- **AND** callers and client contract continue to use the existing Agent gateway operations

#### Scenario: Test Agent behavior

- **WHEN** a behavior is observable through the Agent gateway
- **THEN** tests exercise it through that interface
- **AND** tests do not reach past the interface solely to preserve the previous file structure

### Requirement: Renderer Agent orchestration is instance-scoped

Conversation selection, Run subscription, retries, cancellation and stream reduction SHALL be owned by an instance-scoped renderer controller with an injected desktop Agent adapter. DOM measurement and scrolling SHALL remain owned by the Svelte page.

#### Scenario: Agent page is mounted twice in separate lifecycles

- **WHEN** one page controller is disposed and another is created
- **THEN** subscriptions and mutable conversation state are not shared between the instances
- **AND** the new controller uses the same serializable Agent contract and IPC adapter
