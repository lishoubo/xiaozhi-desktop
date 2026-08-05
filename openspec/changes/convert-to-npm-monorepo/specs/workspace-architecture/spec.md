# Workspace architecture delta

## Added requirements

- The repository SHALL use npm workspaces with a single root lockfile.
- Deployable applications SHALL live under `apps/`; reusable cross-application code SHALL live under `packages/`.
- Desktop-to-server calls SHALL use the shared tRPC router contract.
- The tRPC desktop client SHALL run in Electron main, not in the renderer.
- Desktop-local persistence SHALL remain independent from server-owned persistence.
