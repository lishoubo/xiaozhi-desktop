# Design: npm workspace boundaries

## Layout

```text
apps/
  desktop/       Electron main, preload, renderer, local SQLite and browser state
  server/        SvelteKit SSR server, authentication, remote database and tRPC endpoint
packages/
  api/           tRPC router type, input/output schemas and transport-safe procedures
```

The root package is private and orchestration-only. npm workspaces own dependency installation and the root `package-lock.json` is the only lockfile.

## Communication boundary

`packages/api` owns the tRPC `AppRouter` type and transport validation. `apps/server` mounts that router at `/api/trpc`. `apps/desktop` imports `AppRouter` as a type and creates the tRPC client in Electron main. The renderer continues to use the explicit preload API, so it cannot bypass Electron's trust boundary.

The initial router contains a deterministic health query that proves the connection without assigning local desktop data to the server. Future remote user-data procedures belong in the shared router package and may receive server-owned dependencies through typed context.

## Data ownership

- Desktop local: browser sessions, cookies, automation state, local application SQLite data.
- Server remote: user identity and future centrally managed user data.
- Shared: transport schemas and type-only router contract, not persistence implementations.

## Tooling

Each workspace retains package-specific build and test configuration. Root scripts delegate with `npm run ... --workspace ...` and aggregate checks with `--workspaces --if-present`. Electron Forge runs from `apps/desktop`, with native modules resolved from the workspace installation.
