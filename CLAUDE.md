# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Package manager is **Bun** (`bun.lock`; no npm/yarn/pnpm lockfile).

```bash
bun install
cp .env.sample .env.local   # note: .env.sample, not .env.example
bun dev                     # Next dev server on :3000, Turbopack
bun run build
bun run lint                # eslint app components lib models modules --ext .ts,.tsx
```

One-off data migrations, run manually against the configured `MONGODB_URI`:

```bash
bun run migrate:provider-ids   # providerId (string) -> providerIds (array)
bun run migrate:tax-to-gst     # tax -> cgst/sgst
bun run migrate:purge-tokens   # $unset User.accessToken / User.refreshToken
bun run migrate:invoice-numbering  # backfill financialYear/invoiceNumberKey; reports duplicates
```

The first two preserve the legacy field rather than dropping it, so legacy and current document shapes coexist in production data. `migrate:purge-tokens` is deliberately the opposite — the fields held Firebase ID and refresh tokens (the latter never expires), so destroying them is the entire point. It needs `strict: false` on the update because the paths no longer exist in the schema.

**Tests use Bun's built-in runner** (`bun test`; `@types/bun` provides the types). Characterization tests live in `tests/` covering the money math, the legacy `tax` fallback, export escaping/CSV-injection, AI normalization, the API client, and the account-linking security rule. Run one file with `bun test tests/<name>.test.ts` or one case with `bun test -t "<name>"`. Verification is `bun run typecheck` (`tsc --noEmit`), `bun test`, `bun run lint`, plus the manual QA checklist in the README.

**Node 24+ / SlowBuffer shim:** `firebase-admin` pulls in the ancient `buffer-equal-constant-time` (via gtoken → jws → jwa), which reads `require('buffer').SlowBuffer.prototype` at module load. Node 24+ removed `SlowBuffer`, so this throws "Cannot read properties of undefined (reading 'prototype')" and crashes every route that imports firebase-admin (auth + AI) plus `next build`'s page-data collection. Bun (the Docker runtime) still ships SlowBuffer, so production was unaffected — this only bit local dev/build on newer Node. Fixed by `lib/server/node-compat.ts`, a side-effect shim that aliases `SlowBuffer` to `Buffer`; it is imported **before** `firebase-admin` at the top of `lib/firebase-admin.ts` (import order matters — keep it first). Session tokens are minted with `jose` (not `jsonwebtoken`, which pulled in the same broken dependency) via `lib/server/session-token.ts`.

## Architecture

Next.js 16 App Router, React 19, TypeScript strict, MongoDB/Mongoose, Firebase Auth, Tailwind 3 + shadcn/ui. Path alias `@/*` maps to the repo root, not `src/`.

**No server actions.** All server-side work happens in route handlers under `app/api/`. Essentially every page is `"use client"` and fetches with `Authorization: Bearer <Firebase ID token>`, despite `components.json` declaring `"rsc": true`. `lib/mongodb.ts` exports `connectDB()`, which each handler calls itself — there is no middleware doing it.

`app/api/invoices/route.ts` serves the entire resource from one file: `GET` (list, or single via `?id=`), `POST`, `PUT ?id=`, and `PATCH` with `action: "settle" | "soft_delete"`. Collection and item share a route, disambiguated by the `id` query param.

### The invoice has three shapes

Conversions live only in `lib/invoices.ts` — go through them rather than hand-mapping:

- `InvoiceRecord` — DB/API shape; items are `{name, price, quantity}`
- `InvoiceFormState` — UI shape; items are `{description, unitPrice, quantity}`
- `InvoicePayload` — wire shape

Use `mapInvoiceRecordToFormState`, `mapFormStateToPayload`, and `createDefaultInvoiceFormState`. The API's `normalizeItems` ([route.ts:116](app/api/invoices/route.ts:116)) additionally accepts both item shapes defensively.

### Totals and validation are unified in `lib/invoice-domain.ts`

`computeTotals` is the single money formula. `calculateInvoiceTotals` (the editor preview), `normalizePayload` (the authoritative server path — it never trusts client numbers), and `resolveRecordAmounts` (the exporters) all delegate to it. `resolveRecordAmounts` also owns the legacy `?? tax` fallback and honors server-stored `subtotal`/`total` with `??`. The preview and both exporters render their totals section from `buildTotalsRows`, so the rows cannot drift in label/order/amount. `validateInvoice` is the one validator, shared by `InvoiceEditor.saveInvoice` and the API. Adding a money field still means touching `models/Invoice.ts`, the form state, the AI normalizer/patch, and the wire types — but the arithmetic and validation now live in one place.

Formula: `subtotal - discount + cgst + sgst + convenienceCharge`, clamped at 0, each step `toFixed(2)`.

`convenienceCharge` is labeled "Service Charge" in all user-facing output.

`buildLineItemColumns` includes a **Taxable Value** column (Rule 46(j)) whenever
tax is charged or a discount moved a line's taxable value off its gross — without
it the printed row read `Rate 18 | Tax 174.00 | Amount 1000.00`, where Amount is
the GROSS, and the table did not reconcile. `Amount` stays gross; rate × taxable
= tax exactly.

### Numeric fields are text inputs

Every number in the editor (Qty, Unit price, Discount, Service Charge, CGST,
SGST) goes through `components/ui/numeric-input.tsx`, never a raw
`<input type="number">`. Binding a number input straight to numeric state made
fields impossible to clear — backspacing to `""` fell back to the minimum and
the next keypress appended to it (`1` → `12`, `18`, `19`) — and silently ate
partially typed decimals, because `type="number"` reports `""` for both a
cleared field and `"12."`.

`NumericInput` is a text input with `inputMode`, holding the raw keystrokes in a
draft string while focused and handing the parent only numbers. All of its
decision logic is pure and tested in `lib/numeric-input.ts` (`tests/numeric-input.test.ts`);
the component is just the DOM adapter. The rules that matter if you touch it:
the **floor is applied on blur** (applying it per keystroke is the original bug),
the **ceiling and rounding are applied per keystroke**, an empty draft publishes
the field minimum rather than 0 (a blank Qty must not momentarily zero the
subtotal and, through the percent-mode effects, the stored CGST/SGST), and the
draft is dropped whenever the value changes from outside (AI patch, row removal,
%/₹ toggle). Do not re-add clamping in the parent `onValueChange` — a second
clamp makes the value differ from what the field published and wipes the draft
mid-typing.

`MAX_ITEM_QUANTITY` / `MAX_ITEM_UNIT_PRICE` / `MAX_MONEY_VALUE` live in
`lib/invoice-domain.ts` and are enforced in three places: the fields,
`mapFormStateToPayload`, and the API's `normalizeItems`/`normalizePayload`.

### CGST/SGST vs legacy `tax`

Writes use `cgst` + `sgst`. Read paths keep `?? tax` fallbacks ([lib/invoices.ts:220](lib/invoices.ts:220) for the form mapper, and `resolveRecordAmounts` in `lib/invoice-domain.ts` for the exporters) — load-bearing because the migration intentionally leaves `tax` in the database. Percent-vs-amount is UI-only state in `InvoiceEditor`; only the resolved amount is persisted, so an edited invoice always reopens in amount mode.

The AI prompt now advertises `cgst`/`sgst` (matching `normalization.ts`/`apply-patch.ts`), and a prompt rule tells the model to split a single "tax" request evenly across CGST and SGST. Keep the field set identical across `prompt.ts`, `contracts.ts`, `normalization.ts`, and `apply-patch.ts`.

### Invoice numbering is enforced (Rule 46(b))

`lib/invoice-number.ts` is the pure module; it is now wired everywhere that
matters. The number is **not** generated in the browser any more — the old
`INV-${Date.now().toString().slice(-6)}` cycled every 16m40s.
`createDefaultInvoiceFormState` leaves it blank and `InvoiceEditor` seeds it from
`GET /api/invoices?suggest_number=1&date=…` in the same effect that fetches the
profile (one effect, one `setInvoice`, so the two cannot race on the same field).

`validateInvoice` runs `checkInvoiceNumber` and returns the specific rule broken.
`normalizePayload` stores `financialYear` (from the invoice DATE, IST civil date)
and `invoiceNumberKey` (whitespace-stripped, upper-cased); neither is ever read
from the request. `models/Invoice.ts` carries a **full** unique index
`{ userId, financialYear, invoiceNumberKey }` — not partial, because nothing is
hard-deleted and a soft-deleted number must stay spent. E11000 becomes a 409
naming the number, the year and the next free number. The suggester counts
soft-deleted rows for the same reason.

**Before that index can exist in production**: `bun run migrate:invoice-numbering`
backfills both fields and REPORTS duplicates instead of renumbering (renumbering
changes a document the client already holds — the only irreversible act here).

### Registration status gates the GST language

`exportEndorsementFor` and the LUT-ARN validation rule are both gated on
`taxTreatment === "gst"`. An unregistered supplier exporting services issues a
plain INVOICE: no Rule 46 endorsement, no LUT prompt, no tax rows. Both
endorsements are declarations made under a registration, so printing either over
a document with no GSTIN on it is a false statement. Same for composition.

### The legacy tax arm belongs to legacy RECORDS

An absent `taxTreatment` puts `computeTotals` on the legacy arm, where the
invoice-level `cgst`/`sgst` are taken from the client verbatim. That is only
legitimate for a document written before Phase 2, so "is this legacy?" is
answered from the STORED DOCUMENT, never from the request: POST always requires
`taxTreatment`, and PUT accepts its absence only when the record being updated
has none of its own.

### Line rates are whitelisted at validation, not dropped

A `taxRatePercent` that is not a GST slab used to be silently omitted by the
API's `normalizeItems`, saving an untaxed invoice under a preview that had shown
the tax. The rate is now carried through and `validateInvoice` rejects it
(`UNKNOWN_GST_RATE_ERROR`). Retired slabs (12, 28) still pass, with a warning.
The AI normalizer still DROPS what it cannot accept — untrusted model output is
a different concern from a user's own input.

### Nothing is ever hard-deleted

Every read filters `is_deleted: { $ne: true }`; deletion is a `PATCH` with `action: "soft_delete"`.

### Auth

The **Firebase ID token is the real authorization**, minted client-side by the Firebase SDK on every request. A `jose` HS256 session token is also minted and stored client-side, but never verified server-side.

**No Firebase token is ever persisted.** `User.accessToken` / `User.refreshToken` and their JS-readable `access-token` / `refresh-token` cookies are gone — nothing read them back, and a stored refresh token never expires, so a database dump was a permanent account-takeover kit. `UserSessionManager`'s constructor purges those two legacy cookie/localStorage keys, because dropping the writer does not drop a cookie a returning browser already holds. Do not reintroduce a token field on `User`.

Request auth is one shared helper: `requireUser(req)` in `lib/server/auth.ts`, imported by both API routes. It throws a typed `AuthError { code, status }` (no more sentinel-string matching), and `authErrorResponse(error, messages?)` maps it to a response with optional per-route copy. Do not re-copy this into new routes — import it.

`lib/auth-user-sync.ts` is the single funnel for the auth-mint routes. It only links accounts by **email when the token's email is verified** (`decodedToken.email_verified`); an unverified token is matched by `uid` only, so it cannot adopt another account or trigger the `Invoice.updateMany` reassignment (this closes an email-based account-takeover). `lib/user-profile.ts` owns `normalizeAvatarUrl` and `sanitizeProviderId`; reuse them.

Email verification is gated in three layers: client-side via `requiresEmailVerification` in `lib/auth-client.ts`, in `requireUser` (403 for unverified password accounts) on the data routes, and again at the top of `/api/auth/session` before user sync.

Client API calls go through `lib/api-client.ts` (`authedFetch` + typed `invoicesApi`/`aiApi`). It awaits `auth.authStateReady()` before reading `auth.currentUser` (fixes the hard-refresh bounce to `/auth`), attaches the Bearer token, and converts failures to typed `ApiError` / `UnauthenticatedError`. Components handle those two error types; do not hand-roll `auth.currentUser` + fetch in new code.

Client session state is `modules/UserSessionManager.ts` — a getter/setter class over `js-cookie` and `localStorage`, instantiated fresh wherever needed. There is no React context or provider.

### AI invoice assistant

`lib/ai/invoice-assistant/` — Gemini called via plain `fetch` against the REST endpoint; there is no AI SDK dependency. Config: `GEMINI_API_KEY`, `GEMINI_MODEL`, `INVOICE_AI_PROVIDER` (only `"gemini"` is supported).

Six single-responsibility files: `contracts.ts` (types), `prompt.ts` (system prompt + user prompt builder), `provider.ts` (the HTTP call), `normalization.ts` (parses and hard-validates every field of the model output), `service.ts` (orchestration and request caps), `apply-patch.ts` (client-side merge into form state).

**The assistant never writes to the database.** It returns a patch that `InvoiceEditor.applyAiPatch` merges into in-memory form state; the user still has to save. The panel renders only when `mode === "create"`.

### Export and PDF

There is no PDF library. `lib/invoice-export.ts` builds a self-contained HTML string, and "PDF export" is a Blob → `window.open` → `window.print()`, letting the browser's Save-as-PDF do the work. Four formats: PDF(print), HTML, CSV, JSON.

Because the template is a raw string, it does its own escaping — keep every interpolation wrapped in `escapeHtml`, `toLineBreaks`, or `toSafeImageUrl` (protocol allowlist). CSV cells also pass through `neutralizeCsvValue` to defuse spreadsheet formula injection (leading `= + - @` etc.).

`InvoiceEditor` also renders a **separate live preview in JSX**. The two renderings are still independent for layout/fields, but their **totals section is driven by the shared `buildTotalsRows`** (from `lib/invoice-domain.ts`) so the numbers, labels, and order cannot drift. Keep new invoice fields in sync across both renderings.

### No state or form libraries

Plain `useState`/`useMemo`/`useCallback`; no Redux, Zustand, or Context. No react-hook-form or Zod (deliberately — the fix for the old triplicated validation was one shared `validateInvoice` in `lib/invoice-domain.ts`, not a schema library). `InvoiceEditor.saveInvoice` and the API both call `validateInvoice`; `normalization.ts` still hard-validates the AI model output separately (a different concern — untrusted model JSON).

Nearly all invoice UI behavior lives in one large `components/InvoiceEditor.tsx` with a `mode: "create" | "edit"` prop; the `app/create-invoice/` pages are thin shells around it.

Theming is custom (`lib/theme.ts`): `THEME_INIT_SCRIPT` is injected `beforeInteractive` in `app/layout.tsx` to avoid FOUC, class-based dark mode, `localStorage` key `invoicey-theme`. Every component writes its `dark:` variants manually.

## Gotchas

- **One Tailwind config, one PostCSS config — keep it that way.** `tailwind.config.js` (dark mode, shadcn HSL tokens, `tailwindcss-animate`, the `./lib/**` glob) and `postcss.config.js` (`tailwindcss` + `autoprefixer`) are the only ones. The shadowed duplicates that used to sit beside them (`tailwind.config.ts`, a stub with none of the theme; `postcss.config.mjs`, which omitted `autoprefixer`) were deleted — verified via `postcss-load-config`, which resolves `postcss.config.js` ahead of `.mjs`, so the `.mjs` never ran and its missing autoprefixer never bit. Do not reintroduce a second config in another extension: whichever one loses is silently ignored, and for PostCSS the loser/winner flip drops every vendor prefix.
- The Dockerfile builds with `bunx next build --webpack` deliberately for container stability, while `bun dev` uses Turbopack — build behavior differs between local dev and Docker.
- Icons come from `@radix-ui/react-icons` in practice, though `components.json` declares lucide.
- `connectDB()` now throws on connection failure (so one request 500s) instead of `process.exit(1)`. It still lacks a cached connection promise — deferred.
- `models/Invoice.ts` has a `{ userId, is_deleted, createdAt }` compound index. The list endpoint is still unpaginated (deferred).
- `eslint-config-next` is pinned to 15.x while Next is 16.x (bump deferred).
- `.gitignore` ignores `CLAUDE.md` and `AGENTS.md`; this file is intentionally local-only.
