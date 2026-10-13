## Context

See proposal.md. Electron 43 does not expose a documented WebContents event for JavaScript dialogs. A persistent DevTools Protocol attachment would conflict with existing cookie collection and amount-change capture. Embedded pages currently have no preload.

## Goals / Non-Goals

**Goals:** Attribute dialogs to a managed tab without capturing user text and without changing dialog outcomes.

**Non-Goals:** Block dialogs, infer account validity from dialog wording, or alter channel authentication.

## Decisions

- Build a separate, minimal preload for embedded pages. Run a small function in the page's main world before site scripts to wrap `alert`, `confirm`, and `prompt`. The wrappers emit a metadata-only event and delegate to the captured native functions. The preload relays the event to the owning WebContents using IPC.
- Bind the IPC listener to each managed WebContents rather than a global IPC handler. BrowserManager already owns the tab metadata and can log channel, tab ID, and sanitized site origin. The message payload contains only a known dialog kind; it cannot choose an arbitrary logged URL or message.
- Keep the existing application preload separate so untrusted channel pages do not receive the `hotelButler` API. Package the new preload as a second Forge Vite entry.

## Risks / Trade-offs

- [An iframe creates a dialog] → The first version observes top-frame dialogs only; report this limitation if the next reproduction produces no event.
- [A page replaces the wrapper after preload] → Log coverage can be lost; a subsequent reproduction will distinguish this from captured dialogs. Do not use a persistent debugger that could break existing business capture.
- [A page spoofs the metadata event] → The main process accepts only a fixed kind on the specific managed WebContents and never treats the event as an authority for authentication or navigation.

## Migration Plan

Ship in a later desktop release after validation. Existing sessions and storage do not change; rollback is removal of the diagnostic preload entry and listener.
