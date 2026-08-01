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
