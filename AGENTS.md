# AGENTS.md

This file defines the default working agreement for every developer and automated agent in this repository. Follow it unless a task or a more specific nested `AGENTS.md` explicitly says otherwise.

## Instruction Priority

Use the following order when instructions overlap:

1. The user's explicit requirements for the current task.
2. The nearest applicable `AGENTS.md`.
3. `DESIGN.md` for visual design, layout, styling, interaction, iconography, and UI component decisions.
4. Existing project conventions and tool configuration.

Read `DESIGN.md` before making any UI-facing change. Treat it as the source of truth for the product's visual language and interaction principles. Do not introduce a conflicting local design pattern.

## Core Engineering Principles

- Develop and iterate with test-driven development (TDD).
- Optimize for correctness, maintainability, testability, security, and readability.
- Prefer simple, explicit code over clever code or speculative abstractions.
- Keep changes small, focused, and consistent with the existing architecture.
- Preserve existing behavior unless the requested change intentionally modifies it.
- Do not reformat, rename, refactor, or upgrade unrelated code.

## Before Making Changes

1. Read the root `package.json`, the active lockfile, relevant configuration files, related source code, and existing tests.
2. Check for a more specific `AGENTS.md` in the target directory.
3. For UI work, read `DESIGN.md` before designing or implementing anything.
4. Identify whether the code runs in the Electron main process, preload, renderer, or a shared environment.
5. Identify the repository's existing canonical style for every third-party library touched by the task.
6. Use npm. This project requires Node.js `>=24 <25` and npm `>=11`.
   - Keep `package-lock.json` as the only lockfile.
   - Never use pnpm or Yarn in this repository.
   - Do not create another lockfile or manually edit `package-lock.json`.
7. Use existing `package.json` scripts for testing, linting, type checking, formatting, building, and packaging. Inspect the scripts instead of guessing their names.

## Mandatory TDD Workflow

All observable behavior changes must follow Red → Green → Refactor.

### Red

- Write or update a test that precisely describes the required behavior before changing production code.
- Run the smallest relevant test and confirm that it fails for the expected behavioral reason.
- For a bug fix, first add a regression test that reliably reproduces the defect.
- A test that fails because of syntax, setup, or an incorrect assertion does not satisfy the Red phase.

### Green

- Implement only the minimum production change needed to make the failing test pass.
- Do not add speculative extension points, unrelated cleanup, or unrequested behavior.
- Run the focused test again and confirm that it passes.

### Refactor

- Improve names, structure, duplication, and boundaries while keeping tests green.
- Refactoring must not silently change behavior.
- If behavior must change during refactoring, return to the Red phase first.

When test-first development is objectively impractical, such as a purely visual adjustment or some operating-system integration:

- state why an automated test cannot reasonably lead the change;
- extract and test all separable logic;
- provide deterministic manual verification steps;
- do not use the small size of a change as a reason to skip validation.

## Project Command Workflow

The commands in this section are the canonical development, testing, preview, and packaging workflow for this repository. Run them from the repository root.

### 1. Prepare the Environment

Confirm the required runtime before installing dependencies:

```bash
node --version
npm --version
npm ci
```

- Node.js must satisfy `>=24 <25`.
- npm must satisfy `>=11`.
- Use `npm ci` for a clean, lockfile-faithful installation.
- Use `npm install` only when intentionally adding, removing, or updating a dependency.

### 2. Red: Write a Failing Test

Choose the smallest test layer that can describe the required behavior.

For main-process, preload, database, service, or other non-UI logic:

```bash
npm run test:unit:watch -- path/to/example.test.ts
```

For Svelte component behavior:

```bash
npm run test:component:watch -- path/to/example.test.ts
```

For a one-time focused run instead of watch mode:

```bash
npm run test:unit -- path/to/example.test.ts
npm run test:component -- path/to/example.test.ts
```

For an end-to-end-only behavior:

```bash
npm run test:e2e -- path/to/example.spec.ts
```

Before changing production code, observe the new test fail for the intended behavioral reason. Do not proceed from a test that already passes or fails because of broken setup.

### 3. Green: Implement the Minimum Change

Keep the relevant Vitest watch command running while implementing. After the focused test passes, run the complete suite for that test layer:

```bash
npm run test:unit
npm run test:component
```

Running both layers together:

```bash
npm test
```

`npm test` is the standard fast regression gate. It runs unit tests followed by component tests, but it does not run Playwright E2E tests.

### 4. Refactor with Fast Feedback

After the behavior is green, refactor while repeatedly running the focused test. Then run:

```bash
npm test
npm run check
npm run lint
npm run format:check
```

The commands have distinct responsibilities:

- `npm test`: Vitest unit and component regression suites.
- `npm run check`: TypeScript checks followed by Svelte checks.
- `npm run check:types`: Node/main-process TypeScript check only.
- `npm run check:svelte`: Svelte renderer check only.
- `npm run lint`: ESLint for TypeScript-family source files.
- `npm run format:check`: verifies Prettier formatting without modifying files.
- `npm run format`: rewrites files with Prettier; run it intentionally, then review the diff and repeat `npm run format:check`.

Use the narrower `check:types` or `check:svelte` command during iteration when appropriate, but the full `npm run check` is required before completion.

### 5. Validate Database Changes

For any Drizzle schema, relation, migration, or database configuration change:

```bash
npm run db:generate
npm run db:check
npm run test:unit
```

- `npm run db:generate` creates migration artifacts from intentional schema changes. Review every generated file.
- `npm run db:check` validates migration consistency.
- Do not generate a migration when no schema change is intended.
- `npm run db:studio` starts the interactive Drizzle Studio and is for local inspection only; it is not a validation gate:

```bash
npm run db:studio
```

### 6. Run the Complete Automated Test Gate

Run all unit, component, and Playwright E2E tests:

```bash
npm run test:all
```

This is the canonical full regression command. It runs:

1. `npm test`;
2. `npm run build:e2e`;
3. `playwright test`.

Run coverage when changing critical business logic, IPC contracts, database behavior, or when coverage evidence is requested:

```bash
npm run test:coverage
```

Coverage is diagnostic evidence, not a replacement for meaningful assertions.

### 7. Run and Preview the Electron Application

Start Electron Forge in development mode for the normal local run and live preview:

```bash
npm start
```

This repository has no separate browser preview script. `npm start` is the canonical interactive development preview.

After automated checks pass, manually smoke-test the affected workflow in the running Electron application. Verify the success path, failure state, reload/relaunch behavior when relevant, and the absence of renderer or main-process console errors.

### 8. Validate the Packaged Application

Build an unpacked Electron application:

```bash
npm run package
```

Use the generated package for a production-like smoke test, especially after changes to Electron Forge, Vite, preload, IPC, native modules, filesystem behavior, application startup, or packaging configuration.

Create platform distributables only after tests and packaging checks pass:

```bash
npm run make
```

`npm run make` is a release-artifact check, not the normal development loop. Verify the artifact appropriate to the current operating system.

Do not run the following command as part of routine validation:

```bash
npm run publish
```

Publishing changes external state and requires an explicit release request, configured credentials, a confirmed target/version, and user approval.

### 9. Required Pre-Handoff Sequence

For a normal code change:

```bash
npm run check
npm run lint
npm run format:check
npm run test:all
```

For an Electron integration, dependency, native module, build, or release-sensitive change:

```bash
npm run check
npm run lint
npm run format:check
npm run test:all
npm run package
```

Add `npm run db:check` for database-related changes. Add `npm run make` only when distributable generation is relevant to the task.

## Testing Standards

- Prefer the testing pyramid: many unit tests, focused integration tests, and a small number of critical end-to-end tests.
- Test behavior and public contracts rather than private implementation details.
- Cover success paths, boundaries, invalid input, failures, and security-sensitive cases.
- Keep tests independent, deterministic, and fast.
- Do not depend on test order, real network services, wall-clock timing, random data, developer-machine state, or data left by another test.
- Mock time, randomness, filesystem access, network access, and Electron APIs only at clear boundaries. Restore mocks, timers, and global state after each test.
- Avoid excessive mocking and snapshots that reviewers cannot meaningfully inspect.
- Never weaken assertions, skip tests, or hide errors merely to obtain a passing suite.
- Apply the same type-safety and readability standards to test code as production code.

## UI System: Tailwind CSS and shadcn-svelte

Tailwind CSS and shadcn-svelte are the required default UI tools for this project.

- Follow `DESIGN.md` first for visual and interaction decisions.
- Use Tailwind CSS utilities for styling. Reuse the project's theme tokens, CSS variables, spacing scale, colors, typography, breakpoints, and state conventions.
- Prefer existing shared classes, variants, and design tokens over arbitrary values.
- Avoid inline styles, component-scoped one-off CSS, new CSS frameworks, CSS-in-JS, and parallel styling systems unless a concrete limitation is documented.
- When custom CSS is genuinely necessary, keep it minimal, token-driven, and consistent with `DESIGN.md`.
- Search the repository for an existing shadcn-svelte component before adding or building one.
- Prefer shadcn-svelte primitives and composition over custom reimplementations of standard UI controls.
- Preserve the project's existing shadcn-svelte variants and component APIs instead of creating visually equivalent alternatives.

### Installing shadcn-svelte Components

New shadcn-svelte components must be added with the official shadcn-svelte CLI command that matches the version and package manager already used by this repository.

- Inspect the current shadcn-svelte configuration and installed version before running the command.
- Use the official CLI's `add` workflow through the project's package manager.
- Do not manually copy component source from documentation, another repository, an AI response, or a package distribution.
- Do not manually recreate a component that the official CLI can install.
- Review the files generated by the CLI and keep project-specific edits minimal and intentional.
- Never run broad initialization again if the repository is already initialized.
- Do not use an unpinned or incompatible CLI version merely because it is the latest.
- Include generated component files, configuration changes, and lockfile changes in the same reviewed change.

If the official CLI cannot install a required component, document the exact limitation before implementing the smallest compatible local alternative.

## Product Design Restraint

Apply the product principles in `DESIGN.md` whenever implementing a feature in the renderer.

- Implement the requested user outcome without inventing adjacent product features, extra sections, onboarding, promotional content, or speculative controls.
- Choose the simplest layout that fits existing nearby screens and components.
- Do not add explanatory copy just to fill space or narrate an interface that can be made self-explanatory through hierarchy, spacing, labels, and familiar controls.
- Keep copy concise and purposeful. Preserve text required for ambiguity reduction, validation, error recovery, destructive actions, security, and accessibility.
- Prefer progressive disclosure for secondary actions and advanced options.
- Do not over-design a component when a standard shadcn-svelte primitive and a small amount of Tailwind composition solve the requirement.
- If the user's behavioral requirement leaves the layout open, make the smallest reasonable design decision. Do not expand the task based on imagined product requirements.

## Icon System

`@lucide/svelte` is the only default icon library for the product UI.

- Search for and reuse an appropriate Lucide icon before considering any custom asset.
- Import Lucide icons individually and follow the size, stroke, alignment, color, state, and accessibility rules in `DESIGN.md`.
- Do not introduce another icon package, emoji, Unicode symbols, copied SVG markup, or hand-drawn SVG icons for normal interface controls.
- Do not add icons decoratively or attach one to every label by default.
- Use icon-only controls only when the action is conventional and unambiguous in context. Provide an accessible name and any tooltip required by `DESIGN.md`.
- If Lucide cannot represent a necessary concept, document the exception and follow an existing project asset convention instead of silently creating a second icon system.

## Third-Party Library Consistency

Each third-party library must have one canonical usage style within this repository. A library supporting several equivalent APIs is not permission to mix them.

Before writing new code with a library:

1. Search existing production code and tests for its current usage.
2. Identify the dominant, modern, type-safe pattern compatible with the installed version.
3. Follow that pattern for imports, initialization, configuration, queries, error handling, return types, and tests.
4. Reuse or extend the existing adapter, wrapper, client, schema, or utility rather than initializing the library in multiple places.
5. If no convention exists, choose one pattern based on official documentation and the installed version, use it consistently, and document the decision near the appropriate shared boundary.

Do not mix:

- default, namespace, and named import styles for the same purpose;
- callback, promise, and async/await styles within the same abstraction;
- multiple client initialization or configuration patterns;
- raw library access and repository wrappers without a documented boundary;
- several query construction styles for equivalent operations;
- different error normalization or result-shaping conventions.

When improving an existing convention, migrate the affected boundary coherently. Do not leave old and new styles mixed within the same feature. Avoid repository-wide migrations unless the task explicitly requires one.

### Drizzle ORM

Use the name **Drizzle ORM** in documentation and comments.

- Treat the existing schema, database client, repository, migration, and query conventions as canonical.
- Use one query style for equivalent operations. Follow the dominant existing style instead of mixing relational query APIs, SQL-like query builders, raw SQL, and ad hoc abstractions.
- Use the project's established transaction pattern and database access boundary.
- Prefer inferred schema types and established validators over duplicated handwritten model types.
- Keep schema changes and migrations aligned; never edit already-applied migrations unless the project explicitly permits it.
- Use raw SQL only when the canonical Drizzle API cannot express the requirement clearly or efficiently. Isolate it, parameterize it, explain why it is needed, and test it.
- Test queries, constraints, transactions, and migration-sensitive behavior at the appropriate integration boundary.

These consistency rules also apply to state management, validation, routing, date handling, logging, HTTP clients, and every other third-party library.

## Dependency and Version Compatibility

Before adding or upgrading any package:

1. Confirm that the existing platform or dependencies cannot reasonably solve the problem.
2. Treat `package.json` and the lockfile as the source of truth for actual versions.
3. Check compatibility with:
   - the current Electron, Node.js, and Chromium versions;
   - Svelte, Tailwind CSS, and shadcn-svelte;
   - TypeScript and the project's module resolution;
   - the current bundler, packager, test runner, and lint tools;
   - the package's peer dependencies, `engines`, and ESM/CJS exports;
   - supported operating systems and CPU architectures.
4. Consult official documentation, release notes, and peer-dependency declarations for the exact candidate version. Do not select a version from memory.
5. Prefer a stable version compatible with the current dependency graph. Do not trigger unrelated framework or toolchain upgrades.
6. Put build-only and test-only packages in `devDependencies`; put runtime packages in `dependencies`.
7. Install through the repository's package manager and let it update the lockfile. Never edit the lockfile manually.
8. Assess maintenance status, security, license, bundle size, and tree-shaking impact.
9. Explain the purpose of the dependency and the basis for version compatibility in the final handoff.

Native modules require additional verification:

- compatibility with the current Electron ABI;
- whether Electron rebuild or packager configuration is required;
- prebuilt binaries for every supported operating system and architecture;
- behavior in development, tests, packaged builds, and installed applications.

## Electron Architecture and Security

- Keep window lifecycle, native capabilities, trusted backend logic, and system resources in the main process.
- Treat the renderer as an untrusted web environment.
- Expose the smallest explicit and versionable preload API through `contextBridge`.
- Keep `contextIsolation` enabled and `nodeIntegration` disabled. Do not weaken Electron security settings for convenience.
- Centralize and type IPC channels, requests, responses, and errors.
- Validate all renderer-originated input at runtime in the trusted process.
- Do not expose arbitrary filesystem access, command execution, dynamic module loading, unrestricted object access, or secrets through IPC.
- Validate external URLs, paths, navigation, window creation, and custom protocol input. Reject unknown origins by default.
- Clean up windows, listeners, shortcuts, timers, subscriptions, and IPC handlers at the correct lifecycle boundary.
- Never commit, log, or expose credentials, tokens, personal data, or sensitive local paths.

## Design and Code Style

- Follow the repository's ESLint, Prettier, TypeScript, and EditorConfig settings.
- Prefer strict TypeScript. Avoid `any`, non-null assertions, and type assertions; constrain and explain unavoidable exceptions.
- Keep business logic independent from Electron, Svelte UI, and I/O where practical.
- Isolate side effects and make dependencies explicit.
- Prefer composition, focused modules, early returns, and descriptive names.
- Avoid circular dependencies, cross-layer access, hidden global state, and generic “utility” dumping grounds.
- Abstract only after a stable repeated concept exists.
- Handle errors at a layer with enough context, or preserve their cause when propagating them. Never silently swallow errors.
- Comments explain intent, constraints, or tradeoffs, not what the code already says.
- Delete obsolete code instead of leaving commented-out implementations.
- Follow neighboring file naming, exports, import ordering, component structure, and testing style.
- Favor readability over terse one-liners.

## Renderer and Interaction Quality

- Keep components focused and extract complex business rules and effects into testable modules.
- Explicitly handle loading, empty, success, disabled, and error states.
- Preserve keyboard access, focus behavior, semantic elements, labels, and required accessibility attributes.
- Handle asynchronous cancellation, races, and component teardown.
- Avoid blocking the renderer or Electron main process with expensive synchronous work.
- Cover important interactions with behavior-focused tests.

## Validation

Follow the exact command progression in [Project Command Workflow](#project-command-workflow), from a focused failing test through the required pre-handoff sequence.

- `npm run test:all` is the required full automated regression gate.
- `npm run package` is additionally required for Electron integration, dependency, native module, build, or release-sensitive changes.
- `npm run db:check` is additionally required for database-related changes.
- `npm run make` is required only when the task affects or requests distributable artifacts.
- `npm run publish` must never be treated as validation and must not run without an explicit release request and approval.
- Perform a focused desktop smoke test for critical user flows when the environment supports it.

Never claim that a command passed unless it was actually run. If the environment prevents a check, report the unexecuted check, the reason, and the resulting risk.

## Definition of Done

A task is complete only when:

- the target behavior was test-driven and is covered by meaningful tests;
- relevant tests, type checks, and lint checks pass;
- UI changes follow `DESIGN.md` and use Tailwind CSS and shadcn-svelte appropriately;
- product UI remains concise and task-focused without speculative features or unnecessary explanatory copy;
- interface icons use `@lucide/svelte` consistently unless a documented exception is necessary;
- new shadcn-svelte components were installed through the official compatible CLI;
- third-party library usage follows one canonical project style;
- Electron architecture and security boundaries remain intact;
- dependency compatibility has been verified against the current stack and target platforms;
- public contracts, types, migrations, and documentation match the implementation;
- the diff is focused, readable, and free of unrelated changes;
- the final handoff states what changed, what was tested, what commands ran, and any remaining limitations.
