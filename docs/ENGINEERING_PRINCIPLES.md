# Engineering Principles

## Scope

These rules apply to production code, tests, scripts, and configuration. Internal architecture and logic should be implementation-aware: optimize for correctness, maintainability, testability, security, performance, and clear operational boundaries. This engineering perspective must not leak into product UI structure or user-facing copy.

## Core Principles

- Prefer simple, explicit code over clever code or speculative abstractions.
- Keep changes small, focused, and consistent with the existing architecture.
- Preserve existing behavior unless the requested change intentionally modifies it.
- Do not reformat, rename, refactor, or upgrade unrelated code.
- Keep business logic independent from Electron, Svelte UI, and I/O where practical.
- Isolate side effects and make dependencies explicit.
- Prefer composition, focused modules, early returns, and descriptive names.
- Avoid circular dependencies, cross-layer access, hidden global state, and generic utility dumping grounds.
- Abstract only after a stable repeated concept exists.
- Handle errors at a layer with enough context, or preserve their cause when propagating them. Never silently swallow errors.
- Comments explain intent, constraints, or tradeoffs, not what the code already says.
- Delete obsolete code instead of leaving commented-out implementations.
- Follow neighboring file naming, exports, import ordering, component structure, and testing style.
- Favor readability over terse one-liners.

## TypeScript and Formatting

- Follow the repository's ESLint, Prettier, TypeScript, and EditorConfig settings.
- Prefer strict TypeScript. Avoid `any`, non-null assertions, and type assertions; constrain and explain unavoidable exceptions.
- Keep public contracts explicit and aligned across main, preload, shared, and renderer code.

## Third-Party Library Consistency

Each third-party library has one canonical usage style in this repository. Before using a library:

1. Search production code and tests for current usage.
2. Identify the dominant, modern, type-safe pattern compatible with the installed version.
3. Follow that pattern for imports, initialization, configuration, queries, error handling, return types, and tests.
4. Reuse or extend the existing adapter, wrapper, client, schema, or utility instead of initializing the library at multiple boundaries.
5. If no convention exists, choose one pattern from official documentation for the installed version and document the decision at the shared boundary.

Do not mix equivalent default, namespace, and named import styles; callback, promise, and async/await styles; client initialization patterns; query construction styles; or error-normalization conventions within the same feature boundary. Improve a convention coherently within the affected boundary, not through an unrequested repository-wide migration.

These consistency rules apply to logging, state management, validation, routing, date handling, HTTP clients, data access, and every other third-party library.
