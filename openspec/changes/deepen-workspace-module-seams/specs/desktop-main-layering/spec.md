## MODIFIED Requirements

### Requirement: Layer boundaries are lint-enforced

Every desktop layer dependency rule SHALL be expressed as an eslint rule and SHALL apply to TypeScript modules, Svelte modules and `.svelte` files. A rule that is skipped because the file extension is not linted does not satisfy this requirement.

#### Scenario: Renderer Svelte imports main

- **WHEN** a `.svelte` file under `src/renderer/**` imports `src/main/**`
- **THEN** `npm run lint:desktop` fails with the renderer trust-seam message

#### Scenario: A production implementation is imported outside composition

- **WHEN** code outside `main/composition/**` imports a production adapter for object wiring
- **THEN** lint fails and directs the dependency to a narrow interface

### Requirement: Object construction is confined to the composition root

Production adapters SHALL be bound to interfaces only in `main/composition/**`. Implementation modules MAY construct private in-module helpers, but SHALL NOT create another production adapter through a default constructor argument or hidden singleton.

#### Scenario: A module needs a production dependency

- **WHEN** a module requires `SessionFactory`, repository, remote gateway or another production adapter
- **THEN** its caller supplies that dependency explicitly
- **AND** tests may supply an in-memory or fake adapter through the same seam

### Requirement: Cross-scope capabilities have an explicit lifecycle

Process-scoped modules that call window-scoped capabilities SHALL use one registry interface whose `attach` operation returns the matching detach handle. Multiple independent setter callbacks SHALL NOT encode window lifecycle.

#### Scenario: Main window is created and closed

- **WHEN** `WindowScope` is created
- **THEN** it attaches one complete `WindowCapabilities` adapter
- **AND** disposing the scope detaches exactly that adapter
- **AND** calls made without an attached window receive an explicit unavailable result or documented error
