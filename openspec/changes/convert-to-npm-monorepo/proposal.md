# Proposal: Convert to an npm monorepo

## Why

The repository currently combines a root Electron desktop package with a separately installed SvelteKit server package. This duplicates lockfiles and tooling boundaries and provides no stable place for the type-safe tRPC contract used by both applications.

## Outcome

- Use one root npm workspace and one root lockfile.
- Place the Electron application in `apps/desktop` and keep the SvelteKit application in `apps/server`.
- Add a shared `packages/api` package for the tRPC router contract.
- Connect Electron main to the server through tRPC while keeping local-only data behind the existing Electron main/preload boundary.
- Preserve current desktop and server behavior; the server administration UI is out of scope.

## Success criteria

- A root install resolves every workspace without nested lockfiles.
- Root scripts can check, test, build, and package individual applications.
- The server exposes the shared tRPC router through a SvelteKit endpoint.
- The desktop has a typed tRPC client in the main process and does not expose direct network access to the renderer.
- Existing desktop and server checks continue to pass.
