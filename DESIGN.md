---
version: alpha
name: Mintlify
website: "https://mintlify.com"
description: Mintlify presents documentation infrastructure with a dual-mode aesthetic — atmospheric sky-gradient marketing heroes (cloud illustration backdrops, soft cream-to-blue washes) paired with dense developer-grade documentation surfaces. The system uses Inter for UI prose, Geist Mono for code, and a signature Mintlify green ({colors.brand-green}) reserved for accent CTAs and active states. Black-pill primary buttons dominate marketing, white-on-dark inversions appear on dark hero bands, and a 3-column documentation layout (sidebar / prose / TOC) anchors the developer experience. Coverage spans homepage, startups program, pricing comparison, and the live tabs documentation page.

seo:
  title: "Mintlify Design System for Svelte — Mint #00d4a4, Inter + Geist Mono, 49 components"
  metaDescription: "Mintlify's design system adapted for Svelte 5, shadcn-svelte, Tailwind CSS 4, and desktop workspaces."
  highlights:
    - "Dual-mode aesthetic — atmospheric sky-gradient marketing heroes paired with dense 3-column developer documentation surfaces"
    - "Signature mint #00d4a4 reserved for accent CTAs, active states, and feature checkmarks — never on body text"
    - "Inter + Geist Mono pairing — Inter carries all UI prose, Geist Mono surgically marks code blocks, type signatures, and inline references"
    - "Black-pill primary buttons with rounded.full (9999px) corners dominate marketing; white pills invert on dark hero bands"
    - "Tight 14px body type with 1.50 line-height anchors documentation reading; hero displays push to 72px / weight 600"
  tags:
    - "Documentation & Knowledge"
    - "Developer Tools & IDEs"
  lastUpdated: "2026-05-12"
  author:
    name: "Dov Azencot"
    url: "https://x.com/dovazencot"
  opening: |
    Mintlify sits at the seam between polished SaaS marketing and developer-grade documentation density. The homepage opens with a cinematic sky-gradient hero (a cloud illustration backdrop washing from "#87a8c8" sky-blue to "#f5e9d8" cream) and the startups page swaps in a dark teal-to-mint band with a rocket-launch illustration cutting across "#1a3d4a" to "#2d5a4f". Then the deeper surfaces collapse into a strict 3-column documentation grid — left sidebar nav at 240px, center prose capped at 720px, right table of contents at 200px. Inter carries every UI surface and Geist Mono shows up only for code blocks, inline references, and type signatures. The signature mint "#00d4a4" appears sparingly: hero "Get started" pill, green checkmarks on features, the 2px featured-pricing border, sidebar active indicators.

    This page packages the full Mintlify spec as a single DESIGN.md file using the Google Labs DESIGN.md format. Inside: 32 color tokens (brand mint plus deep "#00b48a" and soft "#7cebcb" variants, plus testimonial coral "#f55a3c", documentation tag blue "#3772cf", and the hero atmospheric gradient stops), 22 typography tokens spanning a 72px hero display down to 11px uppercase micro labels, an 8px-base spacing scale running through 12 tokens up to 120px hero padding, a 7-step border-radius scale, and 49 components covering buttons, cards, inputs, badges, code surfaces, sidebar and TOC navigation, hero bands, and the FAQ accordion.

    This project uses Svelte 5, shadcn-svelte, Tailwind CSS 4, and @lucide/svelte. Agents should read token references directly — `{colors.brand-green}`, `{rounded.full}`, `{typography.code-md}` — and implement them with Svelte runes, snippets, semantic CSS variables, and existing shadcn-svelte primitives. Desktop product surfaces should adopt the system's developer-grade information density, black primary actions, and restrained mint accents without copying marketing-only hero layouts.
  related:
    - href: "/design"
      title: "Browse all design systems"
      description: "The full directory of DESIGN.md files on shadcn.io, with live mockups for each."
    - href: "https://mintlify.com/"
      title: "Mintlify product site"
      description: "The live homepage, startups program, pricing, and documentation surfaces this spec was extracted from."
    - href: "https://github.com/google-labs-code/design.md"
      title: "The DESIGN.md specification"
      description: "Google Labs' open spec for machine-readable design system files — the format this page is built on."
  questions:
    - id: "primary-color"
      title: "What is Mintlify's primary brand color?"
      answer: "Mintlify's signature accent is mint green at \"#00d4a4\", paired with a deeper press variant at \"#00b48a\" and a soft tint at \"#7cebcb\". The primary CTA color on most surfaces is actually black at \"#0a0a0a\" — mint is reserved for high-signal moments like the hero 'Get started' pill, green feature checkmarks, the 2px featured-pricing tier border, and active sidebar indicator dots. The discipline is part of the brand: even one mint accent per viewport carries weight."
    - id: "typography"
      title: "What typography does Mintlify use?"
      answer: "Mintlify pairs two typefaces: Inter for all UI prose (headings, body, navigation, captions, buttons) and Geist Mono surgically for code blocks, inline code, and type signatures like `string` or `number`. There are no italic variants — emphasis comes from weight (500/600), color shift, or background highlight. The hero display sits at 72px / weight 600 with -2px letter-spacing; documentation body stays at 14–16px with 1.50 line-height for long-form reading."
    - id: "dual-mode"
      title: "How does Mintlify balance marketing atmosphere and documentation density?"
      answer: "The system runs two contrasting modes side by side. Marketing pages open with atmospheric gradient hero bands — sky-blue \"#87a8c8\" to cream \"#f5e9d8\" on the homepage, dark teal \"#1a3d4a\" to mint \"#2d5a4f\" on the startups page — and use 96–120px section padding for breathing room. Documentation pages collapse into a strict 3-column grid (240px sidebar / 720px prose / 200px TOC) with section gaps dropping to 32px and sidebar nav compressing to 8px vertical rhythm. The brand voice carries across both."
    - id: "shape-language"
      title: "What's the shape language and corner-radius scale?"
      answer: "The radius scale is tightly disciplined across 7 tokens: 4px for inline code chips, 6px for sidebar nav items and type badges, 8px for inputs and search pills, 12px for standard cards and pricing tiers, 16px for larger feature panels, 24px for featured product showcase tiles, and 9999px for every button, pill tab, and badge. The brand never softens between 8px and 12px for the same component family — pill buttons are always fully rounded, rectangular cards are always 12px."
    - id: "dark-mode"
      title: "Does Mintlify's design system have a dark mode?"
      answer: "Not as a documented surface. The spec captures the homepage, startups program, pricing page, and live tabs documentation page — all light-canvas with the canvas-dark \"#0a0a0a\" token reserved for promo banners, code editor wrappers, and inverted hero bands like the startups page. Specific dark-mode values for canvas, surface, ink, and hairline are listed as a Known Gap; the brand has not yet shipped a published dark-mode palette."
    - id: "use-in-project"
      title: "How do I use this DESIGN.md in a Svelte 5 project?"
      answer: "Map the semantic tokens to CSS variables in `src/renderer/styles/global.css`, use Tailwind CSS utilities for layout and component states, and extend existing shadcn-svelte primitives instead of creating React-style wrappers. New components use Svelte 5 runes (`$props`, `$state`, `$derived`), snippets for renderable children, `onclick` event properties, `class` rather than `className`, and icons from `@lucide/svelte`. Reserve mint for focus, confirmation, and active indicators; use near-black for the dominant action."

colors:
  primary: "#0a0a0a"
  on-primary: "#ffffff"
  brand-green: "#00d4a4"
  brand-green-deep: "#00b48a"
  brand-green-soft: "#7cebcb"
  brand-tag: "#3772cf"
  brand-warn: "#c37d0d"
  brand-annotate: "#1ba673"
  brand-error: "#d45656"
  brand-cursor: "#888888"
  hero-sky-from: "#87a8c8"
  hero-sky-to: "#f5e9d8"
  hero-dark-from: "#1a3d4a"
  hero-dark-to: "#2d5a4f"
  testimonial-orange: "#f55a3c"
  testimonial-orange-deep: "#cc3a1f"
  canvas: "#ffffff"
  canvas-dark: "#0a0a0a"
  surface: "#f7f7f7"
  surface-soft: "#fafafa"
  surface-code: "#1c1c1e"
  hairline: "#e5e5e5"
  hairline-soft: "#ededed"
  hairline-dark: "#1f1f1f"
  ink: "#0a0a0a"
  charcoal: "#1c1c1e"
  slate: "#3a3a3c"
  steel: "#5a5a5c"
  stone: "#888888"
  muted: "#a8a8aa"
  on-dark: "#ffffff"
  on-dark-muted: "#b3b3b3"

typography:
  hero-display:
    fontFamily: Inter
    fontSize: 72px
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: -2px
  display-lg:
    fontFamily: Inter
    fontSize: 56px
    fontWeight: 600
    lineHeight: 1.10
    letterSpacing: -1.5px
  heading-1:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: 600
    lineHeight: 1.10
    letterSpacing: -1px
  heading-2:
    fontFamily: Inter
    fontSize: 36px
    fontWeight: 600
    lineHeight: 1.20
    letterSpacing: -0.5px
  heading-3:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: 600
    lineHeight: 1.25
  heading-4:
    fontFamily: Inter
    fontSize: 22px
    fontWeight: 600
    lineHeight: 1.30
  heading-5:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.40
  subtitle:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: 400
    lineHeight: 1.50
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.50
  body-md-medium:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: 500
    lineHeight: 1.50
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.50
  body-sm-medium:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.50
  caption:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.40
  caption-bold:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: 600
    lineHeight: 1.40
  micro:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.40
  micro-uppercase:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: 600
    lineHeight: 1.40
    letterSpacing: 0.5px
  button-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.30
  code-md:
    fontFamily: Geist Mono
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.50
  code-sm:
    fontFamily: Geist Mono
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.40
  code-inline:
    fontFamily: Geist Mono
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.30

rounded:
  xs: 4px
  sm: 6px
  md: 8px
  lg: 12px
  xl: 16px
  xxl: 24px
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

components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button-md}"
    rounded: "{rounded.full}"
    padding: "10px 20px"
  button-primary-pressed:
    backgroundColor: "{colors.charcoal}"
    textColor: "{colors.on-primary}"
  button-primary-disabled:
    backgroundColor: "{colors.hairline}"
    textColor: "{colors.muted}"
  button-accent-green:
    backgroundColor: "{colors.brand-green}"
    textColor: "{colors.primary}"
    typography: "{typography.button-md}"
    rounded: "{rounded.full}"
    padding: "10px 20px"
  button-on-dark:
    backgroundColor: "{colors.on-dark}"
    textColor: "{colors.primary}"
    typography: "{typography.button-md}"
    rounded: "{rounded.full}"
    padding: "10px 20px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.button-md}"
    rounded: "{rounded.full}"
    padding: "10px 20px"
    border: "1px solid {colors.hairline}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.button-md}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  button-link:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm-medium}"
    padding: "0"
  button-icon-circular:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    size: 32px
    border: "1px solid {colors.hairline}"
  card-base:
    backgroundColor: "{colors.canvas}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xl}"
    border: "1px solid {colors.hairline}"
  card-feature:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xxl}"
  card-help:
    backgroundColor: "{colors.canvas}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xl}"
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
    backgroundColor: "{colors.canvas}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xxl}"
    border: "2px solid {colors.brand-green}"
    shadow: "rgba(0, 212, 164, 0.08) 0px 8px 24px"
  testimonial-card-feature:
    backgroundColor: "{colors.testimonial-orange}"
    textColor: "{colors.on-dark}"
    rounded: "{rounded.lg}"
    padding: "{spacing.section}"
  testimonial-card-quote:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xxl}"
    border: "1px solid {colors.hairline}"
  text-input:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: "{spacing.sm} {spacing.md}"
    border: "1px solid {colors.hairline}"
    height: 40px
  text-input-focused:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    border: "2px solid {colors.brand-green}"
  search-pill:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.steel}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: "{spacing.xs} {spacing.md}"
    height: 36px
    border: "1px solid {colors.hairline}"
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
  pill-tab:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.steel}"
    typography: "{typography.body-sm-medium}"
    rounded: "{rounded.full}"
    padding: "8px 16px"
    border: "1px solid {colors.hairline}"
  pill-tab-active:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.full}"
    border: "1px solid {colors.primary}"
  toggle-monthly-yearly:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    padding: "4px"
  badge-discount:
    backgroundColor: "{colors.brand-green}"
    textColor: "{colors.primary}"
    typography: "{typography.caption-bold}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
  badge-required:
    backgroundColor: "{colors.brand-error}"
    textColor: "{colors.on-dark}"
    typography: "{typography.micro-uppercase}"
    rounded: "{rounded.sm}"
    padding: "2px 6px"
  badge-type:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.steel}"
    typography: "{typography.code-sm}"
    rounded: "{rounded.sm}"
    padding: "2px 6px"
  badge-tag:
    backgroundColor: "rgba(55, 114, 207, 0.15)"
    textColor: "{colors.brand-tag}"
    typography: "{typography.caption-bold}"
    rounded: "{rounded.sm}"
    padding: "2px 8px"
  promo-banner:
    backgroundColor: "{colors.canvas-dark}"
    textColor: "{colors.on-dark}"
    typography: "{typography.body-sm-medium}"
    padding: "{spacing.sm} {spacing.md}"
  code-block:
    backgroundColor: "{colors.surface-code}"
    textColor: "{colors.on-dark}"
    typography: "{typography.code-md}"
    rounded: "{rounded.md}"
    padding: "{spacing.md}"
  code-block-header:
    backgroundColor: "{colors.surface-code}"
    textColor: "{colors.on-dark-muted}"
    typography: "{typography.caption}"
    padding: "{spacing.xs} {spacing.md}"
    border: "0 0 1px {colors.hairline-dark} solid"
  code-inline:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.charcoal}"
    typography: "{typography.code-inline}"
    rounded: "{rounded.xs}"
    padding: "2px 6px"
    border: "1px solid {colors.hairline}"
  property-row:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    padding: "{spacing.md} 0"
    border: "0 0 1px {colors.hairline-soft} solid"
  feature-comparison-table:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    border: "1px solid {colors.hairline}"
  feature-comparison-row:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    padding: "{spacing.md} {spacing.lg}"
    border: "0 0 1px {colors.hairline-soft} solid"
  sidebar-nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.steel}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
    padding: "{spacing.xs} {spacing.md}"
  sidebar-nav-item-active:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm-medium}"
  sidebar-section-header:
    backgroundColor: "transparent"
    textColor: "{colors.steel}"
    typography: "{typography.micro-uppercase}"
    padding: "{spacing.md} {spacing.md} {spacing.xs}"
  doc-toc-item:
    backgroundColor: "transparent"
    textColor: "{colors.steel}"
    typography: "{typography.body-sm}"
    padding: "{spacing.xxs} 0"
  doc-toc-item-active:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm-medium}"
  copy-code-button:
    backgroundColor: "transparent"
    textColor: "{colors.on-dark-muted}"
    typography: "{typography.caption}"
    rounded: "{rounded.sm}"
    padding: "{spacing.xxs} {spacing.xs}"
    border: "1px solid {colors.hairline-dark}"
  hero-band-sky:
    backgroundColor: "{colors.hero-sky-from}"
    textColor: "{colors.on-dark}"
    rounded: "0"
    padding: "{spacing.hero}"
  hero-band-dark:
    backgroundColor: "{colors.hero-dark-from}"
    textColor: "{colors.on-dark}"
    rounded: "0"
    padding: "{spacing.hero}"
  hero-product-mockup:
    backgroundColor: "{colors.canvas}"
    rounded: "{rounded.lg}"
    padding: "0"
    border: "1px solid {colors.hairline-soft}"
    shadow: "rgba(0, 0, 0, 0.12) 0px 24px 48px -8px"
  logo-wall-item:
    backgroundColor: "transparent"
    textColor: "{colors.steel}"
    typography: "{typography.body-md-medium}"
    padding: "{spacing.lg}"
  faq-accordion-item:
    backgroundColor: "{colors.canvas}"
    rounded: "{rounded.md}"
    padding: "{spacing.xl}"
    border: "1px solid {colors.hairline-soft}"
  footer-region:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.steel}"
    typography: "{typography.body-sm}"
    padding: "{spacing.section} {spacing.xxl}"
    border: "1px solid {colors.hairline}"
  footer-link:
    backgroundColor: "transparent"
    textColor: "{colors.steel}"
    typography: "{typography.body-sm}"
    padding: "{spacing.xxs} 0"
  startup-program-card:
    backgroundColor: "{colors.canvas}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xxl}"
    border: "1px solid {colors.hairline}"
  founder-quote-card:
    backgroundColor: "{colors.testimonial-orange}"
    textColor: "{colors.on-dark}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xxl}"
---

## Overview

Mintlify positions itself at the intersection of polished marketing presentation and developer-grade documentation density. The home and startups pages open with cinematic atmospheric heroes — soft sky-gradient backdrops with cloud illustrations on the homepage, dark teal-to-mint gradients with a rocket launch on the startups page — that feel more like a SaaS landing aesthetic than a developer tool. Then the deeper surfaces (pricing comparison, live documentation pages) collapse into dense, high-information layouts where Inter body type carries 14–16px copy across long-form prose, syntax-highlighted code blocks, and 3-column documentation grids.

The brand's signature mint green ({colors.brand-green}) appears sparingly but decisively — on the hero "Get started" pill button, the green checkmark icons inside feature lists, the "Featured" pricing tier border, and active state indicators inside docs UI. Black-pill primary buttons dominate the marketing flow; white-on-dark inversions appear on dark hero bands. The signature pairing of Inter (body, headings) with Geist Mono (code blocks, inline references, type signatures) reinforces the developer-tool DNA without requiring a third typeface.

**Key Characteristics:**
- Atmospheric gradient hero bands (sky-blue to cream on homepage; teal-to-mint on startups) provide cinematic marketing presentation
- Signature Mintlify mint green ({colors.brand-green}) reserved for accent CTAs, active states, and feature confirmations
- Black-pill primary buttons ({colors.primary} + `{rounded.full}`) for marketing CTAs
- Inter for all UI prose; Geist Mono for code blocks, inline code, and type/property signatures
- 3-column documentation layout (sidebar / prose / TOC) with dense 14px body type for long-form developer reading
- Tightly-controlled radius scale: marketing uses `{rounded.lg}` (12px), pill buttons use `{rounded.full}` — no in-between corner softening
- Vibrant testimonial card (`{colors.testimonial-orange}`) breaks color rhythm intentionally for emotional impact

## Known Gaps

- Specific dark-mode token values for canvas, surface, ink, and hairline are not surfaced on these pages; the brand has not yet shipped a published dark-mode palette
- Animation/transition timings are not extracted; recommend 150–200ms ease for hover/focus state transitions
- Form validation success state is not explicitly captured beyond defaults — implement following standard green-border + success badge patterns
- Code syntax highlighting palette inside docs is not formalized; documentation samples carry their own twoslash-style annotation system tokens (e.g. `{colors.brand-tag}`, `{colors.brand-annotate}`, `{colors.brand-warn}`) but the full highlight scheme is not enumerated
