---
version: alpha
name: Notion
website: "https://www.notion.com"
description: Notion presents itself as the all-in-one workspace through a confident, illustration-rich brand voice — anchored by a deep navy hero band ("#0a1530") decorated with brand-colored sticky-note dots and mesh wire illustrations, a signature purple pill primary CTA ("#5645d4"), and a rich palette of pastel-tinted feature cards that echo the colorful database properties of the live product. The system uses a Notion-Sans (Inter-based) typeface across every UI surface, anchors a 4-tier pricing comparison (Free / Plus / Business / Enterprise), and presents the live workspace UI mockup directly inside the hero band. Coverage spans homepage, Enterprise, Product AI, Product Agents, Startups, and Pricing surfaces.

seo:
  title: "Notion Design System for Svelte — Purple #5645d4, Notion Sans, 50+ components"
  metaDescription: "Notion's design system as a DESIGN.md file. Purple #5645d4 CTA, navy #0a1530 hero, Notion Sans, 50+ components. Adapted for Svelte 5, shadcn-svelte, Tailwind CSS 4, and AI tools."
  highlights:
    - "Signature purple voltage — #5645d4 reserved for the dominant 'Get Notion free' CTA, never decorative"
    - "Deep navy #0a1530 hero band with scattered sticky-note dots and mesh wire illustrations"
    - "Nine pastel card tints — peach, rose, mint, lavender, sky, yellow, cream, gray, plus bold yellow #f9e79f"
    - "Rectangular 8px buttons, not pills — sober-editorial geometry distinguishes it from Stripe and Linear"
    - "Live workspace mockup card embedded in the hero with a 24px diffuse drop shadow"
  tags:
    - "Productivity & SaaS"
    - "Documentation & Knowledge"
  lastUpdated: "2026-05-12"
  author:
    name: "Dov Azencot"
    url: "https://x.com/dovazencot"
  opening: |
    Notion's design system reads as a workspace, not a marketing site. The homepage opens with "Meet the night shift." centered over a deep navy band ("#0a1530") decorated with brand-colored sticky-note dots and mesh wire illustrations — atmosphere rather than chrome. The dominant action is a single purple pill button at "#5645d4", and a real "Ramp HQ" kanban mockup floats below the buttons with a 24px diffuse drop shadow. The voice is confident and illustration-rich without leaning maximalist.

    This DESIGN.md packages the whole spec into one machine-readable file. Inside: 53 color tokens grouped into brand purples, a 10-color brand spectrum, 9 pastel card tints, surface, hairline, text, and semantic scales; 17 typography tokens running Notion Sans (Inter-based) from 80px hero-display down to 11px micro-uppercase; 8 corner radii from 4px chips to 24px feature cards; 12 spacing tokens up to 120px hero gutters; and 50+ components covering buttons, pastel feature cards (peach, rose, mint, lavender, sky, yellow, cream), inputs, pill and segmented tabs, badges, the 4-tier pricing comparison, the embedded workspace mockup, FAQ accordions, and the multi-column footer. Format follows the Google Labs DESIGN.md spec.

    This project uses Svelte 5, shadcn-svelte, Tailwind CSS 4, and @lucide/svelte. Feed this file to an AI coding tool to generate Svelte components that match Notion's discipline — rectangular 8px buttons, 12px-rounded cards, purple reserved for one CTA per page, and navy bands paired with sticky-note decoration — instead of a generic shadcn theme. Reference the tokens through Tailwind CSS utilities, semantic CSS variables, and existing shadcn-svelte primitives. The system is worth studying for one reason: it proves that "all-in-one workspace" branding can be illustration-rich and colorful without resorting to gradient bling or pill-button-everywhere uniformity.
  related:
    - href: "https://github.com/google-labs-code/design.md"
      title: "The DESIGN.md specification"
      description: "Google Labs' open spec for machine-readable design system files — the format this page is built on."
    - href: "/design"
      title: "Browse all design systems"
      description: "The full directory of DESIGN.md files on shadcn.io, with live mockups for each."
    - href: "https://www.shadcn-svelte.com/"
      title: "shadcn-svelte documentation"
      description: "Accessible Svelte components designed to be customized with Tailwind CSS and semantic theme variables."
  questions:
    - id: "primary-color"
      title: "What is Notion's primary brand color?"
      answer: "Notion's signature color is the purple at #5645d4, used exclusively for the dominant 'Get Notion free' primary CTA. It pairs with #4534b3 for the pressed state and #3a2a99 for deeper emphasis. The purple is held back from body text and large background surfaces — the rest of the system runs on the deep navy hero band #0a1530, near-black ink #1a1a1a, warm charcoal #37352f, and a wide pastel card-tint palette. That restraint is what makes the purple register as a brand signal rather than decoration."
    - id: "dark-mode"
      title: "Does Notion's marketing site use dark mode?"
      answer: "Not as a togglable theme. The public marketing site is light-only, with #ffffff canvas and #f6f5f4 surfaces carrying most of the page. The only dark surfaces are the hero bands — #0a1530 navy with white text — and a promo strip variant at #070f24. The Notion app itself has a full dark theme, but the DESIGN.md captured here documents the marketing surfaces (homepage, Enterprise, Product AI, Product Agents, Startups, Pricing) where dark mode is band-scoped rather than global."
    - id: "typography"
      title: "What font does Notion use, and what should I substitute?"
      answer: "Notion runs Notion Sans, a custom Inter-based variable typeface, across every UI surface including the homepage and product pages. Fallbacks walk Inter, -apple-system, system-ui, 'Segoe UI', Helvetica, sans-serif. The 80px hero-display token sits at weight 600 with -2px letter-spacing and 1.05 line-height; body-md runs 16px / 400 / 1.55 for documentation-friendly reading. Inter is the cleanest open-source substitute — proportions transfer almost identically, since Notion Sans is itself a fork."
    - id: "shape-language"
      title: "Why does Notion use rectangular buttons instead of pills?"
      answer: "Notion's shape language is sober-editorial. Buttons render at 8px radius (`{rounded.md}`), inputs at 8px, cards at 12px (`{rounded.lg}`), and pill tabs and status badges at 9999px. Only tabs and badges are fully pill-shaped — every other interactive surface is a rectangle. The choice distinguishes Notion from pill-button-everywhere brands like Stripe and Linear and reinforces the workspace identity: rectangles feel like document blocks, pills feel like consumer apps."
    - id: "use-in-project"
      title: "Can I use this DESIGN.md to build a Svelte workspace app?"
      answer: "Yes. This version is adapted for Svelte 5, shadcn-svelte, and Tailwind CSS 4. Give it to an AI coding tool and the agent should reproduce Notion's purple-CTA discipline, navy hero bands, pastel feature-card grid, and 8px rectangular button geometry with Svelte components and existing shadcn-svelte primitives. Map the semantic tokens to the CSS variables in src/renderer/styles/global.css and use Tailwind CSS utilities for component-level layout and state styling."
    - id: "known-gaps"
      title: "What's missing from this DESIGN.md spec?"
      answer: "A short list, documented in the Known Gaps section. Dark-mode token values are only surfaced for the hero bands — the in-app dark theme isn't captured. Animation and transition timings weren't extracted; 150–200ms ease is a safe default. Form-validation success state is not explicitly captured beyond the focused-input purple border. And the pastel-tint mapping (which feature card uses peach versus rose versus lavender) is observation-based from the six captured surfaces — the actual brand library may have additional tints."

colors:
  primary: "#5645d4"
  primary-pressed: "#4534b3"
  primary-deep: "#3a2a99"
  on-primary: "#ffffff"
  brand-navy: "#0a1530"
  brand-navy-deep: "#070f24"
  brand-navy-mid: "#1a2a52"
  link-blue: "#0075de"
  link-blue-pressed: "#005bab"
  brand-orange: "#dd5b00"
  brand-orange-deep: "#793400"
  brand-pink: "#ff64c8"
  brand-pink-deep: "#a02e6d"
  brand-purple: "#7b3ff2"
  brand-purple-300: "#d6b6f6"
  brand-purple-800: "#391c57"
  brand-teal: "#2a9d99"
  brand-green: "#1aae39"
  brand-yellow: "#f5d75e"
  brand-brown: "#523410"
  card-tint-peach: "#ffe8d4"
  card-tint-rose: "#fde0ec"
  card-tint-mint: "#d9f3e1"
  card-tint-lavender: "#e6e0f5"
  card-tint-sky: "#dcecfa"
  card-tint-yellow: "#fef7d6"
  card-tint-yellow-bold: "#f9e79f"
  card-tint-cream: "#f8f5e8"
  card-tint-gray: "#f0eeec"
  canvas: "#ffffff"
  surface: "#f6f5f4"
  surface-soft: "#fafaf9"
  hairline: "#e5e3df"
  hairline-soft: "#ede9e4"
  hairline-strong: "#c8c4be"
  ink-deep: "#000000"
  ink: "#1a1a1a"
  charcoal: "#37352f"
  slate: "#5d5b54"
  steel: "#787671"
  stone: "#a4a097"
  muted: "#bbb8b1"
  on-dark: "#ffffff"
  on-dark-muted: "#a4a097"
  semantic-success: "#1aae39"
  semantic-warning: "#dd5b00"
  semantic-error: "#e03131"

typography:
  hero-display:
    fontFamily: Notion Sans
    fontSize: 80px
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: -2px
  display-lg:
    fontFamily: Notion Sans
    fontSize: 56px
    fontWeight: 600
    lineHeight: 1.10
    letterSpacing: -1px
  heading-1:
    fontFamily: Notion Sans
    fontSize: 48px
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: -0.5px
  heading-2:
    fontFamily: Notion Sans
    fontSize: 36px
    fontWeight: 600
    lineHeight: 1.20
    letterSpacing: -0.5px
  heading-3:
    fontFamily: Notion Sans
    fontSize: 28px
    fontWeight: 600
    lineHeight: 1.25
  heading-4:
    fontFamily: Notion Sans
    fontSize: 22px
    fontWeight: 600
    lineHeight: 1.30
  heading-5:
    fontFamily: Notion Sans
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.40
  subtitle:
    fontFamily: Notion Sans
    fontSize: 18px
    fontWeight: 400
    lineHeight: 1.50
  body-md:
    fontFamily: Notion Sans
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.55
  body-md-medium:
    fontFamily: Notion Sans
    fontSize: 16px
    fontWeight: 500
    lineHeight: 1.55
  body-sm:
    fontFamily: Notion Sans
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.50
  body-sm-medium:
    fontFamily: Notion Sans
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.50
  caption:
    fontFamily: Notion Sans
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.40
  caption-bold:
    fontFamily: Notion Sans
    fontSize: 13px
    fontWeight: 600
    lineHeight: 1.40
  micro:
    fontFamily: Notion Sans
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.40
  micro-uppercase:
    fontFamily: Notion Sans
    fontSize: 11px
    fontWeight: 600
    lineHeight: 1.40
    letterSpacing: 1px
  button-md:
    fontFamily: Notion Sans
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.30

rounded:
  xs: 4px
  sm: 6px
  md: 8px
  lg: 12px
  xl: 16px
  xxl: 20px
  xxxl: 24px
  full: 9999px

spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 20px
  xl: 24px
  xxl: 32px
  xxxl: 40px
  section-sm: 48px
  section: 64px
  section-lg: 96px
  hero: 120px

motion:
  dialog: 100ms
  state: 150ms
  page-enter: 160ms
  layout: 180ms
  easing-enter: cubic-out
  easing-state: ease-out
  distance-page: 6px
  distance-surface: 8px
  reduced-motion: remove transforms and reduce durations to effectively immediate feedback

implementation:
  application: "Electron renderer"
  framework: "Svelte 5"
  language: "TypeScript"
  componentLibrary: "shadcn-svelte"
  styling: "Tailwind CSS 4"
  icons: "@lucide/svelte"
  font: "@fontsource-variable/inter"
  componentAlias: "$lib/components"
  uiAlias: "$lib/components/ui"
  utilityAlias: "$lib/utils"
  globalStylesheet: "src/renderer/styles/global.css"
  conventions:
    - "Generate .svelte components with <script lang=\"ts\"> when component logic or typed props are needed."
    - "Use Svelte 5 runes for local reactive state and derived values."
    - "Use Svelte class attributes, bind:value for two-way form bindings, and event attributes such as onclick."
    - "Prefer existing shadcn-svelte primitives from $lib/components/ui before creating a new accessible primitive."
    - "Customize shadcn-svelte through semantic CSS variables, component variants, and Tailwind CSS utilities."
    - "Use @lucide/svelte exclusively for interface icons; do not mix icon libraries, hand-authored SVG icons, or emoji as control icons."
    - "Import Lucide icons individually, keep size and stroke treatment consistent within a surface, and preserve an accessible text label or aria-label for icon-only controls."
    - "Apply a less-is-more product philosophy: implement the smallest clear interface that supports the requested task."
    - "Do not invent explanatory copy, promotional sections, helper cards, headings, badges, or decorative elements that the requested workflow does not need."
    - "Prefer hierarchy, spacing, familiar controls, and progressive disclosure over persistent instructional text."
    - "Keep reusable UI in src/renderer/components and page-level composition in src/renderer/pages."
    - "Follow docs/UI_ENGINEERING.md for motion ownership: Svelte transitions for presence, AutoAnimate for direct-child layout changes, shadcn-svelte for primitive open/close motion, and Tailwind utilities for visual state changes."
    - "Do not assume server rendering, server components, or filesystem access from the renderer."
  semanticTokenMapping:
    background: "{colors.canvas}"
    foreground: "{colors.ink}"
    card: "{colors.canvas}"
    cardForeground: "{colors.ink}"
    popover: "{colors.canvas}"
    popoverForeground: "{colors.ink}"
    primary: "{colors.primary}"
    primaryForeground: "{colors.on-primary}"
    secondary: "{colors.surface}"
    secondaryForeground: "{colors.charcoal}"
    muted: "{colors.surface}"
    mutedForeground: "{colors.steel}"
    accent: "{colors.card-tint-lavender}"
    accentForeground: "{colors.primary-deep}"
    destructive: "{colors.semantic-error}"
    border: "{colors.hairline}"
    input: "{colors.hairline-strong}"
    ring: "{colors.primary}"
    radius: "{rounded.md}"

components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button-md}"
    rounded: "{rounded.md}"
    padding: "10px 18px"
  button-primary-pressed:
    backgroundColor: "{colors.primary-pressed}"
    textColor: "{colors.on-primary}"
  button-primary-disabled:
    backgroundColor: "{colors.hairline}"
    textColor: "{colors.muted}"
  button-dark:
    backgroundColor: "{colors.ink-deep}"
    textColor: "{colors.on-dark}"
    typography: "{typography.button-md}"
    rounded: "{rounded.md}"
    padding: "10px 18px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.button-md}"
    rounded: "{rounded.md}"
    padding: "10px 18px"
    border: "1px solid {colors.hairline-strong}"
  button-on-dark:
    backgroundColor: "{colors.on-dark}"
    textColor: "{colors.ink}"
    typography: "{typography.button-md}"
    rounded: "{rounded.md}"
    padding: "10px 18px"
  button-secondary-on-dark:
    backgroundColor: "transparent"
    textColor: "{colors.on-dark}"
    typography: "{typography.button-md}"
    rounded: "{rounded.md}"
    padding: "10px 18px"
    border: "1px solid {colors.on-dark-muted}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.button-md}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
  button-link:
    backgroundColor: "transparent"
    textColor: "{colors.link-blue}"
    typography: "{typography.body-sm-medium}"
    padding: "0"
  card-base:
    backgroundColor: "{colors.canvas}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xl}"
    border: "1px solid {colors.hairline}"
  card-feature:
    backgroundColor: "{colors.canvas}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xxl}"
    border: "1px solid {colors.hairline}"
  card-feature-yellow-bold:
    backgroundColor: "{colors.card-tint-yellow-bold}"
    textColor: "{colors.charcoal}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xxl}"
  card-feature-peach:
    backgroundColor: "{colors.card-tint-peach}"
    textColor: "{colors.charcoal}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xxl}"
  card-feature-rose:
    backgroundColor: "{colors.card-tint-rose}"
    textColor: "{colors.charcoal}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xxl}"
  card-feature-mint:
    backgroundColor: "{colors.card-tint-mint}"
    textColor: "{colors.charcoal}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xxl}"
  card-feature-sky:
    backgroundColor: "{colors.card-tint-sky}"
    textColor: "{colors.charcoal}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xxl}"
  card-feature-lavender:
    backgroundColor: "{colors.card-tint-lavender}"
    textColor: "{colors.charcoal}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xxl}"
  card-feature-yellow:
    backgroundColor: "{colors.card-tint-yellow}"
    textColor: "{colors.charcoal}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xxl}"
  card-feature-cream:
    backgroundColor: "{colors.card-tint-cream}"
    textColor: "{colors.charcoal}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xxl}"
  card-agent-tile:
    backgroundColor: "{colors.canvas}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xl}"
    border: "1px solid {colors.hairline}"
  card-template:
    backgroundColor: "{colors.canvas}"
    rounded: "{rounded.lg}"
    padding: "{spacing.lg}"
    border: "1px solid {colors.hairline}"
  card-startup-perk:
    backgroundColor: "{colors.canvas}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xl}"
    border: "1px solid {colors.hairline}"
  pricing-card:
    backgroundColor: "{colors.canvas}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xxl}"
    border: "1px solid {colors.hairline}"
  pricing-card-featured:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xxl}"
    border: "2px solid {colors.primary}"
  text-input:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: "{spacing.sm} {spacing.md}"
    border: "1px solid {colors.hairline-strong}"
    height: 44px
  text-input-focused:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    border: "2px solid {colors.primary}"
  search-pill:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.steel}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: "{spacing.sm} {spacing.md}"
    height: 44px
    border: "1px solid {colors.hairline}"
  pill-tab:
    backgroundColor: "transparent"
    textColor: "{colors.steel}"
    typography: "{typography.body-sm-medium}"
    rounded: "{rounded.full}"
    padding: "{spacing.xs} {spacing.md}"
    border: "1px solid {colors.hairline}"
  pill-tab-active:
    backgroundColor: "{colors.ink-deep}"
    textColor: "{colors.on-dark}"
    rounded: "{rounded.full}"
    border: "1px solid {colors.ink-deep}"
  segmented-tab:
    backgroundColor: "transparent"
    textColor: "{colors.steel}"
    typography: "{typography.body-sm-medium}"
    padding: "{spacing.sm} {spacing.md}"
    border: "0 0 2px transparent solid"
  segmented-tab-active:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm-medium}"
    border: "0 0 2px {colors.ink} solid"
  badge-purple:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.caption-bold}"
    rounded: "{rounded.full}"
    padding: "4px 10px"
  badge-pink:
    backgroundColor: "{colors.brand-pink}"
    textColor: "{colors.on-primary}"
    typography: "{typography.caption-bold}"
    rounded: "{rounded.full}"
    padding: "4px 10px"
  badge-orange:
    backgroundColor: "{colors.brand-orange}"
    textColor: "{colors.on-primary}"
    typography: "{typography.caption-bold}"
    rounded: "{rounded.full}"
    padding: "4px 10px"
  badge-tag-purple:
    backgroundColor: "{colors.card-tint-lavender}"
    textColor: "{colors.brand-purple-800}"
    typography: "{typography.caption-bold}"
    rounded: "{rounded.sm}"
    padding: "2px 8px"
  badge-tag-orange:
    backgroundColor: "{colors.card-tint-peach}"
    textColor: "{colors.brand-orange-deep}"
    typography: "{typography.caption-bold}"
    rounded: "{rounded.sm}"
    padding: "2px 8px"
  badge-tag-green:
    backgroundColor: "{colors.card-tint-mint}"
    textColor: "{colors.brand-green}"
    typography: "{typography.caption-bold}"
    rounded: "{rounded.sm}"
    padding: "2px 8px"
  badge-popular:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.caption-bold}"
    rounded: "{rounded.full}"
    padding: "4px 10px"
  promo-banner:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm-medium}"
    padding: "{spacing.sm} {spacing.md}"
  hero-band-dark:
    backgroundColor: "{colors.brand-navy}"
    textColor: "{colors.on-dark}"
    rounded: "0"
    padding: "{spacing.hero}"
  workspace-mockup-card:
    backgroundColor: "{colors.canvas}"
    rounded: "{rounded.lg}"
    padding: "0"
    border: "1px solid {colors.hairline}"
    shadow: "rgba(15, 15, 15, 0.2) 0px 24px 48px -8px"
  cta-banner-light:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "{spacing.section}"
  comparison-table:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    border: "1px solid {colors.hairline}"
  comparison-row:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    padding: "{spacing.md} {spacing.lg}"
    border: "0 0 1px {colors.hairline-soft} solid"
  testimonial-card:
    backgroundColor: "{colors.canvas}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xxl}"
    border: "1px solid {colors.hairline}"
  logo-wall-item:
    backgroundColor: "transparent"
    textColor: "{colors.steel}"
    typography: "{typography.body-md-medium}"
    padding: "{spacing.lg}"
  faq-accordion-item:
    backgroundColor: "{colors.canvas}"
    rounded: "{rounded.md}"
    padding: "{spacing.xl}"
    border: "0 0 1px {colors.hairline} solid"
  stat-row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "{spacing.section-sm}"
  footer-region:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.charcoal}"
    typography: "{typography.body-sm}"
    padding: "{spacing.section} {spacing.xxl}"
    border: "1px solid {colors.hairline}"
  footer-link:
    backgroundColor: "transparent"
    textColor: "{colors.steel}"
    typography: "{typography.body-sm}"
    padding: "{spacing.xxs} 0"
---

## Overview

Notion presents itself as the all-in-one workspace through a confident, illustration-rich brand voice. The homepage opens with **"Meet the night shift."** rendered centered over a deep navy hero band ("#0a1530"), decorated with brand-colored sticky-note dots and mesh wire illustrations scattered around the headline. The signature **purple pill primary CTA** ("#5645d4") "Get Notion free" sits at the visual center, paired with an outlined "Request a demo" secondary. Below the buttons, a real Notion workspace UI mockup card (the "Ramp HQ" kanban board) breaks out of the hero band with a deep diffuse drop shadow.

Below the hero, the page cycles through a distinctive sequence of feature sections: a dense sticky-note "Keep work moving 24/7" panel with red/blue/green/purple/teal status icons; a **bold yellow** ("#f9e79f") "Ask your on-demand assistants" banner card flanked by orange/rose/mint pastel feature tiles showing assistant UI mockups; and a "Bring all your work together" 3-column grid with brand-colored mockups (sky-blue tutorial card, light Notion calendar, brown/rust testimonial slate). The pricing page renders 4 tiers (Free / Plus / Business / Enterprise) horizontally with one tier featured (purple-bordered) and a dense feature comparison table running below.

The system uses a Notion-Sans typeface (Inter-based) across every UI surface — humanist-geometric character that pairs naturally with the colorful illustrations. Buttons are 8px rectangles, NOT pills — distinguishing Notion's sober rectangular geometry from competitors that use pills universally. Cards use 12px corner rounding consistently.

**Key Characteristics:**

- Deep navy hero band ("#0a1530") with scattered sticky-note dots + mesh wire decorative illustrations
- **Signature purple pill** ("#5645d4") primary CTA — Notion's recognizable "Get Notion free" button color
- Real Notion workspace UI mockup card embedded in the hero with deep drop shadow
- Bold yellow feature banner ("#f9e79f") for high-emphasis content sections
- Pastel feature card palette (peach, rose, mint, lavender, sky, yellow) echoing the live product database properties
- Notion-Sans (Inter-based) across every UI surface
- 8px-rounded buttons (NOT pills), 12px-rounded cards — sober editorial geometry
- 4-tier pricing comparison with dense feature table
- Centered hero layout (different from the left-aligned norm of most B2B SaaS)

## Project Implementation

This specification is implemented in the Electron renderer with **Svelte 5**, **TypeScript**, **shadcn-svelte**, and **Tailwind CSS 4**. Treat the design tokens above as the visual source of truth and the existing components under `$lib/components/ui` as the behavioral and accessibility foundation.

- Build reusable components as `.svelte` files. Use `<script lang="ts">` for typed props and component logic.
- Use Svelte 5 runes for reactive state and derived values. Use `bind:value` for form bindings, `class` for CSS classes, and event attributes such as `onclick`.
- Check `$lib/components/ui` before implementing buttons, inputs, dialogs, sheets, menus, tabs, tooltips, or other common primitives. Extend the existing shadcn-svelte component with variants and Tailwind classes where possible.
- Use semantic utilities such as `bg-background`, `text-foreground`, `bg-primary`, `text-primary-foreground`, `border-border`, and `ring-ring`. The mapping in `implementation.semanticTokenMapping` defines how those roles relate to this design.
- Keep semantic theme values in `src/renderer/styles/global.css`. Use Tailwind utilities for layout, spacing, responsive behavior, and component-specific states.
- Use icons exclusively from `@lucide/svelte`. Do not mix in another icon package, hand-authored SVG icons, Unicode symbols, or emoji as interface controls. Import icons individually, use the established size and stroke treatment for the surrounding surface, and give icon-only controls an accessible name and an adequate touch target.
- This is a desktop Electron renderer. Do not assume server rendering or direct filesystem access in a Svelte component; privileged operations must go through the project's preload and IPC boundary.
- Inter Variable is the licensed, installed substitute for Notion Sans and should be used through the existing project font configuration.
- Motion is restrained and task-oriented. Use the tokens under `motion`; animate page or conditional-surface presence, layout continuity, and direct interaction feedback, but never add decorative looping motion or layer multiple animation systems on the same element. Detailed ownership and accessibility rules live in `docs/UI_ENGINEERING.md`.

## Product Experience Principles

The application follows a **less-is-more** product philosophy. The detailed visual tokens in this document define consistency; they do not require every product surface to reproduce the density, illustration, or promotional content of the referenced marketing examples.

- Design the smallest clear interface that completes the requested user task.
- Add only the controls, states, and information necessary for the requested workflow. Do not infer adjacent features or expand a small request into a dashboard, onboarding flow, tutorial, or marketing surface.
- Do not add explanatory paragraphs, redundant headings, helper cards, badges, banners, hints, or placeholder copy merely to make a layout look complete.
- Prefer clear hierarchy, grouping, alignment, spacing, conventional control placement, and recognizable Lucide icons over instructional text.
- Keep labels concise. Add supporting copy only when it prevents a likely mistake, communicates a meaningful constraint, explains an irreversible consequence, or is required for accessibility.
- Use progressive disclosure for secondary and advanced actions. Keep the primary action obvious and avoid presenting many equal-weight choices.
- Avoid decorative UI that does not improve comprehension or task completion. Empty space is an intentional design tool.
- Reuse familiar interaction patterns and existing components so the interface feels predictable without extra explanation.
- Keep feedback concise but complete: users must still receive clear loading, success, empty, disabled, validation, and error states.
- Minimalism must never remove essential context, accessibility, error recovery, destructive-action confirmation, or security-relevant information.
- When a requirement specifies behavior but not layout, choose the simplest arrangement consistent with existing nearby screens and components. Do not over-interpret the requirement or invent a new visual concept.

### Iconography

- `@lucide/svelte` is the single canonical icon source for the product UI.
- Search Lucide before creating or sourcing an icon. Choose the most semantically direct icon, not a decorative approximation.
- Use icons only when they improve recognition, scanning, or control affordance. Do not add icons to every label or heading by default.
- Prefer a text label for unfamiliar or consequential actions. An icon may accompany the label when useful.
- Icon-only buttons are appropriate only for widely understood actions in a clear context and must include an accessible name, tooltip when discoverability requires it, visible focus treatment, and an adequate hit target.
- Keep icon size, stroke width, alignment, color, hover state, and disabled state consistent with the component and surrounding interface.
- Do not use emoji, text glyphs, a second icon library, or hand-authored SVG markup as substitutes for available Lucide icons.
- If Lucide has no suitable icon, first reconsider whether the icon is necessary. Any exception must follow an existing project asset convention and be documented rather than silently introducing another icon system.

## Known Gaps

- Specific dark-mode token values not surfaced beyond hero bands
- Form validation success state not explicitly captured
- Pastel-tint mapping (which feature uses which tint) is observation-based — the actual brand library may have more entries
