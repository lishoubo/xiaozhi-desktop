## 1. Model and behavior tests

- [x] 1.1 Add focused unit tests for OTA status presentation, action selection, and unknown-status fallback.
- [x] 1.2 Add a focused hotel management component test covering hotel rows, account details, status-aware actions, empty account state, and mock operation feedback.
- [x] 1.3 Extend the routing component test to cover the authenticated “酒店管理” navigation entry and route.

## 2. Hotel management implementation

- [x] 2.1 Add the renderer-safe managed hotel and bound OTA account display model, status formatter, and representative mock data without credentials.
- [x] 2.2 Build the bound OTA account card and hotel management page using the existing design system and responsive list/card layout.
- [x] 2.3 Wire the hotel management route and left navigation entry without changing existing route behavior.

## 3. Verification and quality gates

- [x] 3.1 Run focused unit/component tests during implementation and resolve failures.
- [ ] 3.2 Run type/Svelte checks and the completion-scope test suite once, recording exact results.
- [ ] 3.3 Perform a separate UI verification pass with screenshot evidence and record findings in `verification.md`.
- [ ] 3.4 Perform a separate code-review pass for scope, architecture, privacy, accessibility, and regressions; record findings in `verification.md`.

## 4. Compact list revision

- [x] 4.1 Update the component test to require one compact row per hotel, compact OTA modules, and on-demand account details.
- [x] 4.2 Replace the large hotel/account card layout with a single-line table layout and overflow-safe OTA account modules.
- [x] 4.3 Run focused component and routing verification for the compact revision.

## 5. Server model alignment revision

- [x] 5.1 Add focused tests for direct server-field mapping and safe `bindExtra` presentation.
- [x] 5.2 Remove client-only `extraFields` and `lastRefreshedAt`, then align mock accounts with the server `OtaAccount` non-credential fields.
- [x] 5.3 Update the compact account detail component to derive channel metadata and displayed time from aligned fields.
- [x] 5.4 Run focused model and component verification for the alignment revision.
