# Workspace architecture

## Repository layout

- The repository uses npm workspaces with deployable applications in `apps/*` and reusable packages in `packages/*`.
- `apps/desktop` owns Electron main, preload, renderer, browser automation, and local SQLite persistence.
- `apps/server` owns the SvelteKit SSR server, authentication, remote persistence, and server API endpoint.
- `packages/api` owns the type-safe tRPC router contract shared by server and desktop.
- The root `package-lock.json` is the only npm lockfile.

## Trust and data boundaries

- Desktop-to-server communication uses tRPC over `/api/trpc`.
- The desktop tRPC client runs in Electron main; renderer code accesses trusted capabilities only through preload/IPC.
- Desktop-local browser sessions, cookies, automation state, and local SQLite data are not implicitly synchronized to the server.
- Server persistence implementations are not imported by desktop or the shared API package.
