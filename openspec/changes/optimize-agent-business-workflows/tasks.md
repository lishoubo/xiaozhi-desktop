# Tasks

## 1. Specification and tests

- [x] 1.1 Define the deterministic/Agent collection split, MCP compatibility hierarchy, model
  boundary and privacy-safe phase logging.
- [x] 1.2 Add focused tests for structured, JSON, content-block and unstructured evidence parsing.
- [x] 1.3 Add focused tests for dedicated tool selection, schema-compatible arguments, generic and
  incompatible fallback, and no fallback after an invoked tool fails.

## 2. Implementation

- [x] 2.1 Add a deterministic workflow collector that reuses `McpToolProvider` tools and existing
  read-only/tool-budget guards.
- [x] 2.2 Route compatible dedicated intents through the collector while retaining constrained Agent
  collection for generic and incompatible workflows.
- [x] 2.3 Refactor evidence normalization to record parse quality and safely handle MCP/LangChain
  content representations.
- [x] 2.4 Add phase-duration logs without prompts, arguments, evidence, result text or UI payloads.

## 3. Verification and convergence

- [x] 3.1 Run directly affected unit tests during implementation and Svelte checks only if renderer
  files change.
- [x] 3.2 Run one completion-state monorepo verification, strict OpenSpec validation and
  `git diff --check`; record exact evidence in `verification.md`.
- [x] 3.3 Perform separate verification and code-review passes, then synchronize the affected stable
  capability specs.
- [x] 3.4 Update the existing Agent architecture documentation with the implemented end-to-end call
  chain and remove any superseded diagram rather than retaining parallel final descriptions.
