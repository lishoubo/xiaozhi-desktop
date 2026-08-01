# UI Engineering

## Required Sources

Before any renderer-facing change, read this document together with the complete `DESIGN.md` and `PRODUCT_UX_PRINCIPLES.md`.

- `DESIGN.md` is the source of truth for visual language, layout tokens, styling, interaction appearance, iconography, and component decisions.
- `PRODUCT_UX_PRINCIPLES.md` is the source of truth for user-task framing, information architecture, progressive disclosure, information density, product copy, and flow decisions.
- Internal UI implementation still follows engineering principles: explicit state, separable logic, testability, lifecycle correctness, and secure process boundaries.

## Tailwind CSS and shadcn-svelte

- Tailwind CSS and shadcn-svelte are the default UI tools.
- Reuse theme tokens, CSS variables, spacing scales, colors, typography, breakpoints, shared classes, variants, and state conventions.
- Prefer Tailwind utilities over inline styles, component-scoped one-off CSS, CSS-in-JS, new frameworks, or parallel styling systems.
- When custom CSS is necessary, keep it minimal, token-driven, and consistent with `DESIGN.md`.
- Search for an existing shadcn-svelte component before building a control.
- Prefer shadcn-svelte primitives and composition over custom reimplementations of standard controls.
- Preserve existing shadcn-svelte variants and component APIs.

### Adding shadcn-svelte Components

Use the official shadcn-svelte CLI `add` workflow through npm, matching the installed version and current configuration.

- Inspect the existing configuration and installed version first.
- Do not manually copy component source or recreate a component the CLI can install.
- Do not rerun broad initialization in an initialized repository.
- Review every generated file and keep project-specific edits minimal.
- Include generated files, configuration changes, and lockfile changes in the same reviewed change.
- If the CLI cannot install the component, document the exact limitation before implementing the smallest compatible local alternative.

## Motion System

Motion exists to preserve context, show cause and effect, and soften state changes. It must not delay a task, compete with content, or animate merely because an element is visible. `DESIGN.md` defines the visual motion tokens; `src/renderer/motion.ts` is their canonical renderer implementation.

### Ownership

Choose exactly one primary motion owner for an element:

| Change | Owner | Repository pattern |
| --- | --- | --- |
| A page or conditional surface enters or leaves the DOM | Svelte Transition | `in:enter`, or `transition:enter` when the exit preserves context |
| Immediate children are added, removed, moved, or cause their siblings to reflow | FormKit AutoAnimate | `use:autoAnimate={LAYOUT_ANIMATION_OPTIONS}` on a stable parent |
| A shadcn-svelte dialog, alert dialog, tooltip, or other stateful primitive opens and closes | The primitive's existing `data-open` / `data-closed` Tailwind animation | Keep the generated component behavior; customize the shared primitive rather than each call site |
| Hover, focus, pressed, selected, disabled, color, shadow, or transform styling changes | Tailwind CSS transition utilities | Use the narrowest suitable property utility, a motion token duration, `ease-out`, and `motion-reduce:transition-none` |
| A keyed list only reorders and needs custom FLIP behavior beyond AutoAnimate | Svelte `animate:flip` | Use only when AutoAnimate cannot express the requirement; do not use both on the same items |

Do not apply Svelte Transition and AutoAnimate to the same DOM element. Nested animation is acceptable only when each layer owns a different change, such as a page fading in while a message list later animates inserted rows.

### Timing and Movement

- Primitive overlays use the existing 100 ms shadcn-svelte timing.
- Direct interaction states use 150 ms.
- Page entry uses 160 ms with cubic-out easing and at most 6 px vertical movement.
- Layout and notification changes use 180 ms ease-out.
- Small conditional surfaces may move at most 8 px. Avoid large slides, bounce, elastic easing, rotation, parallax, and decorative looping animation.
- Prefer opacity and transform because they avoid layout work. AutoAnimate may manage layout geometry at its dedicated stable-parent boundary.
- Route changes use entry motion only. Do not delay navigation with a full-page outro or animate the persistent application frame.

### Svelte Transition

- Import the shared `enter` transition and options from `src/renderer/motion.ts`; do not duplicate timing literals in pages.
- Apply page entry to the page's single top-level content region and mark it with `data-motion="page"` for review and tests.
- Use a bidirectional `transition:enter` only for compact conditional surfaces whose removal should remain perceptible. Use `in:enter` for routed pages so the old route cannot block the new one.
- Svelte transitions retain an outgoing block until its outro completes. Account for that when the content owns focus, overlays an Electron `WebContentsView`, or controls native bounds.
- The embedded-browser page fades without translation so renderer transforms cannot visually diverge from native `WebContentsView` bounds.

### AutoAnimate

- Use the root `autoAnimate` export as a Svelte action on a stable parent. Its animated items must be immediate children.
- Use keyed `{#each}` blocks with stable identity for dynamic collections.
- Apply it only where children actually change: alerts, browser tabs, messages, attachments, compact lists, and validation regions. Do not attach it to entire pages or static card grids.
- Keep the parent in the DOM while its children change. Remember that AutoAnimate may set `position: relative`; do not attach it to `display: contents` or a parent whose positioning contract cannot change.
- Give flex children an explicit or bounded width when delayed flex growth would make geometry unstable.
- Reuse `LAYOUT_ANIMATION_OPTIONS` or `ALERT_ANIMATION_OPTIONS`. Introduce a different option set only when a documented interaction need requires it.

### shadcn-svelte and Tailwind CSS 4

- Preserve the accessibility, focus management, portals, and open/closed state contract of Bits UI and shadcn-svelte primitives.
- Do not add a Svelte transition around Dialog, AlertDialog, or Tooltip content that already uses `tw-animate-css`; this would double-animate opacity and transform.
- Customize shared primitive motion in `$lib/components/ui` so every call site remains consistent.
- Prefer `transition-colors`, `transition-opacity`, `transition-shadow`, or `transition-transform` over `transition-all`. Use the broader `transition` utility only when a shared control intentionally changes several standard visual properties.
- Loading spinners are allowed only while work is active. Stop or remove them when the operation completes.

### Reduced Motion and Accessibility

- Every motion path must preserve the same content, focus order, accessible name, live-region behavior, and action availability when motion is disabled.
- `src/renderer/motion.ts` reduces Svelte transitions to zero duration, AutoAnimate honors `prefers-reduced-motion`, Tailwind call sites use `motion-reduce` variants, and `global.css` limits third-party CSS animations under the same preference.
- Never use motion as the only indicator of success, failure, selection, loading, or hierarchy.
- Do not animate focus itself or move a focused control unexpectedly.

### Performance and Validation

- Do not animate high-frequency browser progress, scroll position, pointer movement, native browser bounds, or continuously updating operational data.
- Keep motion local and short; avoid layout observers on large static containers.
- Test dynamic-list insertion/removal, page motion boundaries, and reduced-motion configuration at the component or unit layer. Keep animation APIs mocked only in jsdom; validate real Web Animations behavior through the Electron E2E build.
- Review motion both at normal speed and with the operating system's reduced-motion preference before handoff.

## Icon System

`@lucide/svelte` is the only default product icon library.

- Search for and reuse an appropriate Lucide icon.
- Import icons individually and follow `DESIGN.md` for size, stroke, alignment, color, and states.
- Do not introduce another icon package, emoji, Unicode symbols, copied SVG, or hand-drawn SVG for normal controls.
- Do not add icons decoratively or to every label by default.
- Use icon-only controls only when conventional and unambiguous. Provide an accessible name and any required tooltip.
- If Lucide cannot express a necessary concept, document the exception and follow an existing asset convention.

## Renderer Quality

- Keep components focused and extract complex business rules and effects into testable modules.
- Explicitly handle loading, empty, success, disabled, and error states.
- Preserve keyboard access, focus behavior, semantic elements, labels, and required accessibility attributes.
- Handle asynchronous cancellation, races, and component teardown.
- Avoid blocking the renderer or main process with expensive synchronous work.
- Cover important interactions with behavior-focused tests.
- Do not assume server rendering, server components, Node.js access, or filesystem access from the renderer.
