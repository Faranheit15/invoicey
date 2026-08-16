# Invoicey — UX, Mobile-Readiness & Accessibility Audit

## Top 10 to fix before releasing publicly

| # | Finding | Where | Severity | Size |
|---|---|---|---|---|
| 1 | **"Print / PDF" is broken for everyone, on every device.** `window.open(url, "_blank", "noopener,noreferrer")` returns `null` on *success* per the HTML spec, so the code always takes the popup-blocked branch: it revokes the blob URL while the new tab is still loading it, and shows a red banner falsely blaming the user's popup blocker. The only path to a client-ready PDF is non-functional. | `components/InvoiceModal.tsx:76-96` | BLOCKER | S |
| 2 | **No privacy policy, no terms, no data story — anywhere.** Zero hits for "privacy"/"terms" in `app/` or `components/`. The footer has no links at all. Users are asked for their own bank account, IFSC and UPI ID plus their clients' addresses. This also blocks Google OAuth verification (a published consent screen requires a privacy-policy URL) and fails DPDP Act notice requirements. | `components/ui/footer.tsx:1-10`, `app/auth/page.tsx:714-717` | BLOCKER | M |
| 3 | **The hero fakes a Y Combinator endorsement.** `!Backed by` + the YC wordmark, styled identically to the two genuine claims beside it. The `!` is a programmer joke nobody else reads; it is also unlicensed trademark use, and `PRODUCT.md` names fabricated proof "the one unrecoverable mistake". | `components/landing.tsx:55-75`, `public/y-c.png` | BLOCKER | S |
| 4 | **There is no way to send an invoice from a phone.** No `navigator.share`, no `mailto:`, no WhatsApp link — grep confirms zero. After (1) is fixed the user still ends up with a `.html`, `.csv` or `.json` in their Downloads folder, none of which an Indian client will accept over WhatsApp, the delivery norm for this audience. | `components/InvoiceModal.tsx:71-132` | BLOCKER | M |
| 5 | **No GST compliance fields at all.** No GSTIN (supplier or recipient), no HSN/SAC, no IGST for inter-state supply, no place of supply, and the document is titled "INVOICE" rather than "Tax Invoice". A GST-registered freelancer — the stated primary user — cannot use the output, and a user billing another state has to misfile IGST as CGST+SGST. | `lib/invoices.ts:54-76`, `models/Invoice.ts`, `lib/invoice-export.ts:328` | BLOCKER | M |
| 6 | **The product has no memory between invoices.** Company name, address, email, phone, logo and bank/UPI details are blank on every new invoice; so is every client. There is no duplicate action. Invoice #12 costs exactly as much as invoice #1 — which is the strongest structural reason a user does not come back. | `lib/invoices.ts:127-155` | BLOCKER (retention) | M |
| 7 | **One back-swipe destroys everything.** No `beforeunload`, no route-change guard, no `localStorage` draft. "Back to dashboard" is a bare `router.push`, and on Android the gesture back does the same. Ten minutes of typing, or an accepted AI draft, gone with no confirmation. | `components/InvoiceEditor.tsx:389` | HIGH | S |
| 8 | **Google sign-in is behind a tab and popup-only.** Email is the default tab, so the fastest path costs an extra tap and steers first-timers into an inbox-verification round trip instead. `signInWithPopup` is blocked or broken in the in-app webviews (WhatsApp, Instagram) this audience arrives through; the code detects `auth/popup-blocked` but has no `signInWithRedirect` fallback. | `app/auth/page.tsx:264-276`, `:502-511` | HIGH | S |
| 9 | **The landing page's primary CTA is white on near-white.** `bg-white` on `PageShell`'s `bg-slate-100` ground = **1.08:1** with no border and no shadow (WCAG 1.4.11 wants 3:1), and its hover state is *exactly* the page background, so it vanishes on hover. Light mode only, which is how it survived. The secondary button beside it has a border and therefore reads as the more important control. | `components/landing.tsx:112-121` vs `components/ui/page-shell.tsx:26` | HIGH | S |
| 10 | **Saving on a phone is a scroll-and-guess loop.** The save buttons sit at the top of a ~2,400px form; validation returns one error at a time, renders it at the top, and never focuses or scrolls to the offending field. A blank form takes up to six scroll-up → read → scroll-down → fix cycles. No sticky action bar. | `components/InvoiceEditor.tsx:271-305`, `:402-439`, `:454-458` | HIGH | M |

**Next five, in order:** the AI assistant — the product's stated wedge — is hidden behind a secondary
button, unavailable in edit mode, taught with three USD/EUR examples, and prints raw field names
(`billTo`, `items`) at the user (`components/InvoiceAiAssistant.tsx:22-26`, `:291-298`,
`InvoiceEditor.tsx:78`); the dashboard has no search, filter or sort while the admin panel has all
three (`app/dashboard/page.tsx`); `prefers-reduced-motion` is honoured only in `components/admin/`;
loading skeletons likewise exist only for the admin while customers get bare spinners; and the Status
dropdown silently loses to the Save Draft / Create buttons (`InvoiceEditor.tsx:660-678` vs `:414-438`).

---

## Scope and method

Scope: static read of the repo at `/home/faran/projects/invoicey` (branch `develop`, HEAD `bd0f249`).
Audience assumed: India-first solo operators — freelancers, consultants, small-business owners — many
of them mobile-first Android users on mid-range phones, none of them accountants.

Severity key: **BLOCKER** (must not ship publicly as-is) / **HIGH** / **MEDIUM** / **POLISH**.
Size key: S (< half a day) / M (1–3 days) / L (a week or more).

A note on prior work: this codebase has clearly already had a design/a11y hardening pass
(`AlertBanner` live regions, `pointer: coarse` 44px tap targets in `app/globals.css:106-126`,
safe-area insets, `NumericInput`, `MicroLabel`/`PageShell` primitives). The findings below are
what is genuinely *still* between a first-time visitor and a sent invoice — not a generic checklist.

---

## 1. First run / onboarding

### 1.1 The landing page fakes a Y Combinator endorsement — BLOCKER (S)
`components/landing.tsx:55-75` renders `!Backed by` next to `public/y-c.png`, the Y Combinator
wordmark, as the first and largest of three "quips" in the hero, styled identically to the two
genuine statements beside it.

The joke is the leading `!` (programmer negation). Nobody outside that idiom reads it that way — a
freelancer in Pune scanning a hero sees the YC logo in a claim row on a billing product. It is also
unlicensed use of YC's trademark. `PRODUCT.md` names fabricated proof "the one unrecoverable
mistake" and lists no funding; this surface contradicts the product's own charter.

**Fix:** delete the quip and `public/y-c.png`. If the self-deprecating register is worth keeping,
say it in words: "Not backed by anyone. Funded by coffee."

### 1.2 No privacy policy, no terms, nowhere — BLOCKER (M)
`grep -rni "privacy|terms of service|gdpr|data protection"` over `app/` and `components/` returns
**zero** hits. `components/ui/footer.tsx:1-10` is a copyright line and a tagline with no links at
all. `app/auth/page.tsx:714-717` substitutes: *"By continuing, you agree to use Invoicey for lawful
invoicing and account management purposes."* — which is a rule for the user, not a commitment from
the product.

This is disqualifying for a public Indian launch on three counts:
- Google's OAuth verification requires a published privacy-policy URL on the consent screen before
  an app leaves testing mode; `signInWithPopup` with a Google provider (`app/auth/page.tsx:269-270`)
  will be capped at the unverified-app screen and 100 users without it.
- India's DPDP Act 2023 requires a notice at the point of collection.
- The user is about to type *their client's* name, address, email and bank/UPI details
  (`components/InvoiceEditor.tsx:1026`) into a site they have never heard of. There is no "where
  does my data live" story anywhere — not on `app/about/page.tsx`, not on `app/pricing/page.tsx`,
  not on `app/contact/page.tsx`.

**Fix:** ship `/privacy` and `/terms` (short, honest, solo-project register — "your invoices live in
a MongoDB instance I run; I don't sell anything; deletion is a soft delete and here is what that
means"), link both from the footer and from the auth card, and add a one-paragraph data section to
`/about`.

### 1.3 "Nothing between sign-in and the first invoice" is true of the routing and false of the experience — HIGH (M)
`PRODUCT.md` principle 2 is honoured literally: there is no wizard, and
`app/dashboard/page.tsx:387-400` gives a decent empty state ("Your first one takes about a minute —
or describe the job in a sentence and let the assistant fill it in") with a single primary CTA.

But the CTA lands on `components/InvoiceEditor.tsx` with `createDefaultInvoiceFormState()`
(`lib/invoices.ts:127-155`), which pre-fills only the invoice number, the two dates, terms, and
currency. Everything else is blank. Counting the create form: 5 seller fields, 3 client fields, 6
invoice fields, 3 per line item, 4 money fields, 2 notes fields — **~23 inputs**, all in one
`<CardContent>` (`InvoiceEditor.tsx:473-1047`). Below `sm` (640px) every `sm:grid-cols-2` collapses,
so a 360px Android phone gets ~23 stacked controls plus a full-height Live Preview card underneath.
That is the "large blank form" the brief suspected.

Three things would remove most of it and none is a wizard:
1. **Remember the seller** (see 2.1) — kills 5 of 23 fields on invoice #2 onward.
2. **Open the AI panel by default on the first invoice.** `InvoiceEditor.tsx:78` initialises
   `isAiPanelVisible = false`, so the product's stated wedge ("AI drafting is the wedge",
   `PRODUCT.md` Positioning) is hidden behind a secondary outline button labelled "Show AI
   Assistant", third in a row of three at `InvoiceEditor.tsx:404-412`. A first-time user never
   discovers it.
3. **Progressive disclosure**: collapse "Discounts & Tax" and "Payment & Notes" behind a summary row
   when they are at their defaults.

**Fix (S, high leverage):** default `isAiPanelVisible` to `mode === "create"` when the user has zero
saved invoices, and label the button "Draft with AI" rather than "Show AI Assistant".

### 1.4 There is no sample invoice and no template — HIGH (M)
No fixture, seed, or "try an example" path exists anywhere in the repo. A first-time user has no way
to see what the finished artifact looks like before committing 23 fields of typing. The Live Preview
partly covers this, but it starts as a skeleton of placeholders ("Your Company", "Client name",
"INV-XXXXXX") rather than a filled example.

**Fix:** a "Fill with a sample" link in the empty editor that loads a realistic Indian invoice into
form state (unsaved). One function, no schema change, and it doubles as the demo `PRODUCT.md` says
the product must lean on in place of social proof.

### 1.5 Google sign-in is behind a tab, and uses a popup — HIGH (S)
`app/auth/page.tsx:502-511` puts Email first and Google second in a `Tabs` control, so the fastest
path for the target user costs an extra tap and is invisible until then. Worse, email signup forces
an inbox round-trip before any data route will answer (`requiresEmailVerification`, three enforcement
layers per `CLAUDE.md`), so the tab order steers first-timers into the slowest possible onboarding.

`handleGoogleSignIn` uses `signInWithPopup` (`app/auth/page.tsx:270`). On Android Chrome, and
especially inside the in-app webviews Indian users arrive through (WhatsApp, Instagram, LinkedIn),
popups are blocked or open a window that cannot post back to the opener. The code has a message for
`auth/popup-blocked` (`app/auth/page.tsx:120-121`) but no fallback — the user is told to "enable
popups" on a browser where they often cannot.

**Fix:** promote "Continue with Google" to a full-width button *above* the tabs, and fall back to
`signInWithRedirect` on `auth/popup-blocked` / `auth/cancelled-popup-request`, or detect a webview
UA and use redirect outright.

### 1.6 Landing page never mentions India, GST, INR, or the AI assistant — HIGH (S)
`components/landing.tsx:20-53` lists four feature cards: Invoice Studio, One-Click Export,
Client-Ready Design, Dashboard + Edit Flow. The word "tax" appears once (`landing.tsx:24`); "GST",
"India", "INR", and "AI" appear nowhere on the page. The hero preview does show `₹2,48,400` with
correct lakh grouping (`landing.tsx:191`) — the only India signal on the whole site.

Per `PRODUCT.md` the two truthful differentiators are AI drafting and GST-as-default. The landing
page advertises neither.

**Fix:** replace the "Client-Ready Design" card with the AI drafting flow, and put GST/INR in the
subhead.

### 1.7 Pricing copy undercuts its own promise — MEDIUM (S)
`app/pricing/page.tsx:26-29`: "Invoicey is currently free to use **while we polish the platform for
public launch**." That reads as a trial. `PRODUCT.md` states pricing is "$0, indefinite" and that
trial framing must not be designed. The price is also rendered `$0` (`pricing/page.tsx:40`) on an
India-first product, and the "Support Invoicey" Buy Me a Coffee link (`pricing/page.tsx:59-61`)
carries no `target`/`rel` and no external-link cue.

**Fix:** "Free. No invoice caps, no feature gates, no paid tier to upgrade to." Render the price as
"₹0" or just "Free".

### 1.8 Signed-out landing offers "Go to Dashboard" — POLISH (S)
`components/landing.tsx:122-129` shows a secondary CTA to `/dashboard` to everyone. A logged-out
visitor who taps it gets a flash of the dashboard shell and then a redirect to `/auth`
(`app/dashboard/page.tsx:69-77`). Render it only when a session exists, or drop it.

---

## 2. The invoice editor (`components/InvoiceEditor.tsx`, 1177 lines)

### 2.1 Company details are retyped on every single invoice — BLOCKER for retention (M)
`lib/invoices.ts:127-155` returns empty strings for `companyName`, `companyEmail`, `companyPhone`,
`companyAddress`, `companyLogo`, and `paymentInfo`. Nothing in the repo persists a seller profile —
`models/User.ts` holds auth identity only, and there is no `/api/profile` route. So on invoice #2,
#3, #12, the user retypes their own company name, address, email, phone, logo URL, and their bank
account + IFSC + UPI ID (`InvoiceEditor.tsx:1026`).

`PRODUCT.md` says success is "a user who ... comes back next month because the workflow did not cost
them anything." Retyping your own bank details every month is precisely that cost. This is the
single largest thing standing between this product and a second session.

**Fix:** on save, write the six seller fields onto the user document; seed
`createDefaultInvoiceFormState()` from them. No new UI needed — the fields stay editable and
pre-filled. A "Business details" section on a settings page is the polished version, but the
auto-remember alone recovers most of the value and honours "setup steps are a defect".

### 2.2 No unsaved-changes guard anywhere — HIGH (S)
"Back to dashboard" is a bare `router.push("/dashboard")` (`InvoiceEditor.tsx:389`). There is no
`beforeunload` listener, no route-change interception, no confirm. On Android the hardware/gesture
back button does the same thing. A user who has just spent ten minutes filling 23 fields — or who
just accepted an AI draft — loses all of it to one back-swipe, with no draft persistence to fall
back on (nothing writes form state to `localStorage`).

**Fix:** `beforeunload` when the form is dirty, plus a `ConfirmDialog` on the Back button. The
component already has `ConfirmDialog` available from `components/ui/modal.tsx`. Autosaving the draft
to `localStorage` keyed by mode/invoiceId is the stronger version (M).

### 2.3 The editor is not a `<form>` — HIGH (S)
There is no `<form>` element in the file; save is `onClick` on two `Button`s
(`InvoiceEditor.tsx:417`, `424`). Consequences on a phone: the on-screen keyboard's Go/Done key does
nothing, browser autofill can't recognise the address/email cluster as a group, and there is no
native submit path for keyboard users. It also means `Enter` in any text field is inert, which
desktop users will try.

**Fix:** wrap `CardContent` in a `<form onSubmit>` and make the primary button `type="submit"`; make
every other button explicitly `type="button"` (several already are).

### 2.4 Two competing controls set the same status, and the dropdown silently loses — HIGH (S)
`InvoiceEditor.tsx:660-678` exposes a **Status** select (Draft / Sent / Paid / Overdue) inside
"Invoice Details". `InvoiceEditor.tsx:414-438` also has **Save Draft** and **Create Invoice**
buttons, which call `saveInvoice("draft")` and `saveInvoice("sent")` — overwriting whatever the
select says (`saveInvoice` line 262 takes `status` and `mapFormStateToPayload({...invoice, status})`
at line 312-315).

So: set Status to "Paid", press "Save Draft", get a draft. Set it to "Paid", press "Create Invoice",
get a sent invoice. The user's explicit choice is discarded with no feedback. "Overdue" as a
manually-selectable status is also meaningless — it is derived from the due date
(`lib/invoices.ts:275-287`).

**Fix:** delete the Status select from the create/edit form. Status belongs to the lifecycle
(Save Draft / Send / Settle), not to a field. In edit mode, show status as read-only text with the
existing Settle action.

### 2.5 Validation is first-error-only, at the top, with no focus move — HIGH (M)
`saveInvoice` (`InvoiceEditor.tsx:271-305`) runs seven sequential guards, each `return`ing on the
first failure. The messages themselves are excellent — genuinely the best copy in the app ("Add your
company name — it appears at the top of the invoice"). The mechanics are not:

- Only one error is shown at a time. A blank form takes up to **six** submit → read → scroll → fix →
  submit cycles.
- The banner renders at `InvoiceEditor.tsx:454-458`, above the form. The offending field is not
  focused, not scrolled into view, and carries no `aria-invalid` or `aria-describedby`. On a 360px
  phone the "Client billing address" field is roughly 1,400px below the banner.
- The save buttons live in the *page header* (`InvoiceEditor.tsx:402-439`), so on mobile the user
  must scroll to the very top to save, read the error, then scroll back down. There is no sticky
  action bar.

**Fix:** validate all fields at once, mark each with `aria-invalid` + an inline message, and
`focus()`/`scrollIntoView()` the first invalid control. Add a sticky bottom action bar below `sm`
(`sticky bottom-0` with safe-area padding) carrying Save Draft + Create.

### 2.6 The AI assistant — the stated wedge — is hidden and unavailable when editing — HIGH (S)
`isAiPanelVisible` defaults to `false` (`InvoiceEditor.tsx:78`) behind a button labelled "Show AI
Assistant", rendered as the *first of three* outline buttons in the header row, and only in
`mode === "create"` (`InvoiceEditor.tsx:403`). A first-time user has no reason to press it and no
preview of what it does. See 1.3.

Because the panel only exists in create mode, the natural repeat-user flow — "open last month's
invoice, tell the AI to change it for this month" — is impossible.

### 2.7 The CGST/SGST %/₹ toggle is ambiguous and hardcodes the rupee — MEDIUM (S)
`InvoiceEditor.tsx:924-947` (and the SGST twin at `982-1005`) renders a toggle button whose face is
`%` when in percent mode and `₹` when in amount mode. It is unclear whether the glyph reports the
current mode or the action it performs — the `aria-label` gets it right ("CGST entered as a
percentage. Switch to a fixed amount.") but the visible glyph does not.

The glyph is a literal `"₹"` (lines 946, 1004) regardless of `invoice.currency`. Select USD and the
toggle offers "₹" while every amount beside it renders as `$`.

**Fix:** replace with a two-segment control reading `%` | `₹` with the active segment filled, and
source the symbol from `CURRENCY_SYMBOLS[invoice.currency]` (`lib/invoices.ts:104-110`).

### 2.8 The "Remove item" buttons are indistinguishable to a screen reader — MEDIUM (S)
Description and quantity get indexed labels (`Line ${index + 1} description`,
`InvoiceEditor.tsx:732`, `741`), but both remove buttons are a flat `aria-label="Remove item"`
(lines 771 and 846). A user on TalkBack or NVDA with five line items hears five identical buttons.

**Fix:** `aria-label={`Remove line ${index + 1}`}`.

### 2.9 Keyboard flow, in order — MEDIUM
Tab order follows DOM order and is sane. Real gaps:
- No `Enter` submit (2.3).
- No keyboard shortcut or focus move after "Add Item" (`InvoiceEditor.tsx:698`): the new row is
  appended below and focus stays on the button, so a keyboard user must Tab through every existing
  row to reach it. Fix: `ref` the new description input and focus it.
- The `%`/`₹` toggle sits *between* the tax amount field and the next field in tab order, so tabbing
  through the money section hits four extra buttons.
- `DatePickerField` (`components/ui/date-picker-field.tsx:111`) passes `initialFocus`, which is a
  **react-day-picker v8 prop removed in v9** (this repo is on `react-day-picker ^9.14.0` and the
  calendar at `components/ui/calendar.tsx:21-53` uses the v9 `classNames` API). The prop is silently
  ignored; the v9 equivalent is `autoFocus`. Radix's Popover still focuses the panel, so this is a
  degradation rather than a break, but the day grid is not focused on open.
- There is no way to *type* a date. Picking a due date 60 days out is two month-nav taps minimum,
  and the trigger is a button, so a user who knows the date cannot enter it.

### 2.10 Field grouping and cognitive load — MEDIUM (M)
Six sections in a fixed order: Seller (5) → Client (3) → Invoice Details (6) → Line Items → Discounts
& Tax (4) → Payment & Notes (2). The ordering is backwards for the job: the user opened the app to
bill *someone for something*, and the first thing asked is their own logo URL.

Required vs optional is marked only by the presence of an `(optional)` suffix
(`components/ui/field.tsx:60-69`) — a well-executed inverse convention, but three genuinely required
fields do not use `Field` at all and get bare `<label>`s (Discount, Service Charge, CGST, SGST at
`InvoiceEditor.tsx:863-1012`), so the convention breaks exactly where the money is. Those four are
in fact optional and are not marked as such.

**Fix:** reorder to Client → Line Items → Totals → Your details → Notes; move the four money fields
onto `Field` with `optional`; collapse "Discounts & Tax" and "Payment & Notes" when at defaults.

### 2.11 The Live Preview masthead breaks when a logo is set — MEDIUM (S)
`InvoiceEditor.tsx:1058-1080` is a `flex items-center justify-between` row with three children where
the logo is rendered *between* the invoice number and the status pill. With a logo present the
`justify-between` distributes number | logo | pill, putting the brand mark in the middle of the
masthead — which matches neither the exported document (`lib/invoice-export.ts:321-345`, where the
logo sits left, beside the company name) nor any invoice convention. At 360px those three items in
one row are cramped to the point of truncation.

### 2.12 Logo is URL-only, which is effectively no logo on a phone — HIGH (M)
`InvoiceEditor.tsx:523-541` accepts a `https://` link to an image. A mobile user's logo is a PNG in
their phone gallery. To use it they must first find a public image host, upload, copy a direct link,
and paste it. In practice this means invoices go out unbranded — and per `PRODUCT.md` principle 1,
the document is the product.

**Fix:** accept a file, store it as a data URI on the invoice (`toSafeImageUrl` already allows
`data:` at `lib/invoice-export.ts:44`), with a size cap. No storage service required.

### 2.13 Saving ends on the dashboard with no confirmation and no next step — HIGH (S)
`saveInvoice` sets `saveStatus` into a visually-hidden `LiveStatus` region
(`InvoiceEditor.tsx:452`, `components/ui/alert-banner.tsx:86-92`) and immediately
`router.push("/dashboard")` (line 324). A sighted user sees the page swap with no visible
confirmation and no trace of what just happened — and, critically, **no path to the thing they came
for**. To actually send the invoice they must now find the row, tap View, and hunt the export
buttons in the modal header.

**Fix:** land on the invoice (or open its modal) after save, with the export/share actions as the
primary next step. This is the seam where the funnel leaks: the product's job is a *sent* invoice,
and the create flow ends at a list.

### 2.14 Editor invoice numbers are random, not sequential — MEDIUM (S)
`lib/invoices.ts:141`: `INV-${Date.now().toString().slice(-6)}`. Invoice #1 might be `INV-482910`
and #2 `INV-731204`. Under Indian GST rules an invoice serial must be consecutive within a financial
year; even ignoring compliance, a client receiving `INV-482910` from a solo consultant knows the
number is fake.

**Fix:** query the user's last invoice number, increment its trailing digits, fall back to
`INV-{FY}-001`.

### 2.15 Dates are computed in UTC — MEDIUM (S)
`lib/invoices.ts:112-114` builds the default date with `new Date().toISOString().split("T")[0]`. In
IST (UTC+5:30) any invoice created between 00:00 and 05:30 local time is dated **the previous day**.
`DatePickerField` gets this right (`components/ui/date-picker-field.tsx:60-65` uses local
getFullYear/getMonth/getDate); the default does not. Late-night billing is not an edge case for this
audience.

**Fix:** use the local-date formatter that `date-picker-field.tsx` already has; move it into
`lib/invoices.ts` and use it in both places.

---

## 3. Mobile (360–414px) — the highest-risk area

Credit first: `app/globals.css:99-142` already does the two things most apps miss — a
`@media (pointer: coarse)` block enforcing 44px minimums on every button/link, and safe-area insets
with `viewport-fit=cover` (`app/layout.tsx:24-28`). `components/ui/input.tsx:11` and
`textarea.tsx:12` use `text-base ... md:text-sm`, correctly defeating iOS zoom-on-focus.
`components/InvoiceList.tsx:114-168` is a genuine mobile card list, not a squeezed table.
`components/ui/modal.tsx` is a properly built dialog. The problems below are real breakages, not
missing polish.

### 3.1 "Print / PDF" is broken on every device, right now — BLOCKER (S)
`components/InvoiceModal.tsx:76`:

```js
const printableWindow = window.open(url, "_blank", "noopener,noreferrer");
if (!printableWindow) { URL.revokeObjectURL(url); setExportError("Your browser blocked the print window..."); return; }
```

Per the HTML spec's `window.open()` steps — *"If noopener is true … then return null, and otherwise
return targetNavigable's active WindowProxy"* — passing `noopener` (or `noreferrer`, which implies
it) makes `window.open` return `null` **on success**. There is no way to distinguish a blocked popup
from an opened one through this call.

So on every platform, every time, the flagship export path:
1. takes the `!printableWindow` branch;
2. **revokes the blob URL synchronously**, while the just-opened tab is still resolving it — so the
   new tab lands on a dead `blob:` URL and renders blank or errors;
3. shows a red banner falsely telling the user their browser blocked a popup;
4. `return`s before emitting the `report.generated` event, so telemetry under-reports it;
5. leaves `printableWindow.addEventListener("afterprint", …)` (lines 88-90) as unreachable dead code.

This is the single highest-priority bug in the audit: the product's stated purpose is producing a
document a client receives, and the only path to a PDF is non-functional.

**Fix (S):** drop the features argument — `window.open(url, "_blank")` — and detect blocking with
`if (!w || w.closed)`. Better for mobile (M): render the HTML into a hidden same-document `<iframe>`
and call `iframe.contentWindow.print()`. That sidesteps popup blocking entirely, which matters
because Chrome on iOS and Samsung Internet both mishandle blob URLs opened in a new tab, and iOS
Safari only permits `window.open` inside a synchronous user-gesture stack.

### 3.2 There is no way to send an invoice from a phone — BLOCKER (M)
`grep -rn "navigator.share|whatsapp|wa.me|mailto:"` across `app/`, `components/` and `lib/` returns
**nothing**. The four exports are: print (broken, 3.1), HTML download, CSV download, JSON download
(`InvoiceModal.tsx:98-132`).

Put that in the target user's hands. An Indian freelancer on an Android phone finishes an invoice
and wants to WhatsApp it to their client — the delivery norm this audience actually uses. Their
options are: a `.html` file in the Downloads folder (unsendable — WhatsApp will attach it, the
client's phone won't render it as a document), a `.csv`, or a `.json`. `PRODUCT.md` accepts that
"Invoicey does not send invoices; it produces files" — but it produces no file this user can hand
over.

**Fix:** (a) fix 3.1 so Android's print sheet can Save-as-PDF; (b) add a **Share** button using
`navigator.share({ files: [new File([blob], "INV-123.pdf")] })` where available (Android Chrome
supports file sharing to WhatsApp), falling back to `navigator.share({ url })` and then to a copy
link; (c) add a `mailto:` prefilled to `billToEmail` with the invoice body. Demote HTML/CSV/JSON
into an "Other formats" menu.

### 3.3 The invoice modal's header is eight buttons on a 360px screen — HIGH (S)
`InvoiceModal.tsx:149-197` renders Edit, Settle, Delete, Print/PDF, HTML, CSV, JSON and Close in one
`flex flex-wrap` row. At 360px (≈300px usable inside the modal's `p-3` + header `px-5`) that wraps
to three or four rows of 44px controls — roughly 150–200px of chrome before the invoice itself
starts, on a viewport around 640px tall. The destructive **Delete** (`variant="destructive"`, the
only saturated-red control in the app) sits in that wrapping row directly adjacent to Print/PDF, so
its position shifts with viewport width — a mis-tap risk on the one irreversible action.

**Fix:** on mobile show two primary actions (Share/PDF, Edit) and collapse the rest into an overflow
`⋯` menu; move Delete out of the header entirely.

### 3.4 The editor's save buttons are unreachable from where the user is working — HIGH (S)
`InvoiceEditor.tsx:402-439` puts Save Draft / Create Invoice in the page header. Below `sm` they
become full-width stacked buttons — good — but they are at the *top* of a form that is roughly
2,000–2,500px tall at 360px (23 stacked controls at ~64px each including labels, plus the line-item
cards, plus the Live Preview card underneath). To save, the user scrolls the whole way up; if
validation fails (2.5) they scroll back down to find the field, then up again to retry.

**Fix:** a `sticky bottom-0` action bar below `sm` with `padding-bottom: env(safe-area-inset-bottom)`.

### 3.5 The Live Preview is dead weight on a phone — MEDIUM (S)
The editor is `grid gap-6 lg:grid-cols-[1.15fr_1fr]` (`InvoiceEditor.tsx:466`), so below 1024px the
preview card stacks *underneath* the entire form. On a phone it is ~800px of content the user must
scroll past to reach nothing (it is the last element on the page), and it can never be seen next to
the field being edited — which is the entire point of a live preview, and what DESIGN.md calls the
"Preview-Stays-Visible Rule". It is also a second full rendering being laid out and repainted on
every keystroke on a mid-range device.

**Fix:** below `lg`, collapse the preview into a `<details>` or a bottom-sheet toggle ("Preview
invoice") so it renders on demand rather than always.

### 3.6 The exported invoice document overflows a phone screen — MEDIUM (S)
`lib/invoice-export.ts` sets `.header { display: flex; justify-content: space-between }` with no
`flex-wrap` and `.meta { min-width: 260px }`, and the line-item table carries fixed
`width: 80px / 140px / 140px` columns plus a description column. At 360px, with `body { padding: 24px }`,
there are ~312 usable pixels — so the HTML export (and the intermediate view before the print sheet)
scrolls horizontally and clips. The `@media print` block (`lib/invoice-export.ts:302-315`) only
strips background/border/shadow; it does nothing for narrow screens. Printing to A4 is fine
(~688px usable) — it is the on-screen mobile view that breaks.

**Fix:** add `flex-wrap: wrap` to `.header`, drop `.meta`'s `min-width` to `auto` under a
`@media (max-width: 600px)` query, and let the table scroll in a wrapper.

### 3.7 The dashboard's stat row is three cards deep before the list — MEDIUM (S)
`app/dashboard/page.tsx:222-271` is `grid gap-4 md:grid-cols-3`, so at 360px the user gets Total
Invoices, Collected Revenue and Outstanding stacked — three ~110px cards, ~350px — plus the greeting
block and the sticky 64px header, before a single invoice is visible. For a user with three invoices
the stats are noise; the list is the page.

**Fix:** below `md`, render the three numbers as one compact inline row.

### 3.8 The AI panel's example prompts are unreadable pills on mobile — MEDIUM (S)
`components/InvoiceAiAssistant.tsx:201-213` renders three full sentences (each 90–110 characters) as
`rounded-full` chips at `text-xs` in a `flex-wrap` row. At 360px each "pill" becomes a 4–5 line
paragraph with fully-rounded ends — visually broken, and 12px is below the app's own body floor.

**Fix:** stack them as bordered `rounded-md` rows at `text-sm`, or shorten the labels ("Hourly
consulting", "Monthly retainer") and put the full prompt in the textarea on tap.

### 3.9 The header menu is not a proper disclosure — MEDIUM (S)
`components/ui/header.tsx:244-255`: the hamburger has a static `aria-label="Toggle menu"` and no
`aria-expanded`, no `aria-controls`. The panel (`header.tsx:259-322`) does not close on Escape or on
an outside tap, and focus is not moved into it or trapped. A screen-reader user cannot tell whether
the menu is open; a touch user must tap the X precisely.

### 3.10 The calendar popover is sized for a mouse — POLISH (S)
`components/ui/calendar.tsx:41-44` gives day cells `h-9 w-9` (36px). The coarse-pointer rule in
`globals.css:107-112` raises their *height* to 44px but not their width (the `min-width` rule at
`globals.css:115-118` only matches icon-only buttons), so days become 44×36 — under the 44px target
in one axis, and taller than the `weekday` header row's `w-9` cells expect. The `dynamic()`
placeholder is hardcoded `h-[304px] w-[294px]` (`date-picker-field.tsx:24`) while the real calendar
on a touch device is ~60px taller, so the popover jumps when it loads. The nav chevrons (`h-7 w-7`,
`absolute left-1/right-1`) get bumped to 44×44 by the same rule and can overlap the month caption.

---

## 4. Accessibility

Prior work is genuinely good and should not be undone: `components/ui/field.tsx` generates
`id`/`aria-describedby`/`aria-labelledby` correctly and documents *why* button-backed controls need
`aria-labelledby` rather than `htmlFor` (lines 18-25); `components/ui/modal.tsx` implements name,
role, Escape, focus trap, focus restore and scroll lock; `components/ui/alert-banner.tsx:54-55`
picks `role="alert"`/`assertive` for errors and `status`/`polite` otherwise, with a separate
always-mounted `LiveStatus` region for transient progress; `components/ui/atmosphere.tsx:32` is
`aria-hidden`; `components/ui/tabs.tsx:33-36` carries a comment about fixing a 2.34:1 tab contrast
failure. This is above the bar for a solo project.

Remaining gaps:

### 4.1 The whole user-facing app ignores `prefers-reduced-motion` — HIGH (S)
`grep -rn "prefers-reduced-motion|useReducedMotion|MotionConfig" app components lib tailwind.config.js`
returns **three hits, all in `components/admin/`** (`kpi-card.tsx:4,38`, `admin-shell.tsx:6,174`,
`logs/log-row.tsx:4,84`). The admin panel — which one person uses — respects the setting. The
surfaces every customer touches do not: `tailwindcss-animate`'s `animate-in` / `zoom-in-95` /
`slide-in-from-top-2` on every dropdown and popover (`components/ui/popover.tsx:24-28`,
`dropdown-menu.tsx:50`), `animate-spin` on every loading state, `animate-pulse` on the calendar
skeleton (`date-picker-field.tsx:24`), and the 300ms `transition-all` on the landing bento cards
(`components/ui/aceternity/bento-grid.tsx:41`). There is no `@media (prefers-reduced-motion: reduce)`
block anywhere in `app/globals.css`.

**Fix (one block, ~8 lines):** in `globals.css`, under `@layer base`, reduce
`animation-duration`/`transition-duration` to `0.01ms` and disable `animation-iteration-count`
beyond 1 under `@media (prefers-reduced-motion: reduce)`, with an opt-out class for the spinners
that genuinely convey progress.

### 4.2 The landing page's primary CTA is white on near-white — HIGH (S)
`components/landing.tsx:112-121` styles the hero's primary button
`bg-white text-slate-900 hover:bg-slate-100`, and it sits on `PageShell tone="bare"`, whose light
ground is `bg-slate-100` (`components/ui/page-shell.tsx:26`). White (`#ffffff`) against slate-100
(`#f1f5f9`) is **1.08:1** — WCAG 1.4.11 requires 3:1 for a control's boundary. There is no border and
no shadow, so in light mode the app's single most important call to action has no visible edge. Its
hover state is `bg-slate-100`, *exactly* the page background, so the button disappears on hover.
Meanwhile the secondary button beside it (line 126) has a `border-slate-300` and therefore reads as
the more prominent control.

Dark mode is fine (white on slate-950). This is a light-mode-only failure, which is how it survived.

**Fix:** drop the override — the default `Button` variant (near-black on light, per DESIGN.md's
"Primary" rule) is correct here and is what the rest of the app uses.

### 4.3 Non-text contrast: emerald check icons at 1.6:1 — MEDIUM (S)
`app/auth/page.tsx:437` and `:441`, and `app/pricing/page.tsx:46`, render
`<CheckCircledIcon className="text-emerald-300" />` on white/`bg-white/80` cards. `emerald-300`
(`#6ee7b7`) on white is ~1.62:1. These icons carry meaning (each marks an included feature / a
benefit), so 1.4.11's 3:1 applies. Use `emerald-600` on light with a `dark:text-emerald-300` twin —
the pattern the status pills already use (`lib/invoice-status.ts:18-30`, which are all correctly
above 4.5:1 in both themes).

### 4.4 Card titles are `<div>`s, so the app has almost no heading structure — MEDIUM (S)
`components/ui/card.tsx:32-45` renders `CardTitle` as a `<div>`. Consequently "Your Invoices",
"Total Invoices", "Collected Revenue", "Outstanding" (`app/dashboard/page.tsx`), "Invoice Details"
and "Live Preview" (`InvoiceEditor.tsx:469`, `1052`), and "AI Invoice Assistant"
(`InvoiceAiAssistant.tsx:147`) are not headings. A screen-reader user navigating the dashboard by
heading finds exactly one: the `<h1>` greeting. In the editor they find the `<h1>` plus six
`MicroLabel as="h2"` section labels (`InvoiceEditor.tsx:475`, `559`, `606`, `695`, `859`, `1017`) —
which are `<h2>`s nested inside a card whose own title is a `<div>`, so the outline reads as if the
sections belong to the page rather than to the form.

**Fix:** give `CardTitle` an `as` prop (like `MicroLabel` already has) and pass `as="h2"` at the call
sites; demote the editor's section labels to `h3`.

### 4.5 No skip link — MEDIUM (S)
The only `sr-only` in the codebase is `components/ui/alert-banner.tsx:88`. Every page puts the brand
lockup, three to six nav links, a theme toggle and an account control ahead of `<main>`
(`components/ui/header.tsx:145-257`). A keyboard or switch user tabs through all of it on every
navigation. Add a `sr-only focus:not-sr-only` "Skip to content" anchor as the first child of `<body>`
and an `id="main"` on `PageShell`'s `<main>`.

### 4.6 The mobile menu is not an accessible disclosure — MEDIUM (S)
See 3.9. `components/ui/header.tsx:244-255`: no `aria-expanded`, no `aria-controls`, static
`aria-label`, no Escape handler, no outside-click close, no focus move into the panel.

### 4.7 Validation errors are not associated with their fields — MEDIUM (M)
`InvoiceEditor.tsx:271-305` announces errors through `AlertBanner`'s `role="alert"`, which is
correct as far as it goes, but no control ever receives `aria-invalid`, no error text is wired into
`aria-describedby`, and focus never moves to the offending field. A screen-reader user hears "Add a
client name so the invoice knows who it is addressed to" and then has to find that field among ~23
by hand. `Field` already threads `aria-describedby` (`components/ui/field.tsx:71`) — the wiring
exists; only per-field error state is missing. Same gap on `app/auth/page.tsx` (`aria-required` is
set but `aria-invalid` never is).

### 4.8 Repeated, non-unique accessible names — MEDIUM (S)
- `InvoiceEditor.tsx:771` and `:846`: every "Remove item" button has the same label (see 2.8).
- `InvoiceModal.tsx:181-195`: "Print / PDF", "HTML", "CSV", "JSON" are format names with no context;
  "JSON" in particular has no icon and no explanation of what it is for. Prefer
  `aria-label="Download ${invoiceNumber} as CSV"`.
- `app/auth/page.tsx:705`: the Google button's mark is a bare `<span>G</span>` — decorative text
  inside the accessible name, so the button announces as "G Continue with Google". Wrap it
  `aria-hidden`.

### 4.9 `SelectField` uses menu semantics, and forgoes the native picker on touch — MEDIUM (M)
`components/ui/select-field.tsx:45-74` builds Currency and Status on Radix `DropdownMenu` +
`DropdownMenuRadioGroup`, so the control announces as a *menu* with `menuitemradio` children rather
than as a combobox/listbox. Keyboard operation works (arrow keys, typeahead, Escape) and the
`aria-labelledby` pairing at `field.tsx:18-25` is thoughtfully done — but on Android a native
`<select>` would give the OS wheel picker, which is faster, more familiar, and immune to the
popover-clipping and viewport-jump problems a floating panel has when the keyboard is open.

**Fix:** for the two short, flat option lists in this app (5 currencies, 4 statuses), a styled native
`<select>` is strictly better on every axis.

### 4.10 `initialFocus` is a dead prop on the date picker — POLISH (S)
`components/ui/date-picker-field.tsx:111` passes `initialFocus`, removed in react-day-picker v9
(this repo is on `^9.14.0`; `components/ui/calendar.tsx` is otherwise correctly on the v9 API). The
v9 equivalent is `autoFocus`. Radix's Popover still focuses the panel so the calendar is reachable,
but the day grid is not focused on open and there is no announcement of the visible month.

### 4.11 Focus ring offset is computed against the wrong ground — POLISH (S)
`components/ui/button.tsx:8` and `input.tsx:11` use `ring-offset-background`. Inside a `Card`
(`bg-card`, white on light / `slate-900`-ish on dark) that paints a 2px halo in the *page* colour
rather than the card colour, so focus rings on every editor field carry a faint mismatched band.
Use `ring-offset-card` inside cards, or drop the offset and rely on the 2px ring.

---

## 5. Feedback and error states

### 5.1 There is no toast system — inline banners only — MEDIUM (M), but the design is defensible
`grep -rni "toast|sonner"` returns nothing. Every message goes through
`components/ui/alert-banner.tsx` (a bordered inline block) or the invisible `LiveStatus` region. The
error *copy* is the best-executed part of the product: `describeRequestError`
(`lib/api-client.ts:86-106`) distinguishes offline / timeout / unreachable / HTTP-status cases and
returns both a message and a `canRetry` flag, so a retry button only appears when retrying could
work (`app/dashboard/page.tsx:287`); `statusFallbackMessage` (`lib/api-client.ts:67-79`) writes real
sentences per status code; `persistSession` (`app/auth/page.tsx:189-195`) deliberately rewrites
"Failed to fetch" into "Signed in, but we couldn't reach the server to start your session."

Where the inline-only model breaks:
- **Success is invisible on save.** `InvoiceEditor.tsx:323-324` sets `saveStatus` (screen-reader-only)
  and immediately navigates. A sighted user gets no confirmation at all. See 2.13.
- **Notices are sticky and located wherever the card is.** `app/dashboard/page.tsx:294-298` renders
  "Marked as paid." into the invoice card and never clears it on a timer — it persists until the
  next action. On mobile, if the user has scrolled to a row far down the list, the banner appears
  above the list, off-screen, so the confirmation is silently missed.
- **Two banners can stack** (`loadError` then `notice`, dashboard lines 284-298), each in its own
  `p-4` wrapper, pushing the list further down.

**Fix:** keep `AlertBanner` for state that persists (load failure, validation), and add a small
toast for transient confirmations ("Marked as paid", "Invoice created"). ~60 lines, no dependency.

### 5.2 Skeletons exist — for the admin, not the customer — MEDIUM (S)
`components/ui/skeleton.tsx` is used in `app/admin/loading.tsx`, `app/admin/page.tsx:100-107`,
`app/admin/activity/page.tsx:76`, `app/admin/feedback/page.tsx:224`, `app/admin/users/[uid]/page.tsx:88`.
There is exactly one `loading.tsx` in the whole app and it is `app/admin/loading.tsx`.

The two routes real users wait on get spinners: `app/dashboard/page.tsx:300-304` is a spinning icon
plus "Loading invoices…", and `InvoiceEditor.tsx:368-379` replaces the *entire viewport* with a
centered card reading "Loading invoice…" — so opening an invoice to edit blanks the page. Both are
on the slow path described in §6, so this is the state users see for several seconds on 4G.

**Fix:** add `app/dashboard/loading.tsx` and `app/create-invoice/[id]/loading.tsx` with skeletons
shaped like the real content (three stat cards + five list rows; the two-column editor shell). The
component already exists.

### 5.3 Auth errors are handled well; one gap — POLISH
`getFirebaseErrorMessage` (`app/auth/page.tsx:98-139`) maps 16 Firebase codes to plain sentences —
genuinely good. `UnauthenticatedError.reason` correctly splits signed-out from verify-email and every
consumer branches on it (`dashboard/page.tsx:69-77`, `InvoiceEditor.tsx:131-139`, `:327-334`). The
gap: on a signed-out redirect the user lands on `/auth` with no explanation of why they were bounced
— only the `verify-email` case sets a notice (`auth/page.tsx:226-231`). Add a `reason=expired` branch.

### 5.4 The AI panel bypasses the shared API client — POLISH (S)
`components/InvoiceAiAssistant.tsx:84-97` hand-rolls `fetch` with its own `Authorization` header and
timeout, while `lib/api-client.ts:76-82` already exports `aiApi.assist`. CLAUDE.md explicitly says
not to do this. The practical cost: the panel re-implements offline/timeout detection
(`InvoiceAiAssistant.tsx:126-136`) instead of getting `NetworkError` and `describeRequestError` for
free, so its error copy drifts from the rest of the app.

### 5.5 There is no offline story — MEDIUM (M)
`navigator.onLine` is read in two places to *label* a failure (`api-client.ts:26`,
`InvoiceAiAssistant.tsx:130`) but nothing is cached, queued, or persisted. No service worker, no
manifest, no `localStorage` draft. On the intermittent 4G this audience uses, a dropped connection
mid-form means the save fails with a correct, well-worded message — and then the user's only option
is to keep the tab open and hope. Persisting the editor's form state to `localStorage` on change
(see 2.2) is the cheap 80% of this.

---

## 6. Perceived performance on a mid-range Android over 4G

Things already right, and worth protecting: **zero font bytes** — the Helvetica/Arial/Liberation
stack means no webfont download, no FOUT, no preload budget (DESIGN.md, "Delivery: a stack, not a
download"). The theme init script is inlined `beforeInteractive` (`app/layout.tsx:38-40`), so no
flash. `lib/firebase-lazy.ts` correctly consolidates Firebase Auth into **one** shared async chunk
after an earlier attempt shipped it twice. `react-day-picker` + `date-fns` (~200 KB) are behind
`dynamic()` (`components/ui/date-picker-field.tsx:18-29`). All four marketing pages are server
components.

**framer-motion and recharts are not the problem.** `grep -rln` shows framer-motion only in
`components/admin/{kpi-card,admin-shell,logs/log-row}.tsx` and recharts only in
`components/admin/charts/*`, so both land in `/admin` route chunks that no customer downloads. Do
not "optimize" them.

### 6.1 The real cost is a five-hop serial waterfall to the first invoice row — HIGH (M)
Opening `/dashboard` on a cold cache runs strictly in sequence:

1. HTML (no data — `app/dashboard/page.tsx:1` is `"use client"`, the whole page renders empty).
2. Route JS downloads, parses, hydrates. On a mid-range Snapdragon this is where the seconds go.
3. `useEffect` fires → `invoicesApi.list()` → `getAuthToken()` → `getReadyUser()`
   (`lib/api-client.ts:116-127`) → `loadFirebaseAuth()`, which only *now* starts downloading the
   Firebase Auth chunk (~155 KB decoded).
4. `auth.authStateReady()` reads IndexedDB and, if the ID token has expired (they last an hour),
   makes a network round trip to `securetoken.googleapis.com` before resolving.
5. `fetch('/api/invoices')` → `connectDB()` (`lib/mongodb.ts:24-40`, no cached connection promise, so
   a cold lambda pays a full Mongo handshake) → an **unpaginated** find returning every invoice with
   its full items array.

None of these overlap. On 4G (~120–200 ms RTT) with a mid-range device's parse cost, first paint of
actual data realistically lands in the 4–7 second range, and every second of it is the bare spinner
from §5.2.

**Fixes, in order of value:**
- **Start the Firebase chunk and the auth-state read at module scope on authenticated routes**, so
  step 3's download overlaps step 2's hydration instead of following it. A `void loadFirebaseAuth()`
  at the top of the dashboard's module gets most of it for free (S).
- Add skeletons (§5.2) so the wait reads as progress rather than a hang (S).
- Cache the Mongoose connection promise — CLAUDE.md already flags this as deferred (S).
- Paginate `/api/invoices` (M). Also already flagged as deferred; it is a correctness issue as well
  as a speed one once anyone has 200 invoices.

### 6.2 Two analytics scripts on every page including marketing — POLISH (S)
`app/layout.tsx:46-47` mounts `@vercel/analytics` and `@vercel/speed-insights` in the root layout, so
both load on `/`, `/about`, `/pricing` and `/contact` — pages that are otherwise pure server-rendered
HTML with no JS need at all. Small individually, but they are the only reason those routes ship a
client runtime.

### 6.3 The company logo is an unsized raw `<img>` — POLISH (S)
`InvoiceEditor.tsx:1068-1073` and `InvoiceModal.tsx:218-223` render `<img src={companyLogo}>` with
no `width`/`height` attributes (the Tailwind `h-12 w-12` class applies after CSS, not before layout),
so a slow-loading remote logo shifts the masthead. `next.config.ts` also allowlists
`via.placeholder.com` in `images.remotePatterns`, which nothing uses — dead config worth removing.

---

## 7. Copy and terminology

The `convenienceCharge` rule is **held perfectly**: `grep -rni "convenience"` finds the identifier
and nothing else user-facing; every surface reads "Service Charge" (`InvoiceEditor.tsx:884`,
`lib/invoice-domain.ts:117`, `InvoiceModal.tsx:342`). The legacy `tax` field is likewise never shown.
The validation messages in `InvoiceEditor.saveInvoice` and the delete confirmation
(`app/dashboard/page.tsx:409-417`, which is honest about soft delete without promising erasure) are
the best copy in the product.

The leaks:

### 7.1 The AI panel prints raw field identifiers at the user — HIGH (S)
`components/InvoiceAiAssistant.tsx:291-298` renders `missingFields` verbatim as amber pills under
"Still Needed". `lib/ai/invoice-assistant/normalization.ts:223-227` filters that array to
`REQUIRED_FIELDS = ["companyName", "billTo", "invoiceNumber", "invoiceDate", "dueDate", "items"]` —
so the user is shown literal camelCase code identifiers. `billTo` and `items` are meaningless to a
freelancer. This is the exact class of leak the product charter forbids.

**Fix:** a label map (`billTo → "Client name"`, `items → "What you're billing for"`, …). Six entries.

### 7.2 The AI's three example prompts are all foreign-currency and non-Indian — HIGH (S)
`InvoiceAiAssistant.tsx:22-26`: "TechCorp, 40 hours at **$120/hr**, plus **$500** for cloud hosting
… **USD**"; "BrightLabs, **$900**, include **10% tax**"; "Nova Health, 12 hours at **85 EUR**/hour".
Zero rupees, zero GST, zero Indian client names. These examples are how a first-time user learns to
talk to the assistant, and they teach the wrong currency, the wrong tax model (the app has no single
"10% tax" — it splits CGST/SGST), and the wrong customer. The default currency in the form beside
them is INR (`lib/invoices.ts:146`).

**Fix:** rewrite all three in INR with GST and Indian names, e.g. "Brand identity for Chennai-based
Kalyan Textiles, ₹85,000, 9% CGST and 9% SGST, due in 15 days."

### 7.3 "Settle" — MEDIUM (S)
`components/InvoiceList.tsx:82` and `InvoiceModal.tsx:168` label the mark-as-paid action "Settle".
The `aria-label` on the same button already says the right thing
(`InvoiceList.tsx:79`: "Mark ${invoiceNumber} as paid"). A non-accountant will not read "Settle" as
"I got paid". Use the label that is already in the aria-label.

### 7.4 Enterprise-SaaS register bleeding into a solo-operator product — MEDIUM (S)
The voice `PRODUCT.md` asks for is "plain, operator-to-operator, concrete." Against that:
- `components/ui/header.tsx:154-156` — the brand lockup's second line is **"Billing OS"**. On every
  page, for a person who bills four clients a month.
- `components/ui/footer.tsx:6` — "Built for practical **teams** shipping invoices, not slide decks."
  There is no team model in the product (`PRODUCT.md`, Capabilities), and the audience is solo.
- `components/landing.tsx:234` — "Designed to feel like a real product, not a toy generator." Defends
  against an accusation the visitor hasn't made and plants the comparison.
- `components/landing.tsx:20-52` — the bento eyebrows are internal taxonomy: "Builder", "Exports",
  "Presentation", "Ops". Plus "Invoice Studio" and the section header "Product Surface".
- `app/about/page.tsx:26` — "without tool sprawl"; `app/auth/page.tsx:433` — "invoice workspace
  across devices".

### 7.5 Two vocabularies for the same two parties — MEDIUM (S)
The form calls them **Seller** and **Client** (`InvoiceEditor.tsx:476`, `560`); the Live Preview
directly beside it calls them **Bill From** and **Bill To** (`InvoiceEditor.tsx:1087`, `1098`); the
API and DB call the client `billTo`; the dashboard column header says "Client". Pick one pair for
everything the user reads — "Your details" / "Client" is the plainest.

### 7.6 GST is presented as two unexplained acronyms — HIGH (S copy, M product)
`InvoiceEditor.tsx:902` and `:960` label the fields "CGST" and "SGST" with no hint text, no default
rate, and no explanation. `PRODUCT.md` principle 3 says "GST is a default, not an advanced mode" —
but the default is 0, the section is called "Discounts & Tax", and the user is left to know that
18% GST means 9% + 9%. There is **no IGST field at all** (see 9.1), so a user billing another state
has no correct option.

**Fix (copy, S):** hint text under each — "Central GST. For an 18% invoice, enter 9% here and 9% in
SGST." Add a one-tap "18% GST" preset. Rename the section "GST & adjustments".

### 7.7 Smaller items — POLISH
- `app/auth/page.tsx:449` — the card title is **"Welcome Back"** even when the user is on the Sign Up
  tab creating their first account.
- `app/dashboard/page.tsx:237`/`:257` — "Collected Revenue" / "Outstanding". "Paid" / "Unpaid" reads
  faster and is what the person actually thinks.
- `InvoiceAiAssistant.tsx:152` — a **"Free Beta"** badge. Everything is free and permanent
  (`PRODUCT.md`), and "Beta" on the one differentiating feature invites doubt.
- `InvoiceEditor.tsx:398-400` — "Build polished invoices with complete business and payment details."
  restates the page title.

---

## 8. Trust surfaces

### 8.1 There is no privacy policy, no terms, and no data story — BLOCKER (M)
Repeating 1.2 because it belongs here too: zero occurrences of "privacy", "terms", "GDPR" or "data
protection" anywhere in `app/` or `components/`. `components/ui/footer.tsx` contains **no links at
all**. The only quasi-legal text is `app/auth/page.tsx:714-717`, which imposes an obligation on the
user and offers none in return.

The user is being asked to type their own bank account, IFSC and UPI ID (`InvoiceEditor.tsx:1026`)
plus their clients' names, postal addresses and emails into a domain they have never seen, with no
statement of who holds it or what happens to it. And `PRODUCT.md` correctly notes there are no
customers, no logos, no testimonials to lean on — so the *only* credibility available is being
straightforward about the mechanics. Not doing that is the largest unforced error on the site.

### 8.2 `/contact` is three social profiles — HIGH (S)
`app/contact/page.tsx:12-31` offers Twitter, GitHub and LinkedIn. There is no email address, no
support channel, and no response-time expectation. The in-app `/feedback` page exists
(`app/feedback/page.tsx`) but requires a session and is not linked from `/contact`, so a prospective
user with a question has nowhere to send it. The three outbound links also carry no
`target`/`rel="noopener"` and no external-link affordance (`contact/page.tsx:65-70`); same for the
Buy Me a Coffee link at `pricing/page.tsx:59-61`.

### 8.3 `/about` has no author and no "why should I trust this" — MEDIUM (S)
`app/about/page.tsx` is three abstract pillars ("Fast by default", "Professional outputs", "Built for
operators"). For a solo project with no social proof, the honest and far more persuasive version is
the one `PRODUCT.md` describes: who built it, that it is a side project, that it is free because
there is no business model behind it, and where the data lives. The `/contact` page already names a
real person via three profile URLs — `/about` should say so in words.

### 8.4 The pricing page implies a future paywall — MEDIUM (S)
See 1.7. "free to use **while we polish the platform for public launch**"
(`app/pricing/page.tsx:26-29`) reads as a limited-time trial, which is precisely the framing
`PRODUCT.md` forbids. `$0` on an India-first product should be `₹0` or "Free".

### 8.5 The exported invoice carries an unremovable "Generated by Invoicey" footer — POLISH
`lib/invoice-export.ts:420-422` prints "Generated by Invoicey • {date}" on the client-facing
document. That is a defensible free-product trade, but it should be a deliberate one — a freelancer
billing an enterprise client may not want a third-party tool named on the invoice.

### 8.6 The exported invoice prints its internal status on the client's copy — MEDIUM (S)
`lib/invoice-export.ts:344` stamps `getInvoiceStatus(invoice).toUpperCase()` — DRAFT / SENT / PAID /
OVERDUE — into the document masthead. "SENT" is meaningless to a recipient, "DRAFT" is embarrassing
if exported by mistake, and "OVERDUE" on a document you are about to send for the first time is
confusing. Print only PAID (or nothing).

### 8.7 The exported document is not a GST tax invoice — HIGH (M) (see 9.1)
It has no "Tax Invoice" title, no supplier GSTIN, no recipient GSTIN, no HSN/SAC, and no place of
supply. A GST-registered freelancer — the stated primary user — cannot use this output for their
actual filings.

---

## 9. What is missing entirely

Verified by grep and by reading every page under `app/` and `components/`.

### 9.1 GST compliance fields — BLOCKER for the stated audience (M)
`grep -rni "gstin|hsn|sac|igst|place of supply"` across `app/`, `components/`, `lib/` and `models/`
returns **nothing**. `models/Invoice.ts`, `InvoiceFormState` (`lib/invoices.ts:54-76`) and the export
template all lack:
- **Supplier GSTIN** and **recipient GSTIN**
- **HSN / SAC code** per line item
- **IGST** — mandatory for inter-state supply, which is most freelance work in India
- **Place of supply**
- The heading **"Tax Invoice"** (`lib/invoice-export.ts:328` prints "INVOICE")

`PRODUCT.md` principle 3 claims "GST is a default, not an advanced feature" and "Indian tax reality
is the happy path." As built, a GST-registered user cannot produce a compliant invoice, and a user
billing a client in another state has no correct field to put the tax in — they would have to
misfile it as CGST+SGST.

**Fix:** either add supplier/recipient GSTIN + IGST + HSN (M, and the highest-value product work
here), or drop the GST-first claim from `PRODUCT.md` and the marketing. Shipping the claim without
the fields is the worse of the two.

### 9.2 Dashboard search, filter and sort — HIGH (M)
`app/dashboard/page.tsx` renders `invoices.map(...)` in raw API order with no controls of any kind.
`components/ui/search-input.tsx` **exists in the repo** and is used only by the admin log viewer.
`components/ui/pagination.tsx` likewise. So the customer's list has no way to find "that invoice for
Nova Health from March", filter to unpaid, or sort by amount — while the admin panel has all three.
Combined with the unpaginated endpoint (§6.1), a user with 60 invoices has an unusable dashboard.

**Fix:** a client-side search box over `billTo` + `invoiceNumber` and a status filter chip row —
both trivial against the already-in-memory array, and both reuse existing components.

### 9.3 Duplicate invoice — HIGH (S)
No duplicate/clone action exists anywhere. The archetypal use of this product is a monthly retainer
to the same client: identical seller block, identical client block, identical line items, new number
and dates. Today that means retyping all 23 fields (see 2.1). A "Duplicate" row action that loads
the record into `mode="create"` with a fresh number and today's dates is perhaps 20 lines and would
be the single most-used feature in the app.

### 9.4 Bulk actions — MEDIUM (S)
No selection model, no multi-settle, no multi-delete. Marking six invoices paid at month end is six
round trips through `PATCH ?id=` with a full list refetch after each (`dashboard/page.tsx:127-134`).

### 9.5 Undo — MEDIUM (M)
Nothing is undoable. Delete is a `ConfirmDialog` whose copy explicitly says "there is no way to bring
it back from here" (`dashboard/page.tsx:415-416`) — honest, and true only because there is no UI for
it: the record is soft-deleted (`is_deleted`), so a restore action is a one-line API change plus a
"Recently removed" view. Settle is irreversible in the UI too (once `status === "paid"` the Settle
button is hidden, `InvoiceList.tsx:73`), so a mis-tap on the wrong row is permanent. And an AI patch
overwrites form state with no diff and no undo (`InvoiceEditor.applyAiPatch`, line 201) — the panel
reports "Applied 6 fields" without saying which.

### 9.6 Sharing — BLOCKER (M)
Covered in 3.2. No `navigator.share`, no `mailto:`, no WhatsApp link, no shareable invoice URL, no
"copy link". The product ends at "download a file to your phone", and none of the four files is one
an Indian client will accept over WhatsApp.

### 9.7 Offline — MEDIUM (M)
See 5.5. No service worker, no manifest, no cached shell, no draft persistence. The app is not
installable to an Android home screen, which for a mobile-first audience is a missed retention hook
that costs one JSON file plus icons (the icons already exist in `public/`).

### 9.8 Client / customer memory — HIGH (M)
There is no client list. Every invoice retypes the client's name, email and full billing address.
Combined with 2.1 (no seller memory) and 9.3 (no duplicate), the product has **no memory of anything
between invoices** — which is what makes invoice #2 cost as much as invoice #1, and is the strongest
structural reason a user would not come back.

### 9.9 Recurring invoices, payment links, reminders — out of scope, correctly
`PRODUCT.md` explicitly rules these out ("does not send email, take payments, or issue reminders").
Noted only so it is clear their absence is a decision, not an oversight. Everything above (9.1–9.8)
is inside the stated scope.

---

## Appendix: things that are already right

Listed so a future pass does not "fix" them:

- `app/globals.css:99-142` — `pointer: coarse` 44px targets and safe-area insets. Correct approach
  (input method, not viewport width).
- `components/ui/input.tsx:11`, `textarea.tsx:12` — `text-base md:text-sm` defeats iOS zoom-on-focus.
- `components/ui/modal.tsx` — a complete dialog: role, name, Escape, focus trap, focus restore,
  scroll lock, and `dismissOnBackdrop={false}` for destructive confirmations.
- `components/ui/alert-banner.tsx` — correct `alert`/`assertive` vs `status`/`polite` split, plus a
  separately-mounted `LiveStatus` region.
- `components/ui/field.tsx` — id/label/describedby wiring, and the `aria-labelledby={labelId + id}`
  trick for button-backed controls, with the reasoning recorded.
- `components/ui/numeric-input.tsx` + `lib/numeric-input.ts` — a genuinely well-thought-out
  clearable numeric field with the decision logic extracted and tested.
- `lib/api-client.ts` — typed `ApiError`/`UnauthenticatedError`/`NetworkError`, `authStateReady()`
  before `currentUser`, and `describeRequestError` returning an actionable `canRetry`.
- `lib/firebase-lazy.ts` — one shared async Firebase chunk.
- `components/InvoiceList.tsx` — a real mobile card list with a documented rationale.
- `lib/invoice-status.ts` — all four status pill pairs clear 4.5:1 in both themes.
- `lib/invoice-export.ts` — `escapeHtml` / `toLineBreaks` / `toSafeImageUrl` on every interpolation
  and `neutralizeCsvValue` against spreadsheet formula injection.
- The delete confirmation copy (`app/dashboard/page.tsx:409-417`) — accurate about soft delete
  without promising erasure.
- Zero webfont bytes.
