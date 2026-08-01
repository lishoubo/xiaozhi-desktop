# Electron Architecture and Security

- Keep window lifecycle, native capabilities, trusted backend logic, database access, and system resources in the main process.
- Treat the renderer as an untrusted web environment.
- Expose the smallest explicit, typed, and versionable preload API through `contextBridge`.
- Keep `contextIsolation` enabled, `nodeIntegration` disabled, and the renderer sandbox enabled. Do not weaken security settings for convenience.
- Centralize and type IPC channels, requests, responses, and errors.
- Validate all renderer-originated input at runtime in the trusted process, including calls originating from typed preload APIs.
- Verify IPC senders and reject unknown senders by default.
- Do not expose arbitrary filesystem access, command execution, dynamic module loading, unrestricted object access, database handles, or secrets through IPC.
- Validate external URLs, paths, navigation, window creation, and custom-protocol input. Reject unknown origins and non-web schemes by default.
- Deny embedded-page permissions unless a specific, reviewed product requirement needs one.
- Clean up windows, listeners, shortcuts, timers, subscriptions, views, sessions, and IPC handlers at the correct lifecycle boundary.
- Never commit, expose, or log credentials, tokens, Cookie contents, personal data, or sensitive local paths.
- Preserve clear trust boundaries in errors: give the renderer safe user-facing results while retaining sanitized operational diagnostics in main-process logs.

Changes to main/preload/IPC, native modules, filesystem behavior, application startup, Vite/Forge configuration, or packaging require the Electron-sensitive validation sequence in `DEVELOPMENT_WORKFLOW.md`.
