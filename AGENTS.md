# AGENTS.md

This file is the repository-wide instruction entry point for developers and automated agents. Follow it unless the current task or a more specific nested `AGENTS.md` says otherwise.

## Instruction Priority

When instructions overlap, apply them in this order:

1. The user's explicit requirements for the current task.
2. The nearest applicable `AGENTS.md`.
3. The documents linked below, according to their stated scope.
4. Existing project conventions and tool configuration.

For product-facing UI decisions, `DESIGN.md` defines the visual language and `docs/PRODUCT_UX_PRINCIPLES.md` defines product behavior, information architecture, and interaction density. If they appear to conflict, preserve the visual system from `DESIGN.md` while choosing the flow that best supports the user's task.

## Required Reading

Before changing code, read the documents relevant to the task:

- Every code change: [`docs/ENGINEERING_PRINCIPLES.md`](docs/ENGINEERING_PRINCIPLES.md), [`docs/TESTING_STANDARDS.md`](docs/TESTING_STANDARDS.md), and [`docs/DEVELOPMENT_WORKFLOW.md`](docs/DEVELOPMENT_WORKFLOW.md).
- Any logging addition or changed operational flow: [`docs/LOGGING_GUIDELINES.md`](docs/LOGGING_GUIDELINES.md).
- Any renderer, UI, interaction, copy, navigation, or information-architecture change: `DESIGN.md`, [`docs/UI_ENGINEERING.md`](docs/UI_ENGINEERING.md), and [`docs/PRODUCT_UX_PRINCIPLES.md`](docs/PRODUCT_UX_PRINCIPLES.md).
- Any Electron main/preload/IPC/native-capability change: [`docs/ELECTRON_SECURITY.md`](docs/ELECTRON_SECURITY.md).
- Any database, Drizzle ORM, package, or version change: [`docs/DATA_AND_DEPENDENCIES.md`](docs/DATA_AND_DEPENDENCIES.md).

Read each selected document completely before implementation. Check for a more specific `AGENTS.md` in the target directory.

## Non-Negotiable Repository Rules

- Use test-driven development for observable behavior: Red → Green → Refactor.
- Use npm only, with Node.js `>=24 <25` and npm `>=11`; keep `package-lock.json` as the only lockfile.
- Do not make unrelated refactors, formatting changes, renames, dependency upgrades, or product additions.
- Product UI and UX must be designed from the user's task and decision needs, not from the implementation or data model. Internal logic must still be designed from an engineering perspective for correctness, maintainability, security, and testability.
- Add concise logs at meaningful operational boundaries and failures. Do not log credentials, tokens, Cookie contents, personal data, sensitive local paths, or high-frequency implementation details.
- Keep Electron security boundaries intact: isolated renderer, minimal preload API, runtime validation in the trusted process, and deny-by-default handling of external input.
- Never run `npm run publish` without an explicit release request, confirmed release details, credentials, and user approval.

## Completion

A change is complete only after the applicable definition of done and validation sequence in the linked documents has been satisfied. The handoff must state what changed, which checks actually ran, and any remaining limitations.
