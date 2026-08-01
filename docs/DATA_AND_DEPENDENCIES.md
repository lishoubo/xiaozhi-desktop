# Data and Dependencies

## Drizzle ORM

Use the name **Drizzle ORM** in documentation and comments.

- Treat existing schema, database client, repository, migration, and query conventions as canonical.
- Use one query style for equivalent operations; do not mix relational APIs, SQL-like builders, raw SQL, and ad hoc abstractions without a clear boundary.
- Use the established transaction and database access patterns.
- Prefer inferred schema types and established validators over duplicated handwritten model types.
- Keep schema changes and migrations aligned. Never edit already-applied migrations unless explicitly permitted.
- Use raw SQL only when the canonical Drizzle API cannot express the requirement clearly or efficiently. Isolate it, parameterize it, explain why it is needed, and test it.
- Test queries, constraints, transactions, and migration-sensitive behavior at the appropriate integration boundary.
- Follow the database validation sequence in `DEVELOPMENT_WORKFLOW.md`.

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
