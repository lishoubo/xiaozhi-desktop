# Desktop Main Process Layering

## Purpose

Define the layer boundaries inside `apps/desktop/src/main`, and require that each
boundary is enforced by lint rather than by convention.

## Requirements

### Requirement: Layer boundaries are lint-enforced

Every layer boundary below SHALL be expressed as an eslint rule in
`apps/desktop/.eslintrc.json`. A boundary documented only in prose or in a code
comment does not satisfy this requirement.

#### Scenario: A boundary is introduced or changed

- **WHEN** a new layer boundary is agreed, or an existing one is redefined
- **THEN** the corresponding `no-restricted-imports` / `import/no-restricted-paths`
  rule is added or updated in the same change
- **AND** `npm run lint:desktop` fails on code that violates it

### Requirement: IPC handlers are boundary-only

`main/ipc/**` SHALL perform exactly four steps: verify the sender is the trusted
window, validate arguments against a zod schema, call exactly one service method,
and translate errors into user-facing messages. Business logic SHALL NOT live in
this layer.

#### Scenario: Handler needs data from storage

- **WHEN** an IPC handler needs repository or file-system data
- **THEN** it calls a service in `main/services/` instead of importing
  `database/`, `file-store/`, `cookie-import/`, `browser/` or `server-client/`

#### Scenario: Handler needs an Electron capability

- **WHEN** an IPC handler needs an `electron.app` capability
- **THEN** that capability is exposed through a service (for example
  `SystemService`), and `electron` is imported only by
  `main/ipc/create-handler-registry.ts`

#### Scenario: Handler declares its dependency

- **WHEN** an IPC handler depends on a service
- **THEN** it declares a narrow interface in its own file and does not import the
  service implementation class

### Requirement: Sender trust check has a single implementation

The check that rejects IPC requests from any sender other than the main window
SHALL exist in exactly one place, `main/ipc/create-handler-registry.ts`.

#### Scenario: A new IPC channel is registered

- **WHEN** a new channel is added
- **THEN** it is registered through `createHandlerRegistry`, inheriting the trust
  check, argument validation and disposal behaviour

### Requirement: OTA tabs have a single entry point

All OTA browser tabs SHALL be opened through `main/ota-tab/`. Services SHALL NOT
import `BrowserManager` directly, because bypassing this entry point silently
skips login detection and account discovery rather than failing.

#### Scenario: A service needs to open an OTA tab

- **WHEN** a service needs to open an OTA tab
- **THEN** it calls `OtaTabService`, and lint rejects any direct import of
  `browser/browser-manager` from `main/services/**`

### Requirement: Credential broadcast happens after persistence

`LoginDetector` SHALL broadcast `tab:credential-checked` only after
`triggerDiscovery` has finished writing the credential.

#### Scenario: Login is detected on a channel that navigates once

- **WHEN** a login tab reaches a post-login URL
- **THEN** discovery runs and the credential is persisted
- **AND** only then is `tab:credential-checked` emitted, so subscribers such as
  `OtaHotelProbService` never observe a null credential and never permanently
  miss their only probing opportunity

### Requirement: Channel adapters are injected, never depended upon

`main/channels/**` SHALL implement the interfaces in `main/channels/types.ts` and
SHALL NOT import `services/`, `ipc/` or `composition/`. Adapters are wired through
`main/channels/registry.ts`.

#### Scenario: A new OTA channel is added

- **WHEN** support for a new channel is added
- **THEN** the work is confined to a new `main/channels/<name>/` directory plus one
  entry in `registry.ts`, with no change to services or to the composition root

### Requirement: Object construction is confined to the composition root

Only `main/composition/**` SHALL instantiate implementation classes. `main/index.ts`
SHALL contain no business-object construction.

#### Scenario: Wiring a dependency

- **WHEN** an implementation must be bound to an interface
- **THEN** the binding happens in `composition/app-scope.ts` (process-scoped) or
  `composition/window-scope.ts` (window-scoped), and every other module depends on
  the interface

#### Scenario: Releasing window-scoped resources

- **WHEN** the main window closes or the application quits
- **THEN** cleanup runs through the single `disposers` chain in
  `composition/window-scope.ts`, in reverse registration order — cleanup lists are
  never duplicated across call sites

### Requirement: Shared code does not depend on main

`src/shared/**` SHALL NOT import from `src/main/**`. Branded identifier *types*
belong to `shared/types/ids.ts`; their validating *constructors*, which throw,
belong to `main/ids.ts`.

#### Scenario: Renderer needs an identifier type

- **WHEN** renderer or preload code needs `ChannelId` or a similar identifier
- **THEN** it imports the type from `shared/types/ids.ts` and never gains access to
  the throwing constructors, which are a main-process boundary guard
