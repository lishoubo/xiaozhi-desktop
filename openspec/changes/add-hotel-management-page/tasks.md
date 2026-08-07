## 1. Completed UI prototype baseline

- [x] 1.1 Add focused unit tests for OTA status presentation, action selection, and unknown-status fallback.
- [x] 1.2 Add a focused hotel management component test covering hotel rows, account details, status-aware actions, empty account state, and mock operation feedback.
- [x] 1.3 Extend the routing component test to cover the authenticated “酒店管理” navigation entry and route.
- [x] 1.4 Add the renderer-safe mock model, representative mock data, compact hotel rows and OTA account details.
- [x] 1.5 Wire the hotel management route and left navigation entry.

## 2. RMS models and Gateway ports

- [ ] 2.1 Add focused schema tests for the minimal `RmsHotel` and `RmsOtaAccount` projections and rejection of extra, credential-bearing or malformed IPC values.
- [ ] 2.2 Define framework-free `RmsHotel { id, name, status }`, `RmsOtaAccount { id, hotelId, otaHotelId, otaHotelName, status, source, bindExtra }`, create-hotel, bind, unbind and Cookie snapshot domain types.
- [ ] 2.3 Define `RmsHotelGateway` and `RmsOtaAccountGateway` ports with explicit list/create/delete/bind/unbind semantics.
- [ ] 2.4 Implement deterministic stateful mock Gateways, including duplicate channel binding, missing account ID and remote deletion failure cases.

## 3. Hotel management data path and CRUD

- [ ] 3.1 Add focused main/preload tests for trusted sender checks, strict inputs, safe outputs and remote error propagation.
- [ ] 3.2 Add shared hotel-management IPC schemas, channels, main handlers and the preload `hotelManagement` namespace, keeping credential option queries in the common `otaCredential` namespace.
- [ ] 3.3 Replace renderer static imports with asynchronous snapshot loading, retry, empty and failure states while retaining the compact layout.
- [ ] 3.4 Add the RMS hotel creation dialog and refresh only after Gateway success.
- [ ] 3.5 Add confirmed RMS hotel deletion through `deleteHotel`, without desktop-side cascade or simulated success.
- [ ] 3.6 Add confirmed OTA binding deletion through `unbind(otaAccountId)`, preserving local credentials, partitions and hotel probes.

## 4. Existing credential selection for binding

- [ ] 4.1 Add focused component tests for reusing channel-scoped `OtaCredentialDto` data, no-credential guidance and selecting a credential for a specific RMS hotel.
- [ ] 4.2 Build the binding credential selector with the existing `otaCredential.listByChannel` IPC and `buildLoginCredentialOptions`, without sharing BrowserWorkspace tab state or displaying `partitionName`.
- [ ] 4.3 Add the hotel/channel binding entry dialog and submit only `hotelId/credentialId` to `startBinding`.

## 5. Binding intent and operation lifecycle

- [ ] 5.1 Add domain tests for the single active binding state transitions, second-start rejection, cancellation draining, candidate ownership, duplicate confirmation and idempotent submission.
- [ ] 5.2 Add `main/features/ota-intent.ts` with the extensible `OtaTabIntent` union; define `PROBE_OTA_HOTELS` with only `kind/resultCallbackKey` and reference the stable `otaHotelProbResultCallback` key from the event models.
- [ ] 5.3 Add `main/features/ota-event-models.ts` as the single source for `ProbedHotel`, pure Feature results, callback key constants and typed `OtaEventMap`; add `ota-tab-intent-bus.ts` as a transport-only `on/publish` implementation that type-imports the map but contains no concrete intent, callback-key, Probe or hotel-binding logic.
- [ ] 5.4 Add `HotelBindingFeature.start` to re-query and validate the hotel/credential, reject a second undrained flow, create the business operation, delegate the generic intent to `LoginTabOpener` without embedding `operationId` in the intent, and return only `{ operationId }` after the tab opens.
- [ ] 5.5 Add `LoginTabOpener.openExistingForIntent`, attach the login matcher and selected-credential callback, and carry the tab-bound intent through `BrowserManager` into `TabCredentialCheckedEvent` without changing ordinary browse behavior.

## 6. Probe candidates and user confirmation

- [ ] 6.1 Add focused `OtaHotelProbFeature` tests proving a no-intent checked event is a silent no-op (no probe, no `OtaHotelProb` write) while `PROBE_OTA_HOTELS` always re-probes and publishes one terminal result.
- [ ] 6.2 Refactor `OtaHotelProbFeature` to only act on `PROBE_OTA_HOTELS` intent, removing the implicit default-probe path; persist Probe results and publish typed success/empty/failure outcomes through `OtaTabIntentBus`, without depending on hotel-management or renderer IPC.
- [ ] 6.3 Subscribe `HotelBindingFeature` to `otaHotelProbResultCallback` and apply its pure Probe result only to the single active binding context, whose RMS hotel, credential and channel remain owned by hotel management.
- [ ] 6.4 Add validated main-to-renderer candidate/failure events and a single/multiple hotel selection-and-confirmation dialog.
- [ ] 6.5 Add cancellation handling for user cancel, corresponding tab close and renderer teardown before submission; keep the flow draining and block a new start until the old tab/probe can no longer publish.

## 7. Cookie export and remote bind

- [ ] 7.1 Add focused tests for channel-domain filtering, deterministic Cookie serialization, size rejection and redaction from logs/errors.
- [ ] 7.2 Extract the existing channel Cookie domain mapping into a shared main-process policy and implement a credential-partition Cookie snapshot exporter.
- [ ] 7.3 Implement `confirmBinding` validation and submit the confirmed hotel, OTA candidate, bindExtra and Cookie snapshot to `RmsOtaAccountGateway.bind` with the operation idempotency key.
- [ ] 7.4 Refresh the remote snapshot only after bind success; preserve local probe data and show an unbound failure state when export or Gateway submission fails.

## 8. Verification and quality gates

- [ ] 8.1 Run focused tests during implementation, including existing credential discovery and hotel probe regression tests.
- [ ] 8.2 Run the completion-scope desktop and shared-package type/Svelte checks and tests once, recording exact results in `verification.md`.
- [ ] 8.3 Perform a separate UI verification pass for load/error/CRUD, credential selection, candidate confirmation, cancellation and binding success/failure; record screenshot evidence in `verification.md`.
- [ ] 8.4 Perform a separate code-review pass for domain boundaries, IPC trust, Cookie privacy, intent isolation, idempotency, accessibility and regressions; record findings in `verification.md`.
