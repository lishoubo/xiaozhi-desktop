# Data and Dependencies

## Database Conventions

The application-owned SQLite database is managed by `src/main/database/application-database.ts` and is accessible only from the Electron main process. Versioned migrations establish schema and seed data transactionally. Feature repositories, currently `SqliteCalendarRepository`, are the only product-data query boundary; renderer access uses validated, feature-specific preload and IPC contracts. `better-sqlite3` access to browser Cookie databases remains a separate read-only import flow.

Renderer features depend on a domain data-source interface rather than SQLite or IPC details. A future server-backed implementation should replace that adapter while preserving the domain contract; do not introduce a generic renderer-facing data store.

- Treat the established schema, database client, repository, migration, and query conventions as canonical.
- Use one query style for equivalent operations; do not mix relational APIs, SQL-like builders, raw SQL, and ad hoc abstractions without a clear boundary.
- Use the established transaction and database access patterns.
- Prefer inferred schema types and established validators over duplicated handwritten model types.
- Keep schema changes and migrations aligned. Never edit already-applied migrations unless explicitly permitted.
- Use raw SQL only when the canonical Drizzle API cannot express the requirement clearly or efficiently. Isolate it, parameterize it, explain why it is needed, and test it.
- Test queries, constraints, transactions, and migration-sensitive behavior at the appropriate integration boundary.
- Add and follow a database validation sequence in `DEVELOPMENT_WORKFLOW.md`.

### Initial Data and Mock Data

Treat initial data and mock data as different product contracts:

- Initial data is required for correct product behavior in development, automated tests, and packaged production. Add or change it only through versioned database migrations. Examples include the default calendar groups and statutory-holiday data.
- Mock data exists only to demonstrate or test workflows. Keep it in an explicitly named mock module, use stable mock identifiers, and load it through an environment-aware orchestration option rather than a migration.
- Packaged production must default to excluding mock data. Development and end-to-end environments may opt in explicitly. When a database previously used with mock data is opened with mock data disabled, remove only records owned by the stable mock identifiers so they cannot leak into production.
- Unit and component fixtures remain test-local and must not be imported by production code. Production initialization modules must not import mock modules unless the environment-aware orchestration boundary explicitly requests them.
- Prefer one small boolean or equivalent environment decision at the application composition boundary. Do not spread environment checks across repositories, domain logic, or renderer components.

## Dependency and Version Compatibility

Before adding or upgrading a package:

1. Confirm existing platform capabilities and dependencies cannot reasonably solve the problem.
2. Treat `package.json` and `package-lock.json` as the source of truth for installed versions.
3. Check compatibility with the current Electron, Node.js, Chromium, Svelte, Tailwind CSS, shadcn-svelte, TypeScript, module resolution, bundler, packager, test runner, and lint tooling.
4. Check peer dependencies, `engines`, ESM/CJS exports, supported operating systems, and CPU architectures.
5. Consult official documentation, release notes, and package metadata for the exact candidate version. Do not select versions from memory.
6. Prefer a stable compatible version without triggering unrelated framework or toolchain upgrades.
7. Put build-only and test-only packages in `devDependencies`; put runtime packages in `dependencies`.
8. Install through npm and let it update the lockfile. Never edit the lockfile manually.
9. Assess maintenance status, security, license, bundle size, and tree-shaking impact.
10. Explain the dependency's purpose and compatibility basis in the final handoff.

For native modules, additionally verify the Electron ABI, rebuild/packager configuration, prebuilt binaries for supported platforms and architectures, and behavior in development, tests, packaged builds, and installed applications.
