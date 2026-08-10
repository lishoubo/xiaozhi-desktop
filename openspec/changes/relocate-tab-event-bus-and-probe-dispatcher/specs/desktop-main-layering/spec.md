## MODIFIED Requirements

### Requirement: Channel adapters are injected, never depended upon

`main/channels/**` SHALL implement the interfaces in `main/channels/types.ts` and
SHALL NOT import `services/`, `ipc/`, `composition/`, `database/` or `gateway/`.
Adapters MAY import `main/ota-tab/` to subscribe to tab lifecycle facts. Anything
a channel adapter needs from an outer layer — persistence, notification, logging —
SHALL be injected as a narrow callback or interface, never imported. Adapters are
wired through `main/channels/registry.ts`.

#### Scenario: A new OTA channel is added

- **WHEN** support for a new channel is added
- **THEN** the work is confined to a new `main/channels/<name>/` directory plus one
  entry in `registry.ts`, with no change to services or to the composition root

#### Scenario: A channel adapter needs to persist or notify

- **WHEN** code under `main/channels/**` needs to write data or inform an outer layer
- **THEN** it declares a narrow callback in its own dependencies and the composition
  root supplies the implementation
- **AND** lint rejects a direct import of `database/`, `gateway/`, `services/`,
  `ipc/` or `composition/` from `main/channels/**`

#### Scenario: A channel adapter observes tab lifecycle

- **WHEN** code under `main/channels/**` needs to react to a tab navigation or
  credential-check fact
- **THEN** it subscribes to the event bus exported from `main/ota-tab/`, which is
  the only outer directory `channels/` may import

### Requirement: Credential broadcast happens after persistence

`LoginDetector` SHALL broadcast `tab:credential-checked` only after
`triggerDiscovery` has finished writing the credential. The event bus SHALL live in
`main/ota-tab/` alongside its only emitter; no other module SHALL emit on it.

#### Scenario: Login is detected on a channel that navigates once

- **WHEN** a login tab reaches a post-login URL
- **THEN** discovery runs and the credential is persisted
- **AND** only then is `tab:credential-checked` emitted, so subscribers such as
  `HotelProbeDispatcher` never observe a null credential and never permanently
  miss their only probing opportunity

#### Scenario: A subscriber reacts to the broadcast

- **WHEN** a module needs to act on a credential-check result
- **THEN** it subscribes to the bus exported from `main/ota-tab/` and decides for
  itself whether to respond — the bus broadcasts facts, never instructions
