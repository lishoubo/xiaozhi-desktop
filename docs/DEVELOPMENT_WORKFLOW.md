# Development Workflow

Run commands from the repository root and inspect `package.json` rather than guessing script names.

## Before Making Changes

1. Read the root `package.json`, active lockfile, relevant configuration, source, and existing tests.
2. Check for a more specific `AGENTS.md` in the target directory.
3. Read every task-relevant document listed by the root `AGENTS.md`.
4. Identify whether the code runs in Electron main, preload, renderer, or a shared environment.
5. Identify the canonical local usage style for every third-party library touched.
6. Confirm Node.js `>=24 <25` and npm `>=11`.

Use npm only. Keep `package-lock.json` as the sole lockfile. Never use pnpm or Yarn, create another lockfile, or manually edit `package-lock.json`. Use `npm ci` for a clean lockfile-faithful install and `npm install` only when intentionally changing dependencies.

## Focused TDD Loop

Choose the smallest layer that describes the behavior:

```bash
npm run test:unit:watch -- path/to/example.test.ts
npm run test:component:watch -- path/to/example.test.ts
```

For one-time focused runs:

```bash
npm run test:unit -- path/to/example.test.ts
npm run test:component -- path/to/example.test.ts
npm run test:e2e -- path/to/example.spec.ts
```

Observe the expected behavioral failure before production changes. After Green, run the complete affected layer:

```bash
npm run test:unit
npm run test:component
```

`npm test` runs the unit and component suites, but not Playwright E2E tests.

## Static and Regression Checks

During refactoring and before handoff, use the existing commands:

```bash
npm test
npm run check
npm run lint
npm run format:check
```

- `npm run check` runs Node/main TypeScript checks and Svelte checks.
- `npm run check:types` and `npm run check:svelte` are narrower iteration checks.
- `npm run lint` runs ESLint for TypeScript-family files.
- `npm run format:check` checks Prettier without modifying files.
- `npm run format` intentionally rewrites formatting; review its diff and rerun `format:check`.

The complete automated regression gate is:

```bash
npm run test:all
```

It runs unit tests, component tests, the E2E build, and Playwright. Use `npm run test:coverage` for critical business logic, IPC contracts, database behavior, or requested coverage evidence. Coverage does not replace meaningful assertions.

## Database Validation

The application currently has no application-owned persistence database; `better-sqlite3` is used only to read browser Cookie databases during an explicit import. If product persistence is introduced, add explicit npm scripts for schema generation and migration validation with the database implementation, then document and run them as part of the required workflow. Review every generated migration artifact and never edit an already-applied migration unless the project explicitly permits it.

## Interactive and Packaged Validation

Use `npm start` for the Electron development run; there is no separate browser preview. After automated checks, smoke-test the affected workflow, its failure state, relevant reload/relaunch behavior, and the absence of renderer or main-process console errors.

Run `npm run package` for Electron integration, dependency, native-module, preload, IPC, startup, build, filesystem, or packaging-sensitive changes. Smoke-test the unpacked application when the environment supports it.

Run `npm run make` only when the task affects or requests distributable artifacts. Never use `npm run publish` as validation; publishing requires an explicit release request, configured credentials, a confirmed target/version, and user approval.

## Required Pre-Handoff Sequence

Normal code change:

```bash
npm run check
npm run lint
npm run format:check
npm run test:all
```

Electron integration, dependency, native module, build, or release-sensitive change:

```bash
npm run check
npm run lint
npm run format:check
npm run test:all
npm run package
```

Add the repository's database validation command when a database layer exists, and run `npm run make` only when distributable generation is relevant.

Never claim a command passed unless it actually ran. If the environment prevents a check, report the unexecuted check, the reason, and the resulting risk.

## Definition of Done

A task is complete only when:

- target behavior was test-driven and covered by meaningful tests;
- relevant tests, type checks, lint, and formatting checks pass;
- applicable product UX, UI system, logging, security, data, and dependency rules are satisfied;
- public contracts, types, migrations, and documentation match the implementation;
- the diff is focused, readable, and free of unrelated changes;
- the final handoff states what changed, what was tested, which commands ran, and any remaining limitations.
