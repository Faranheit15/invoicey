---
name: Invoicey
description: Slate-neutral billing interface with a token layer in place and two surface registers not yet unified.
colors:
  background: "hsl(210 33% 98%)"
  foreground: "hsl(222 47% 11%)"
  card: "hsl(0 0% 100%)"
  card-foreground: "hsl(222 47% 11%)"
  primary: "hsl(222 47% 11%)"
  primary-foreground: "hsl(210 40% 98%)"
  secondary: "hsl(210 40% 96%)"
  muted: "hsl(210 40% 96%)"
  muted-foreground: "hsl(215 16% 46%)"
  accent: "hsl(210 40% 94%)"
  border: "hsl(214 32% 88%)"
  ring: "hsl(217 91% 60%)"
  destructive: "hsl(0 72% 51%)"
  dark-background: "hsl(222 47% 11%)"
  dark-card: "hsl(222 47% 13%)"
  dark-muted: "hsl(217 33% 20%)"
  dark-muted-foreground: "hsl(215 20% 65%)"
  dark-border: "hsl(217 33% 22%)"
  dark-ring: "hsl(212 95% 68%)"
  atmosphere-sky: "#0EA5E9"
  atmosphere-sky-light: "#38BDF8"
  atmosphere-orange: "#F97316"
  status-sent: "#1D4ED8"
  status-paid: "#047857"
  status-overdue: "#BE123C"
  document-ink: "#111827"
  document-rule: "#E5E7EB"
  document-desk: "#F3F4F6"
typography:
  display:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.25rem, 5vw, 3.75rem)"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "normal"
  headline:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 600
    lineHeight: 1.2
  title:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.015em"
  body:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.625
  label:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.18em"
rounded:
  sm: "8px"
  md: "10px"
  lg: "12px"
  xl: "16px"
  full: "9999px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
  xl: "40px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "hsl(222 47% 11% / 0.9)"
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "40px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "40px"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.card-foreground}"
    rounded: "{rounded.lg}"
    padding: "24px"
  input:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
    height: "40px"
  status-pill:
    textColor: "{colors.status-paid}"
    rounded: "{rounded.full}"
    padding: "4px 8px"
    typography: "{typography.label}"
  bento-card:
    backgroundColor: "hsl(0 0% 100% / 0.8)"
    textColor: "{colors.foreground}"
    rounded: "{rounded.xl}"
    padding: "20px"
  document-sheet:
    backgroundColor: "#FFFFFF"
    textColor: "{colors.document-ink}"
    rounded: "14px"
    padding: "28px"
    width: "880px"
---

# Design System: Invoicey

## Overview

Invoicey has no unifying design thesis, and this file does not invent one. It is a record of what the implementation actually does, written so that future work can unify the system deliberately rather than by accident.

The system is **slate-neutral and near-monochrome**. Structure comes from 1px borders and small steps in background lightness, not from color. A full shadcn HSL token layer is defined in [globals.css](app/globals.css) and wired through [tailwind.config.js](tailwind.config.js) — but most page code bypasses it and writes literal `slate-*` utilities with hand-authored `dark:` twins. The tokens and the literals happen to agree today (`--foreground` is exactly `slate-900`, `--secondary` is exactly `slate-100`), which is why the drift is invisible on screen and expensive in code.

Three registers exist, and they were built independently rather than derived from one another:

1. **Marketing surfaces** (`/`, `/about`, `/pricing`, `/contact`) — atmospheric. Blurred sky and orange radial glows, a masked 44px grid, translucent `backdrop-blur` cards, large diffuse shadows, uppercase letterspaced eyebrows.
2. **App surfaces** (`/dashboard`, `/create-invoice`, `/auth`) — flat and quiet. Opaque cards, `shadow-sm`, hairline borders, dense tables, no atmosphere at all.
3. **The exported invoice document** ([lib/invoice-export.ts](lib/invoice-export.ts)) — its own self-contained CSS in a raw HTML string, sharing no tokens with the app. Ink-on-paper: `#111827` text on white, a 2px near-black rule under the header, uppercase 11–12px labels, and an A4 print block that strips the shadow and radius.

**Unification is the stated direction.** Nothing in the accent strategy or the marketing atmosphere is hardened; treat those as provisional and changeable. What is *not* provisional is the neutral base, the token layer's structure, and the exported document's ink discipline — those are load-bearing and consistent everywhere they appear.

**Key Characteristics:**
- Near-monochrome slate; color carries state, not identity
- Borders and tonal steps over shadows, in-app
- Every dark variant hand-written; no automatic theming
- Uppercase, wide-tracked micro-labels as the recurring accent of the type system
- Rounded but not soft: 8–16px corners, full pills only for status
- No webfont; the system font stack is the type system
- Two surface registers, acknowledged as unreconciled

## Colors

A near-monochrome slate base carrying almost the entire interface, with saturated color admitted only for invoice status, destructive actions, and blurred background atmosphere.

The frontmatter is normative. Note that the project has **two color sources**: HSL custom properties (the token layer, in `hsl()` form) and hardcoded literals in page and export code (in hex). Both are recorded above as they exist. Collapsing the literals into the token layer is the single highest-value step toward the unified system.

### Primary
- **Near-Black Slate** (`{colors.primary}`): The interface's only real "brand" color. Every default button, the logo tile, the invoice preview's header band, and the document's 2px header rule. In dark mode primary inverts to near-white, so the same component reads as a black button on light and a white button on dark.

### Secondary
- **Signal Sky** (`{colors.atmosphere-sky}`) and **Signal Sky Light** (`{colors.atmosphere-sky-light}`): Present **only as blurred radial atmosphere** behind marketing surfaces and as a bento card's hover glow and icon tint. Sky never appears on a button, link, or focus ring anywhere in the codebase.
- **Signal Orange** (`{colors.atmosphere-orange}`): Same treatment, lower opacity (0.35–0.40), used as the counterweight glow opposite the sky spotlight.

Both are provisional. They are close relatives of the unused `--chart-1` (`hsl(18 87% 55%)`) and `--chart-2` (`hsl(199 89% 48%)`) tokens, which suggests they were once intended as a real accent pair and never promoted.

### Neutral
- **Paper** (`{colors.background}` light / `{colors.card}` for raised surfaces): The app's ground. Marketing pages override it with a slightly heavier `slate-100`; the dashboard uses a vertical `slate-100 → slate-50 → white` gradient.
- **Ink** (`{colors.foreground}`): All primary text.
- **Quiet Ink** (`{colors.muted-foreground}`): Secondary copy, table cells, eyebrows, and every uppercase micro-label.
- **Hairline** (`{colors.border}`): The workhorse. Card edges, table rules, header underline, field strokes — structure is almost entirely delegated to this one value.
- **Night** (`{colors.dark-background}`): The dark ground, identical in value to light-mode `foreground`. Cards sit two points lighter (`{colors.dark-card}`) rather than using shadow to separate.

### Tertiary
Status color is the only place color is allowed to mean something:

- **Draft** — neutral slate on `slate-100`. Deliberately colorless: a draft is an absence of state.
- **Sent** (`{colors.status-sent}` on `#DBEAFE`) — in motion, awaiting the client.
- **Paid** (`{colors.status-paid}` on `#D1FAE5`) — the one genuinely positive event in the product.
- **Overdue** (`{colors.status-overdue}` on `#FFE4E6`) — also the destructive family. Rose carries error banners, the delete button, and overdue status alike.

### Named Rules

**The Color-Is-State Rule.** Saturated color earns its place by reporting status, error, or destructiveness. It is never decoration on a control. Every interactive element in the app is slate or near-black; adding a colored primary button would break the only color convention the system currently keeps.

**The Atmosphere-Not-Object Rule.** Sky and orange exist as light, not as material — blurred radial gradients at 35–60% opacity behind content, never as a fill, border, or text color on an object. Any future promotion of sky into a real accent must be a deliberate system decision applied everywhere, not a one-off button.

**The Hand-Written Dark Rule.** There is no automatic dark derivation. Every color in page code ships with an explicit `dark:` twin. A new surface without dark variants is broken, not merely unstyled.

## Typography

**Display Font:** none loaded — Tailwind's preflight system stack
**Body Font:** `ui-sans-serif, system-ui, sans-serif` (verified in-browser)
**Document Font:** `"Segoe UI", "Helvetica Neue", Arial, sans-serif` (the exported invoice)

**Character:** Neutral and workmanlike by default, with all of the system's typographic personality concentrated in one device: the uppercase, wide-tracked micro-label. That label is the thread that runs through every register — the marketing eyebrow at `0.18em`, the table header at `0.05em`, the document's field labels at `0.06em`.

**A defect worth stating plainly:** [globals.css:64](app/globals.css:64) sets `font-family: var(--font-geist-sans), "Segoe UI", sans-serif`, but `--font-geist-sans` is never defined — there is no `next/font` import anywhere in the project. Because an undefined `var()` with no fallback is *invalid at computed-value time*, the browser discards the **entire declaration**, not just the missing family. The authored `"Segoe UI", sans-serif` fallback is therefore unreachable dead code, and `body` simply inherits Tailwind preflight's `ui-sans-serif, system-ui, sans-serif` from `html`.

The practical result is benign — that stack resolves to Segoe UI Variable on Windows and SF on macOS, which is a reasonable system pairing — but it is **not the font anyone chose**, and the intended Geist never loads. Fix it once in `app/layout.tsx` or delete the dead declaration; do not treat the current rendering as a decision.

### Hierarchy
- **Display** (600, `2.25rem → 3rem → 3.75rem` across sm/lg, line-height `1.05`): Landing hero only. Paired with `text-balance`.
- **Headline** (600, `2.25rem → 3rem`, line-height tight): Page titles on About and Pricing. The dashboard runs one step smaller at `1.875rem`.
- **Title** (600, `1.25rem`, `tracking-tight`): Card titles. The `Card` primitive defaults to `1.5rem` but is overridden downward almost everywhere it is used — treat `1.25rem` as the real value and the primitive's default as unused.
- **Body** (400, `0.875rem`, line-height `1.625`): App copy, table cells, form help. Marketing copy steps up to `1rem → 1.125rem` with `text-pretty` and a `max-w-2xl` measure.
- **Label** (600, `0.6875rem`, `0.18em`, uppercase): Eyebrow pills, section kickers. In-app variants drop to `0.75rem` at `0.025em` for table headers.

### Named Rules

**The Uppercase-Label Rule.** Small text earns legibility from letterspacing, not weight or color. Any label below `0.75rem` is uppercase with tracking of at least `0.05em` and set in `{colors.muted-foreground}`. This is the most consistent single behavior across all three registers.

**The Numbers-Are-Semibold Rule.** Every money figure — dashboard stat, table amount, preview total, document grand total — is weight 600 or 700 against 400 body text. Amounts are never the same weight as the label describing them.

## Layout

A centered single-column stack, `max-w-7xl` (1280px), with page padding that steps `1rem → 1.5rem → 2.5rem` at sm and lg. Marketing surfaces narrow their reading content further inside that container (`max-w-3xl` for prose, `max-w-2xl` for centered intros, `max-w-xl` for the pricing card) while keeping the wide container for atmosphere.

Vertical rhythm is coarse and consistent: `1.5rem` between major sections in-app, `2.5rem` on marketing pages, `1rem` inside grids. Marketing pages breathe roughly twice as much as app pages — `py-14` versus `py-8` — which is the clearest quantitative signal that the two registers were tuned separately.

Grids are Tailwind defaults at breakpoints sm 640 / md 768 / lg 1024 / xl 1280. Three recurring shapes:

- **Stat row** — `md:grid-cols-3`, equal cards, dashboard only.
- **Asymmetric hero** — `lg:grid-cols-[1.15fr_0.85fr]`, copy weighted over the visual.
- **Editor + preview** — the invoice editor's form and live preview sit side by side above `xl`, with the preview `sticky top-24`. Below `xl` the preview drops beneath the form. This is the most important responsive decision in the product and the only place a sticky element is used.

Line-item tables refuse to compress: the editor's item grid is `grid-cols-[1.6fr_120px_150px_140px_44px]` inside a `min-w-[680px]` horizontal scroll container. Numeric columns keep their pixel widths and the description column absorbs the flex.

### Named Rules

**The Preview-Stays-Visible Rule.** On `xl` and wider the invoice preview is sticky at `top-24`, clearing the 64px sticky header plus breathing room. The user must never have to scroll away from the document to edit it.

**The Scroll-Don't-Squeeze Rule.** Tabular numeric data gets a horizontal scroll container with a minimum width rather than shrinking columns or reflowing into cards. Money columns keep their pixel widths at every viewport.

## Elevation & Depth

The app is **flat**; the marketing and document registers are **lifted**. This is the sharpest unresolved split in the system.

In-app, depth is tonal and linear: a 1px `{colors.border}` hairline plus a one-step background change is how every card, table, panel, and field separates itself. Cards carry `shadow-sm` and nothing more. In dark mode shadow is abandoned entirely and separation is carried by two points of lightness between `{colors.dark-background}` and `{colors.dark-card}`.

Marketing surfaces and the exported document use large, soft, low-opacity shadows that read as a sheet of paper lifted off a desk — a 60–70px blur at ~10% opacity, no tight contact shadow. The exported document deletes its shadow, border, and radius inside `@media print`, so the lift is a screen affordance only and never reaches the printed page.

### Shadow Vocabulary
- **Resting** (`box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05)`): App cards. Barely visible; essentially a hairline reinforcement.
- **Sheet** (`box-shadow: 0 20px 60px rgba(15, 23, 42, 0.1)`): The exported invoice document and the marketing pricing card (which runs a slightly deeper `0 28px 70px rgba(2, 6, 23, 0.1)`, and `0.5` alpha in dark mode).
- **Glow** (`box-shadow: 0 20px 60px rgba(14, 165, 233, 0.12)`): Bento card hover only. The one place a shadow is tinted rather than neutral.

### Named Rules

**The Print-Strips-Depth Rule.** Every visual affordance that exists to suggest paper — shadow, radius, page background, body padding — is removed in `@media print`. The document's screen presentation and its printed presentation are deliberately different, and the printed one wins on correctness.

**The Flat-App Rule.** Task surfaces separate with borders and background steps. Reaching for a shadow inside the dashboard or editor is a signal that the border hierarchy is wrong, not that a shadow is needed.

## Shapes

Rounded but not soft. The radius scale derives from a single `--radius: 0.75rem` custom property, with `md` and `sm` computed down from it — so all three shadcn steps move together if the root changes.

- **12px** (`{rounded.lg}`) — cards, the logo tile, grouped panels. The default container corner.
- **10px** (`{rounded.md}`) — buttons, inputs, table wrappers, error banners. The default control corner.
- **8px** (`{rounded.sm}`) — defined by the scale, rarely used directly.
- **16px** (`{rounded.xl}`) — bento cards on the landing page. Sits outside the `--radius` scale as a raw Tailwind default, which is part of why marketing surfaces feel softer than app surfaces.
- **14px** — the exported document sheet. A one-off literal in the export CSS, matching nothing in the token scale.
- **Full pills** (`{rounded.full}`) — status badges, the eyebrow chip, and the header's avatar button. Reserved for things that report state or identity, never for actions.

Borders are always exactly 1px and always `{colors.border}` — with one deliberate exception: the exported document's header rule is `2px solid #0F172A`, the heaviest line anywhere in the system, and it is what makes the invoice read as a formal document rather than a web card.

### Named Rules

**The One-Hairline Rule.** Structural borders are 1px in the border token. Weight is not a hierarchy device in-app; the single 2px rule in the exported document is the only sanctioned exception, and it earns that by marking the document's masthead.

**The Pills-Report-State Rule.** Fully-rounded shapes are reserved for status, identity, and metadata. Actions use the 10px control radius. A pill-shaped button would misread as a badge.

## Components

### Buttons
- **Shape:** Control radius (10px), height 40px default, 36px small, 44px large, 40×40 icon.
- **Primary:** Near-black fill with near-white text (inverting in dark mode). Padding `8px 16px`, weight 500, `0.875rem`.
- **Hover / Focus:** Hover drops the fill to 90% opacity — a `transition-colors` only, no lift or scale. Focus is a 2px `{colors.ring}` ring at a 2px offset, which is the **only** place the blue ring token surfaces in the entire UI.
- **Outline:** 1px input-colored border on the page background, filling to `accent` on hover. The default for secondary actions and the theme toggle.
- **Ghost:** No border or fill until hover. Mobile header controls and inline table actions.
- **Destructive in practice:** The dashboard's delete button does not use the `destructive` variant — it is an outline button with rose border, text, and hover fill. The `destructive` variant exists in the primitive and is unused.

### Cards / Containers
- **Corner Style:** 12px.
- **Background:** Opaque white on light, `{colors.dark-card}` on dark. Marketing variants go translucent (`bg-white/85` to `bg-white/90`) with `backdrop-blur` so the spotlights bleed through.
- **Shadow Strategy:** `shadow-sm` in-app; see Elevation for the marketing "Sheet" treatment.
- **Border:** Always 1px hairline.
- **Internal Padding:** 24px standard. Headers that own a section rule drop to `pb-3` and add a bottom border; content areas that host tables drop to `p-0` and let the table own its own padding.

### Inputs / Fields
- **Style:** 40px tall, 10px radius, 1px input-colored stroke on the page background. Text is `1rem` on mobile and `0.875rem` from md up — an explicit choice to defeat iOS zoom-on-focus.
- **Focus:** 2px ring at 2px offset, matching buttons exactly. No border-color shift, no glow.
- **Disabled:** 50% opacity with `cursor-not-allowed`.
- **Composite fields:** `SelectField` and `DatePickerField` wrap the same stroke and radius so a popover-backed date field is visually indistinguishable from a text input at rest.

### Navigation
- **Style:** 64px sticky header, `z-40`, translucent at 85% with `backdrop-blur-md` and a 1px bottom hairline. It is the only element in the app that is both sticky and translucent.
- **Brand:** A 32px near-black rounded-lg tile holding a 16px rocket glyph, beside a two-line lockup — "Invoicey" at `1rem`/600 over "Billing OS" as an `11px` uppercase wide-tracked label.
- **Links:** `0.875rem` in `{colors.muted-foreground}`, resolving to full-contrast ink on hover. No underline, no active state.
- **Mobile:** Below md the nav collapses to a hamburger that opens a bordered panel of full-width rows; the theme toggle becomes a labelled text row rather than an icon.

### Status Pill
The system's most reused semantic component. A fully-rounded badge, `0.75rem`/600 uppercase, `4px 8px` padding, in one of four tinted pairs (see Colors → Tertiary). It appears identically in the dashboard table, the invoice modal, and the editor's live preview — and in a near-black-on-white variant inside the exported document, where the tint would not survive printing.

### Invoice Document Sheet
The product's signature artifact, defined entirely in [lib/invoice-export.ts](lib/invoice-export.ts) as a raw HTML string with inline CSS, sharing no tokens with the app.

An 880px white sheet on a `{colors.document-desk}` field, 14px radius, lifted by the "Sheet" shadow. Structure top to bottom: a masthead split between brand block and metadata column, closed by the 2px near-black rule; a two-up address grid of 10px-radius bordered boxes; a full-width line-item table with uppercase 11px headers over a 1px rule; a right-aligned 320px totals table whose grand-total row is separated by a top rule and set at `0.9375rem`/700; then notes and a hairline-separated footer. `@page` is A4 at 14mm margins.

Because the template is a raw string it does its own escaping — every interpolation passes through `escapeHtml`, `toLineBreaks`, or `toSafeImageUrl`. That is a security constraint, not a stylistic one, and it survives any redesign of this component.

### Live Preview Panel
The editor's JSX counterpart to the exported sheet — a card whose body opens with a near-black `p-5` header band in near-white text, then mirrors the document's address boxes, item table, and totals stack in app tokens. It is a **separate rendering** from the export template and the two can drift on layout and fields; only their totals rows are guaranteed identical, because both are built from `buildTotalsRows` in `lib/invoice-domain.ts`.

### Atmosphere Primitives
Two presentational components used only on marketing surfaces:

- **Spotlight** — an absolutely-positioned `blur-3xl` circle filled with a `radial-gradient(circle at center, <fill> 0%, transparent 65%)`. Composed in pairs or triples at 35–60% opacity, one sky and one orange, bled off opposite page edges.
- **GridBackground** — a 44px square grid drawn in `rgba(148, 163, 184, 0.12)`, faded by a `radial-gradient(ellipse at center, black 55%, transparent 100%)` mask so it never reaches the page edge. Always at `opacity-70`.

Both are `pointer-events-none` and purely decorative.

## Do's and Don'ts

### Do:
- **Do** write both light and dark variants for every color you introduce. There is no automatic derivation — a missing `dark:` twin is a bug that only shows up for half the users.
- **Do** separate surfaces with a 1px `{colors.border}` hairline and a one-step background change before considering a shadow. This is how every app surface currently works.
- **Do** set micro-labels uppercase, weight 600, at `0.05em`–`0.18em` tracking in `{colors.muted-foreground}`. It is the most consistent typographic behavior in the system and the closest thing Invoicey has to a signature.
- **Do** set every money figure at weight 600 or 700, heavier than the label beside it.
- **Do** give tabular numeric data a `min-w` scroll container rather than reflowing or shrinking columns.
- **Do** keep new invoice fields in sync across **both** renderings — the JSX live preview and the raw-string export template — and route their totals through `buildTotalsRows`.
- **Do** wrap every interpolation in the export template in `escapeHtml`, `toLineBreaks`, or `toSafeImageUrl`. The template is a raw string with no framework escaping.
- **Do** reach for `hsl(var(--token))` utilities (`bg-card`, `text-muted-foreground`, `border-border`) in new code rather than literal `slate-*`. The token layer already exists and matches; using it is how the two registers eventually converge.
- **Do** use the full-pill radius only for status, identity, and metadata.

### Don't:
- **Don't** put sky or orange on a button, link, border, or text. Today they exist only as blurred atmosphere, and that is the only convention holding the accent story together. Promoting sky to a real accent is a legitimate future decision — but it must be made system-wide and recorded here, not introduced one component at a time.
- **Don't** add shadows to dashboard or editor surfaces. If a card is not reading as separate, the border hierarchy is wrong.
- **Don't** introduce a fourth radius value. The scale is `--radius`-derived (8/10/12) plus the 16px bento corner and the document's 14px sheet; both existing exceptions are already one too many.
- **Don't** use border weight as a hierarchy device. Structural borders are 1px. The exported document's 2px masthead rule is the single sanctioned exception.
- **Don't** style a new surface with hardcoded `slate-*` literals plus hand-written dark twins just because the existing pages do. That pattern is the drift this system needs to stop accumulating.
- **Don't** treat the marketing atmosphere as global. Spotlights, the grid, `backdrop-blur` translucency, and 16px corners belong to marketing surfaces; carrying them into the editor would put decoration between the user and the document they are producing.
- **Don't** add a webfont to a single surface. The missing `--font-geist-sans` is a project-level defect; fix it once in `app/layout.tsx` for the whole app, or leave the system stack alone.
- **Don't** rely on the shadcn `destructive` button variant matching the app's destructive treatment. The dashboard's delete control is a rose-tinted outline button, and that is the established pattern.
