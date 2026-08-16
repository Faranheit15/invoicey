# Invoicey — Codebase Audit (release-readiness for an Indian invoicing product)

Repo: `/home/faran/projects/invoicey` · branch `develop` @ `bd0f249` · audited 2026-08-17
Method: read-only. Every claim below is either **[V]** verified by reading the cited line(s), or **[I]** inferred (reasoning from what is *absent* or from architecture). Absence claims were verified with repo-wide greps and are marked **[V-absent]**.

---

## 1. Full feature inventory

### 1.1 Public / marketing surface
| Capability | Where | Notes |
|---|---|---|
| Landing page | `app/page.tsx:1-5` → `components/landing.tsx` (254 lines) | [V] Pure marketing shell. |
| Pricing page | `app/pricing/page.tsx:8-13` | [V] Static. Advertises "Unlimited invoice creation, Edit and manage invoice status, PDF/HTML/CSV/JSON exports, Simple dashboard workflow". $0 "Starter" plan (`app/pricing/page.tsx:40`), donate link to buymeacoffee (`:59`). **No billing/subscription code exists anywhere** [V-absent]. |
| About | `app/about/page.tsx:10-29` | [V] Static copy. Note `:26` claims users can "manage status updates, edits, and payment records" — **there is no payment-record feature**; see §2. Marketing overclaim. |
| Contact | `app/contact/page.tsx:12-31` | [V] Static links to Twitter/GitHub/LinkedIn. No contact form. |
| Global chrome | `app/layout.tsx:30-50` | [V] Header + Footer on every page, Vercel `Analytics` + `SpeedInsights`, theme init script injected `beforeInteractive` (`:38-40`). |
| Error boundaries | `app/global-error.tsx` (147), `app/dashboard/error.tsx`, `app/admin/error.tsx` | [V] Present. |

### 1.2 Auth
| Capability | Where |
|---|---|
| Email+password sign-up, with verification mail sent at creation | `app/auth/page.tsx:336-348` [V] |
| Email+password sign-in, blocked when unverified | `app/auth/page.tsx:297-302` [V] |
| Google sign-in (popup) | `app/auth/page.tsx:269-270` [V] |
| Password reset email | `app/auth/page.tsx:367-368` [V] |
| Resend verification (re-authenticates first) | `app/auth/page.tsx:397-410` [V] |
| `?reason=verify-email` deep-link notice | `app/auth/page.tsx:226-230` [V] |
| Server session mint + Mongo user upsert | `app/api/auth/session/route.ts:13-53` [V]; Google variant `app/api/auth/google/route.ts:7-38` [V] |
| Verified-email gate, three layers | client `lib/auth-client.ts:22-28`; route `lib/server/auth.ts:87-92`; mint route `app/api/auth/session/route.ts:29-37` [V] |
| Token revocation honored (suspension takes effect next request) | `lib/server/auth.ts:78` — `verifyIdToken(token, true)` [V] |
| Session token (HS256 via `jose`) minted but never verified server-side | `app/api/auth/session/route.ts:46` [V]; CLAUDE.md concurs |
| Client session state | `modules/UserSessionManager.ts` (150 lines), cookie+localStorage, no React context [V] |
| **Missing**: MFA, phone/OTP login, org/team accounts, invite flows, SSO, account deletion/export (GDPR/DPDP) | [V-absent] — no matches for `deleteUser`, `multiFactor`, `team`, `organization`, `invite` in app code |

### 1.3 Invoicing (the core product)
| Capability | Where |
|---|---|
| Create invoice | `app/create-invoice/page.tsx:1-5` → `components/InvoiceEditor.tsx` `mode="create"` [V] |
| Edit invoice | `app/create-invoice/[id]/page.tsx:9-12`, `mode="edit"` [V] |
| Dashboard list + summary KPIs (paid vs outstanding, per-currency sums) | `app/dashboard/page.tsx:162-192` [V] |
| Responsive list: desktop table + mobile card list, one shared action set | `components/InvoiceList.tsx:38-97` (`InvoiceRowActions`), `:114-168` (`InvoiceCardList`) [V] |
| Row actions: View / Edit / Settle / Delete | `components/InvoiceList.tsx:51-94` [V] |
| Settle (→ status `paid`) | `app/dashboard/page.tsx:127-128` → `PATCH {action:"settle"}` → `app/api/invoices/route.ts:392-405` [V] |
| Soft delete with confirm | `app/dashboard/page.tsx:136-142` → `app/api/invoices/route.ts:382-390` [V] |
| View modal with full invoice sheet + 4 export buttons | `components/InvoiceModal.tsx:181-197` [V] |
| Live preview inside the editor (JSX, separate from export HTML) | `components/InvoiceEditor.tsx` [V]; totals shared via `buildTotalsRows` (`lib/invoice-domain.ts:112-119`) |
| Currencies: INR, USD, EUR, GBP, AED | `lib/invoices.ts:102-110` [V] |
| **Missing**: search, filter, sort, pagination on the dashboard | [V] `app/dashboard/page.tsx` has no search/filter/sort state; `GET /api/invoices` (`app/api/invoices/route.ts:194-198`) is an unbounded `find().sort({createdAt:-1})` with no `.limit()`. Duplicate/clone, bulk actions, email-send, payment links — all absent [V-absent]. |

### 1.4 Export
`lib/invoice-export.ts` (478 lines) — four formats wired in `components/InvoiceModal.tsx`: PDF-via-print (`:71-96`), HTML download (`:98`), CSV (`:110`), JSON (`:122`). Detailed assessment in §6.

### 1.5 AI assistant
`components/InvoiceAiAssistant.tsx` (305 lines) + `lib/ai/invoice-assistant/*` + `app/api/ai/invoice-assistant/route.ts` (172 lines). Detailed in §7.

### 1.6 Feedback
| Capability | Where |
|---|---|
| User feedback form: message, 1-5 star rating, category (bug/idea/praise/other), page context | `app/feedback/page.tsx:36-60`, `lib/feedback.ts` [V] |
| User sees own past feedback + its triage status | `app/feedback/page.tsx:41-44` (status badge) [V] |
| POST endpoint with per-uid rate limit (10 / 10 min, **in-process Map**) | `app/api/feedback/route.ts:12-25` [V] — resets on every serverless cold start / is per-instance [I] |
| Model + triage indexes | `models/Feedback.ts:14-35` [V] |

### 1.7 Telemetry / logging
| Capability | Where |
|---|---|
| Client event beacon (`report.generated` etc.), allow-listed events + whitelisted meta, 4KB body cap, 30/min per uid | `app/api/events/route.ts:16-69` [V] |
| Structured log store with **per-document TTL** (`expireAt` computed from level+category) | `models/LogEntry.ts:18-49`, writer `lib/server/log.ts` (236 lines) [V] |
| Route error logging helper `logRouteError`, activity helper `recordActivity` | used across `app/api/invoices/route.ts:204,244,314,384` [V] |
| Keep-alive cron for free-tier Atlas (Vercel Cron, optional `CRON_SECRET`) | `app/api/cron/keep-alive/route.ts:21-48` [V] |

### 1.8 Admin console
Pages: `app/admin/{page,users,users/[uid],invoices,logs,activity,feedback}` + `layout/loading/error`. APIs: `app/api/admin/{overview,users,users/[uid],invoices,invoices/[id],logs,activity,feedback,feedback/[id],me,export/invoices,export/users}`.
| Capability | Where |
|---|---|
| Fail-closed admin gate: role+status read fresh from Mongo against verified token | `lib/server/admin.ts:29-46` [V] |
| Self-action guard + last-active-admin guard | `lib/server/admin.ts:49-57` and `:59+` [V] |
| User promote / revoke / suspend (+ unsuspend) | `app/api/admin/users/[uid]/route.ts:104-118` [V] |
| Cross-user invoice soft_delete / **restore** / status set | `app/api/admin/invoices/[id]/route.ts:36-44` [V] — note: **admins can restore, end users cannot** [V] |
| Feedback status triage | `app/api/admin/feedback/[id]/route.ts:25-35` [V] |
| Admin CSV exports of invoices/users | `app/api/admin/export/*`, `lib/server/admin-export.ts` [V] |
| Charts: area trend, status donut, currency bar, activity heatmap, KPI cards | `components/admin/charts/*`, `components/admin/kpi-card.tsx` [V] |
| Server-driven table hook (paging/sorting) | `lib/hooks/use-server-table.ts`, `lib/server/pagination.ts` [V] — **this exists for admin only; the user dashboard does not use it** [V] |

---

## 2. The invoice data model and its limits

**The complete persisted field set** (`models/Invoice.ts:33-84`) [V]:
`userId, companyName, companyEmail, companyPhone, companyAddress, companyLogo, billTo, billToEmail, billToAddress, invoiceNumber, invoiceDate, dueDate, terms, notes, currency, items[{name, price, quantity}], subtotal, discount, tax(legacy), cgst, sgst, convenienceCharge, paymentInfo, total, status, is_deleted, createdAt`.

That is 27 fields. Note what the *item* subdocument is: **exactly three fields** — `name`, `price`, `quantity` (`models/Invoice.ts:62-68`) [V].

### 2.1 Your list, checked one by one

| You believed missing | Verdict | Evidence |
|---|---|---|
| **Per-line tax rate** | **Correct — missing.** Tax is two invoice-level rupee amounts only. | Item schema is 3 fields (`models/Invoice.ts:62-68`); `cgst`/`sgst` are scalars on the invoice (`:72-73`). `computeTotals` adds them once at invoice level (`lib/invoice-domain.ts:68-70`). Repo-wide grep for `taxRate`/`tax_rate`: **zero hits** [V-absent]. |
| **HSN/SAC code** | **Correct — missing.** | Grep for `hsn`/`HSN` across `app components lib models modules scripts tests`: **zero hits** [V-absent]. (`SAC` matches are substrings of `spacing`/`isActioning`, not the field.) |
| **Unit of measure** | **Correct — missing.** Quantity is a bare number. | `models/Invoice.ts:66`; no `uom`/`unit`/`unit_of_measure` field anywhere [V-absent]. |
| **GSTIN fields (seller + buyer)** | **Correct — missing.** | Grep `gstin`/`GSTIN`: **zero hits** [V-absent]. Seller identity is `companyName/Email/Phone/Address/Logo` only (`models/Invoice.ts:48-52`); buyer is `billTo/billToEmail/billToAddress` (`:53-55`). |
| **IGST** | **Correct — missing.** Only CGST+SGST exist. | `models/Invoice.ts:72-73`; formula `lib/invoice-domain.ts:69`; totals rows `lib/invoice-domain.ts:112-119` list CGST and SGST and nothing else. Grep `igst`: **zero hits** [V-absent]. **This means inter-state B2B invoicing is structurally impossible today.** |
| **Place of supply** | **Correct — missing.** | Grep `placeOfSupply`/`place_of_supply`: **zero hits** [V-absent]. Consequence: nothing can *decide* CGST+SGST vs IGST even if IGST existed [I]. |
| **Saved business profile** | **Correct — missing.** Company details are re-entered per invoice. | `createDefaultInvoiceFormState()` returns `companyName: ""`, `companyEmail: ""`, … (`lib/invoices.ts:132-139`) — **blank every time**, with no read from any profile store [V]. The `User` model has no business fields (`models/User.ts:4-38`) [V]. There is no settings page [V-absent]. |
| **Client/customer records** | **Correct — missing.** | Buyer is three free-text strings copied onto each invoice (`models/Invoice.ts:53-55`). No Client model; `ls models/` returns exactly `Feedback.ts Invoice.ts LogEntry.ts User.ts` [V]. |
| **Item catalog** | **Correct — missing.** | Same: only 4 models; items are inline subdocuments typed fresh each time [V]. |
| **Invoice-number sequencing/uniqueness** | **Correct — missing.** See §4 in full. | `invoiceNumber: { type: String, required: true }` — no `unique`, no index (`models/Invoice.ts:56`); the three declared indexes (`:90,95,96`) do not include it [V]. |
| **Attachments** | **Correct — missing.** No file upload anywhere in the product. | Grep `attachment` hits only Content-Disposition headers in admin CSV export routes [V]. The only "file-ish" field is `companyLogo`, a **URL string** (`models/Invoice.ts:52`) [V]. |
| **Payment records / partial payments** | **Correct — missing.** | `paymentInfo` is a free-text `String` rendered as a paragraph ("Payment Information", `lib/invoice-export.ts:408-409`) — **it is bank-details prose, not a payment record** [V]. `PATCH action:"settle"` sets `status:"paid"` and stores nothing else — no amount, no date, no method (`app/api/invoices/route.ts:392-393`) [V]. Grep `partialPay`/`installment`: zero hits [V-absent]. Note `app/about/page.tsx:26` markets "payment records" — that claim is unsupported by code. |
| **Recurring invoices** | **Correct — missing.** | Grep `recurring`: **zero hits** [V-absent]. |
| **Credit notes** | **Correct — missing.** | Grep `creditNote`/`credit_note`: **zero hits** [V-absent]. |
| **Multiple document types** (quote/estimate/proforma/delivery challan) | **Correct — missing.** | No `type`/`docType` discriminator on the schema (`models/Invoice.ts:33-84`) [V]. The export header is hardcoded to the word "INVOICE" [V] (see §6). |

**No corrections needed — every item on your list checks out.** Two things worth adding that you did not list:

- **Rounding-off line** (`₹` round-off to nearest rupee) is a near-universal Indian invoice line and is absent; the formula has no slot for it (`lib/invoice-domain.ts:55-73`) [V].
- **Amount in words** ("Rupees Twenty Thousand Only") — legally expected on Indian tax invoices, absent from both renderers [V-absent].
- **Reverse charge / e-invoice (IRN+QR) / e-way bill** — absent [V-absent]. These only bind above turnover thresholds, but a "real invoicing product for Indian users" will meet users who need them [I].
- **`tax` (legacy) is still a live write-path hazard**: the field remains in the schema (`models/Invoice.ts:71`) and read fallbacks exist in two places (`lib/invoices.ts:205`, `lib/invoice-domain.ts:87`) but **`normalizePayload` never writes it** (`app/api/invoices/route.ts:134-158`), so a legacy doc that is edited-and-saved keeps a stale non-zero `tax` alongside the new `cgst` — harmless only because `??` prefers `cgst` [V, correctness reasoning I].

### 2.2 Structural consequence
The schema is a **document snapshot with no relational spine**. Every invoice is a self-contained blob; nothing points at a customer, a product, a tax rate, or a company. That is the right shape for the *printed artifact* but it means: no "all invoices for Acme Ltd", no revenue-by-customer, no GSTR-1 export (which is organised by counterparty GSTIN and HSN), and no way to correct a client's address across historical invoices [I, grounded in the schema at `models/Invoice.ts:33-84`].

---

## 3. Reusable-entity gaps

**Confirmed absent [V]:** `ls models/` → `Feedback.ts, Invoice.ts, LogEntry.ts, User.ts`. `grep -rn "mongoose.model\|model(\"" models/ lib/` returns exactly four registrations: `User` (`models/User.ts:47`), `Feedback` (`models/Feedback.ts:38`), `LogEntry` (`models/LogEntry.ts:52`), `Invoice` (`models/Invoice.ts:99`). **No Client, no BusinessProfile/Settings, no Product/Item model exists** [V-absent].

### What adding one costs, given this architecture

The repo has a very consistent per-resource shape. Adding `Client` means reproducing all of it:

1. **Model** — `models/Client.ts`, mirroring `models/Invoice.ts:33-96`: `userId` with the non-empty validator (`:38-47`), `is_deleted` (`:82`), and a `{userId, is_deleted, createdAt}` compound index (`:90`) — the soft-delete + tenant conventions are not inherited from anywhere, they are copy-pasted per model [V].
2. **One route file** — `app/api/clients/route.ts` following `app/api/invoices/route.ts`: GET-list *and* GET-one on `?id=`, POST, PUT `?id=`, PATCH with an `action` union. That file is 442 lines for a single resource, and roughly 120 of them are boilerplate repeated per verb — `requireUser` + `authErrorResponse` (`:169-174, 219-224, 274-279, 346-351`), `connectDB()` (`:176`), the `CastError`→400 mapping (`:161-164, 200-202`), and the `logRouteError` + 500 block (`:204-215`) [V]. There is **no middleware and no route factory** to inherit any of it (CLAUDE.md states this; confirmed by the four near-identical auth blocks) [V].
3. **Three-shapes conversion layer** — `lib/invoices.ts` defines `InvoiceRecord` / `InvoiceFormState` / `InvoicePayload` (`:17-100`) plus `mapInvoiceRecordToFormState` (`:177-210`), `mapFormStateToPayload` (`:212-247`), `createDefaultInvoiceFormState` (`:127-155`). A new entity needs the same trio or it will not compose with the editor. Worse: the API **independently redeclares** the same shapes as `RawInvoicePayload`/`NormalizedInvoicePayload` (`app/api/invoices/route.ts:25-81`) — so the field set actually lives in **five** places for invoices (Mongoose schema, `IInvoice` interface, `InvoiceRecord`, `InvoiceFormState`+`InvoicePayload`, `RawInvoicePayload`+`NormalizedInvoicePayload`) [V]. Any new entity inherits that multiplication.
4. **Client API** — a `clientsApi` block in `lib/api-client.ts` (360 lines) alongside `invoicesApi`/`aiApi`/`feedbackApi` [V].
5. **UI** — list page, editor, and then the *integration point*: a picker in `components/InvoiceEditor.tsx` that fills `billTo/billToEmail/billToAddress`. Because `InvoiceEditor.tsx` is 1,177 lines of one component with `updateField` mutation [V], the picker is an edit inside that file, not a new file.

**The important design decision, unforced by the code:** a Client/Product reference must be **denormalised onto the invoice at save time** (copy the name/address/GSTIN into the invoice document), not stored as a `ref` — otherwise editing a client later silently rewrites the historical printed invoice, which is not acceptable for a tax document [I]. The current schema already denormalises everything (`models/Invoice.ts:48-55`), so the correct move is to *add* `clientId` as a soft pointer beside the copied fields, not to replace them.

**BusinessProfile is the cheapest and highest-leverage of the three** [I]: it needs no picker and no list UI — one document per user, one settings page, and one change at `lib/invoices.ts:132-139` where `createDefaultInvoiceFormState()` currently hardcodes empty company strings.

---

## 4. Invoice numbering

**Generation** — one line, client-side: `invoiceNumber: \`INV-${Date.now().toString().slice(-6)}\`` (`lib/invoices.ts:141`) [V]. That is the **last 6 digits of the epoch milliseconds**, i.e. it cycles every 10^6 ms ≈ **16 minutes 40 seconds**. It is not a sequence; it is a truncated clock. The field is freely editable by the user (`components/InvoiceEditor.tsx:616-618`) [V].

**Validation** — non-empty only: `validateInvoice` checks `!invoice.invoiceNumber.trim()` (`lib/invoice-domain.ts:144-146`) [V], enforced client-side at `components/InvoiceEditor.tsx:281` and server-side at `app/api/invoices/route.ts:231` [V]. No format check, no prefix rules, no length cap.

**Uniqueness — enforced nowhere** [V]:
- Schema: `invoiceNumber: { type: String, required: true }` — no `unique: true`, no index (`models/Invoice.ts:56`).
- Indexes declared: `{userId, is_deleted, createdAt}` (`:90`), `{is_deleted, createdAt}` (`:95`), `{is_deleted, status, currency}` (`:96`) — none touch `invoiceNumber`.
- API: `POST` does `new Invoice(...)` + `save()` with **no pre-existence check** (`app/api/invoices/route.ts:237-243`); `PUT` looks up by `_id` only (`:295-299`).

**What breaks:**
- **Concurrent creates**: two tabs (or two devices) opened inside the same 16m40s epoch window generate the *same* string, and both save successfully. There is no unique index to reject the second, and no transaction. [V from the above; failure mode I]
- **Duplicates generally**: a user who reloads `/create-invoice` twice quickly gets the same default number. Nothing warns them, and the dashboard has no duplicate detection [V-absent].
- **Financial years**: Indian practice is a per-FY series that resets on 1 April (`INV/2026-27/001`). Nothing in the codebase knows about financial years — grep for `financialYear`/`fiscal` returns nothing, and `invoiceDate` is a bare `Date` (`models/Invoice.ts:57`) [V-absent]. A truncated-epoch number is also **non-monotonic across the year boundary and non-sequential**, which violates the GST requirement of a consecutive serial number unique within a financial year [I].
- **Auditability**: because numbers are client-generated and freely editable, the same number can legitimately appear on two invoices for two different clients, and the export/CSV gives no way to disambiguate [V].

**Minimum fix**: a per-user counter document (or `findOneAndUpdate` with `$inc` on a `Counter` collection) + a `{userId, invoiceNumber}` **partial unique index** (partial so soft-deleted rows don't block reuse) + a configurable prefix/format in the business profile. The counter must be server-side; the current generator runs in the browser (`lib/invoices.ts:141` is called from `createDefaultInvoiceFormState`, a client-side function) [V].

---

## 5. Status lifecycle

**The states**: `draft | sent | paid | overdue` — declared four times: schema enum (`models/Invoice.ts:79`), `IInvoice` (`:28`), `InvoiceStatus` type (`lib/invoices.ts:9`), API `allowedStatuses` (`app/api/invoices/route.ts:130, 166`) [V].

**How status changes:**
- Manual dropdown in the editor with all four values (`components/InvoiceEditor.tsx:665-675`) [V] — the user can set "Paid" or "Overdue" by hand at any time, with no validation of the transition.
- `PATCH {action:"settle"}` → `status:"paid"` (`app/api/invoices/route.ts:392-393`) [V].
- `PATCH {status}` → arbitrary set, any value in the enum (`:407-408`) [V]. **There is no state machine**: paid→draft is permitted.
- Admin override: `app/api/admin/invoices/[id]/route.ts:42-44` [V].
- Soft delete is orthogonal (`is_deleted`), not a status (`app/api/invoices/route.ts:382-383`) [V].

**Is "overdue" ever computed automatically? Effectively no — and this is a live bug.** [V]
`getInvoiceStatus` (`lib/invoices.ts:275-287`) *does* contain due-date logic:
```
if (invoice.status) return invoice.status;      // :276-278
if (dueDate && dueDate < now) return "overdue"; // :283-285
return "sent";                                  // :287
```
But the early return at `:276` fires for every persisted invoice, because `normalizePayload` **always** emits a status, defaulting to `"draft"` (`app/api/invoices/route.ts:130-132`), and the schema also defaults it (`models/Invoice.ts:80`). So lines 280-287 are **unreachable for any record loaded from the API** — the due-date branch is dead code [V]. Every consumer (`app/dashboard/page.tsx:163-166, 337`, `components/InvoiceList.tsx:123`, `components/InvoiceModal.tsx:51`) therefore shows the stored status verbatim. **An invoice past its due date will keep displaying "sent" (or "draft") forever unless the user hand-edits it.** There is no cron/job that sweeps for overdue — the only cron is the Atlas keep-alive ping (`app/api/cron/keep-alive/route.ts`, and `vercel.json`) [V].

Downstream consequence: the dashboard's "outstanding" KPI counts `sent` + `overdue` (`app/dashboard/page.tsx:164-166`) [V], so it is arithmetically fine, but the *aging* signal a user actually needs ("₹X is more than 30 days late") does not exist [V-absent].

**Sent / viewed / partially paid:**
- `sent` exists as a *label the user picks*, but **nothing sends anything** — there is no email integration anywhere in the repo [V-absent] (no nodemailer/resend/sendgrid/postmark in `package.json`). So `sent` records an intention, not an event.
- `viewed` — no concept. There is no public/shareable invoice link, no tokenised view URL, no open-tracking [V-absent]. Every route is behind `requireUser`.
- `partially paid` — not in the enum (`models/Invoice.ts:79`), and there is no amount-paid field to make it meaningful [V].

**What real accounts-receivable tracking needs and does not have** [I, each grounded in the absences above]:
1. A `Payment` sub-collection or subdocument array: `{amount, date, method, reference}` → derived `amountPaid`, `balanceDue`, and a real `partially_paid` state.
2. Automatic overdue: either a scheduled sweep (`PATCH` all `status:"sent"` with `dueDate < now`) or — better, and cheaper here — make `overdue` a **derived** display state computed from `status !== "paid" && dueDate < now`, which means fixing the `getInvoiceStatus` early-return at `lib/invoices.ts:276`.
3. Aging buckets (0-30/31-60/61-90/90+) on the dashboard — needs no schema change, only the derived status above.
4. Reminder emails (needs an email provider, a template, and a send log) and a `sentAt` timestamp so `sent` becomes an event.
5. A shareable client-facing invoice URL, which is also the prerequisite for `viewed` and for any payment-link integration (Razorpay/UPI) [I].
6. Status transition guards in `PATCH` — today any status can be set from any status (`app/api/invoices/route.ts:407-408`).

---

## 6. Export / PDF layer (`lib/invoice-export.ts`, 478 lines)

**Architecture** [V]: no PDF library in `package.json` (confirmed — no jspdf/pdfkit/puppeteer/react-pdf). `createInvoiceHtml` (`:58-438`) returns a full self-contained HTML document string. "PDF export" is: build HTML with `autoPrint:true` → `new Blob` → `window.open` → the injected `window.print()` at `lib/invoice-export.ts:425-432` (`components/InvoiceModal.tsx:71-96`). Popup blocking is detected and surfaced with a real recovery instruction (`components/InvoiceModal.tsx:81-83`) [V] — good.

### 6.1 As a client-facing document — what's right
- **Escaping is disciplined.** Every interpolation goes through `toSafeValue`/`toLineBreaks` (`:18-24`) or `escapeHtml` on already-formatted currency/date strings (`:75-76, 341, 391`) [V]. Logo URL is protocol-allowlisted to http/https/data (`:36-52`) [V].
- **Totals cannot drift from the app preview** — both render `buildTotalsRows(amounts)` (`:385` and `lib/invoice-domain.ts:112-119`) [V].
- **A4 page box is declared correctly**: `@page { size: A4; margin: 14mm }` (`:297-300`) [V].
- **Print stylesheet** strips background, shadow, border-radius and the max-width (`:302-314`) [V].
- **`color-scheme: only light`** (`:90-92`) — prevents a dark-mode browser inverting the client's invoice [V]. Deliberate and correct.
- Tabular numerals on all figure columns (`:260-266`) [V].
- Line-item table renders a per-line Amount (`qty × price`, `:69`) [V].

### 6.2 As a client-facing document — what's wrong
| Problem | Evidence | Severity |
|---|---|---|
| **No page-break control at all.** There is no `break-inside: avoid`, no `thead { display: table-header-group }`, no `orphans`/`widows` rule anywhere in the stylesheet (`:89-315`) [V]. | On a multi-page invoice the browser will split a line-item row mid-cell, will **not repeat the column header on page 2**, and can strand the totals block alone on a final page. | **High** — this is the single most visible defect on any invoice with >~20 lines [I]. |
| **`.sheet { overflow: hidden }`** (`:114`) combined with print. | `overflow:hidden` on a block that grows past one page causes clipping in some print engines; it is not overridden in the `@media print` block (`:308-313` overrides border/shadow/max-width/radius but not `overflow`) [V]. | **High** — risk of silently truncated content. |
| **Document title is hardcoded `INVOICE`** (`:327`). | No "TAX INVOICE" / "PROFORMA" / "QUOTE" variants. Indian GST rules require the document be titled *Tax Invoice* (or *Bill of Supply* for composition/exempt). [V for the hardcode] | **High** for the Indian market. |
| **No GSTIN, HSN/SAC, place of supply, or tax-rate column.** The item table has exactly 5 columns: `#, Description, Qty, Unit Price, Amount` (`:369-375`) [V]. | A GST tax invoice legally needs supplier GSTIN, recipient GSTIN (B2B), HSN/SAC per line, taxable value per line, rate and amount of CGST/SGST/IGST, and place of supply. **None are representable** (§2). | **Blocking** for B2B India. |
| **No amount in words**, no signature block, no "Authorised Signatory" line, no company seal slot. | Not present anywhere in `:317-422` [V]. | Medium-High — Indian clients expect them. |
| **No rounding-off line**; totals ladder is fixed at 6 rows (`lib/invoice-domain.ts:112-119`) [V]. | | Medium |
| **Duplicated seller block.** Company name/address/email are printed twice: in the masthead `.brand` (`:329-333`) and again in the "Bill From" box (`:352-354`) [V]. | Wastes the top third of the page and looks like a template bug to a client. | Medium |
| **Empty fields print `-`.** `toSafeValue` returns `"-"` for blank (`:19`) [V], and it is applied unconditionally to `companyAddress`/`companyEmail` in the masthead (`:330-331`). | A user without an address gets a literal `-` on the client's invoice. | Medium |
| **Logo is a URL only** — no upload. `companyLogo` is a `String` (`models/Invoice.ts:52`), typed into a text field with a `https://…` placeholder (`components/InvoiceEditor.tsx:534`) [V]. | Consequences: (a) the user must self-host an image; (b) the printed PDF **fetches a remote image at print time** — if the host is down or slow, the logo silently vanishes from the client's document; (c) `data:` URIs are allowed by `toSafeImageUrl` (`:44`) but nothing produces one. The app-side preview at least detects load failure and hints (`components/InvoiceEditor.tsx:1072`, `:357`), but the **exported HTML has no such fallback** [V]. | **High** — an image upload + storage is table stakes. |
| **Logo box is 54×54 px** (`:138-147`) [V]. | Most company logos are wide, not square; `object-fit: contain` will shrink a wide logo to an illegible strip. | Medium |
| **Status pill printed on the client's invoice** (`:344`, styled `:173-181`) [V]. | The client should not see "DRAFT" or your internal "OVERDUE" flag on the document you hand them; and `.status` has a dark background with no `print-color-adjust: exact`, so in default print settings it may render as white-on-white [V for the missing property]. | Medium |
| **No localisation of the date format.** `formatDateLong` uses `en-US` unconditionally (`lib/invoices.ts:268`) [V] → "Aug 17, 2026" on an Indian invoice, where dd/mm/yyyy is expected. | Note the inconsistency: currency *is* localised to `en-IN` for INR (`lib/invoices.ts:251`) but the date is not. | Medium — easy fix, wrong-looking output. |
| **No responsive/mobile rule for the exported HTML.** The table is `width: calc(100% - 56px)` with fixed `px` column widths (`:212, 370-374`) [V]; the sheet is `max-width:880px` (`:109`). | A client opening the HTML on a phone gets a squeezed 5-column table. | Low-Medium |
| **No invoice-level "original/duplicate/triplicate" marking** — Indian practice for goods invoices [V-absent]. | | Low |
| **`window.print()` on a 150 ms timeout** (`:427-430`) [V]. | If a remote logo has not loaded within 150 ms of `load`, it may print blank. Should await `img.decode()` / `document.fonts.ready`. | Medium |

### 6.3 CSV shape (`createInvoiceCsv`, `:440-478`)
Structure [V]: a 6-row header block (`Invoice Number, Company, Client, Invoice Date, Due Date, Currency`), a blank row, an item table (`Item, Quantity, Unit Price, Amount`), a blank row, then the 6 totals rows. Every cell is quoted and `"`-doubled (`:473`), and formula-injection-neutralised via `neutralizeCsvValue` (`:29-34, 472`) [V].
**Assessment:** this is a *human-readable report*, not a machine-ingestible CSV — the blank rows and the mid-file header change mean it cannot be `pd.read_csv`'d or imported into Tally/Zoho. There is **no multi-invoice CSV export for end users at all** (the only bulk CSV is admin-only: `app/api/admin/export/invoices/route.ts`) [V]. For an accountant handover you need a flat one-row-per-line-item export across a date range; that does not exist [V-absent].

### 6.4 JSON shape
`JSON.stringify(invoice, null, 2)` of the raw API record (`components/InvoiceModal.tsx:31`) [V] — i.e. it leaks `_id`, `userId`, `is_deleted`, `__v`, and the legacy `tax` field into a file the user may forward. Minor privacy/polish issue [V + I]. There is no documented schema and no import counterpart.

### 6.5 Export telemetry
Every export fires `eventsApi.emit({event:"report.generated", meta:{format, invoiceId}})` (`components/InvoiceModal.tsx:104, 116, 128` and the PDF path) [V], validated server-side against an allow-list (`app/api/events/route.ts:16, 47-51`) [V]. Clean.

---

## 7. The AI invoice assistant (`lib/ai/invoice-assistant/*`, 6 files)

### 7.1 What it can do
Natural language → a **patch of invoice form fields**, merged client-side into the in-memory draft. It never touches the database [V]: `POST /api/ai/invoice-assistant` returns a JSON `InvoiceAssistantResponse` (`app/api/ai/invoice-assistant/route.ts:124`) and the only consumer is `InvoiceEditor.applyAiPatch` (`components/InvoiceEditor.tsx:447`) — no `Invoice` model import in the AI route [V].

Patchable field set — **19 fields** (`lib/ai/invoice-assistant/contracts.ts:10-31`) [V]: the whole form *except* `status` (deliberately excluded; prompt rule 9 tells the model not to emit it, `lib/ai/invoice-assistant/prompt.ts:69`) [V].

The response also carries `resolution: "ready" | "needs_clarification"`, `assistantMessage`, `clarifyingQuestions[]`, `missingFields[]` (`contracts.ts:41-47`) [V] — so it is a multi-turn clarifying flow, not one-shot extraction.

Provider: Gemini via raw `fetch` to `generativelanguage.googleapis.com/v1beta/…:generateContent` (`provider.ts:109-134`) [V]. Config: `GEMINI_API_KEY`, `GEMINI_MODEL` (default `gemini-2.5-flash`, `provider.ts:10`), `INVOICE_AI_PROVIDER` (only `"gemini"` accepted, `provider.ts:90-92`) [V]. `temperature: 0.1`, `maxOutputTokens: 2048`, `responseMimeType: "application/json"` (`provider.ts:126-130`) [V].

### 7.2 Request caps / hardening (all verified)
| Cap | Value | Where |
|---|---|---|
| Prompt length | 4,000 chars, server-side truncation | `service.ts:13, 17` |
| Conversation history | last 12 entries server-side; last 10 serialized into the prompt; client also caps at 12 | `service.ts:14, 40`; `prompt.ts:79`; `components/InvoiceAiAssistant.tsx:28, 69` |
| Provider timeout | 20 s via `AbortController` | `provider.ts:12, 104-105, 162-164` |
| Assistant message | 1,200 chars | `normalization.ts:23, 36` |
| Clarifying question | 260 chars | `normalization.ts:24` |
| Field-name string | 48 chars | `normalization.ts:25` |
| Items per patch | 40 max; description 250 chars | `normalization.ts:104, 124` |
| Numbers | `Math.max(0, …)` / `Math.max(1, …)`, 2 dp, non-finite dropped | `normalization.ts:80-94` |
| Dates | strict `YYYY-MM-DD` with real calendar validation (rejects `2026-02-31`) | `normalization.ts:39-78` |
| Currency | must be in `CURRENCY_OPTIONS` | `normalization.ts:49-52` |
| Auth | `requireUser` + email-verified gate | `app/api/ai/invoice-assistant/route.ts:83` |
| Error taxonomy | quota→429, bad key→503, timeout→504, bad JSON→502, model missing→503 | `route.ts:21-78` |
| Key safety | telemetry deliberately excludes the request URL (key is in the query string) | `provider.ts:150-151` |

**Gaps in the hardening** [V/I]:
- **No per-user rate limit and no cost cap.** `/api/feedback` and `/api/events` both have in-process limiters (`app/api/feedback/route.ts:12-25`, `app/api/events/route.ts:19-33`) but **the AI route has none** [V-absent]. A signed-up user can loop the endpoint and spend your Gemini budget. This is the single most important pre-launch fix in this module [I].
- **The full prompt is logged to MongoDB** on every request (`route.ts:97-109`, `meta.fullPrompt`) — the comment says it is size-capped/redacted by the writer. That means user-entered client names, addresses and amounts land in the log collection; TTL applies (`models/LogEntry.ts:38-43`) but it is still a PII store an Indian DPDP-conscious launch should account for [V + I].
- `AI_MAX_ITEMS = 40` vs the invoice's real ceiling — items are re-clamped at `mapFormStateToPayload` (`lib/invoices.ts:233-237`), so no divergence [V].
- `clampToLimit`'s `MAX_MONEY_VALUE` is **not** applied inside `normalization.ts` — an AI-emitted `discount: 1e12` survives normalization and is only clamped later at `mapFormStateToPayload` (`lib/invoices.ts:238`) and again at the API (`app/api/invoices/route.ts:121`) [V]. Correct in the end, but the AI layer is the one layer that doesn't enforce the shared ceilings.

### 7.3 Why it is create-mode-only
Verified, and it is a UI gate, not a server one:
- The toggle button renders only under `mode === "create"` (`components/InvoiceEditor.tsx:403-413`) [V].
- The panel itself renders only under `mode === "create" && isAiPanelVisible` (`components/InvoiceEditor.tsx:442`) [V].
- **The API does not check mode at all** — `POST /api/ai/invoice-assistant` accepts any authenticated request with a `draft` (`app/api/ai/invoice-assistant/route.ts:88-93`, `service.ts:28-30`) [V].

The likely reason (inferred, not documented in code): `applyInvoiceAssistantPatch` **replaces the whole `items` array** rather than merging per-row (`apply-patch.ts:32-50` builds a fresh normalized array; the caller assigns it wholesale) [V]. On an existing saved invoice that is a destructive operation with no undo, whereas on a blank draft it is harmless [I]. Enabling edit-mode therefore needs either per-item merge semantics or a diff/confirm step — it is **not** a one-line flag flip.

### 7.4 What extending the field set costs
The field list is **duplicated in four files and must be edited in lockstep** [V]:
1. `lib/ai/invoice-assistant/prompt.ts:36-57` — the JSON schema literal inside the system prompt (plus any new rule, cf. rule 11 at `:71`).
2. `lib/ai/invoice-assistant/contracts.ts:10-31` — the `InvoiceAssistantPatch` interface.
3. `lib/ai/invoice-assistant/normalization.ts:16-30` — the `stringFieldKeys` array, plus a bespoke branch for any non-string type (dates `:39-47`, currency `:49-52`, items `:54-57`, numbers `:59+`).
4. `lib/ai/invoice-assistant/apply-patch.ts` — the merge, which has its own per-type helpers (`:28-57`).

There is **no shared schema object** driving all four; nothing fails at compile time if you add a field to `contracts.ts` and forget `normalization.ts` — it will simply be silently dropped, because `buildPatch` only copies keys it explicitly knows (`normalization.ts:32-37`) [V]. Adding, say, HSN per line item means editing the prompt schema, the item type in `lib/invoices.ts`, the item normalizer at `normalization.ts:96-125`, the merge at `apply-patch.ts:32-50`, **and** the five non-AI declarations of the item shape listed in §3. Realistically **M-to-L for any line-item-level field**.

---

## 8. Test coverage map

**10 files, ~1,337 lines of tests**, Bun runner (`package.json:"test": "bun test"`) [V].

| File | Covers |
|---|---|
| `tests/invoice-domain.test.ts` (162) | `computeTotals` incl. clamp-at-0 and empty-quantity; `resolveRecordAmounts` incl. legitimately-zero stored total, legacy `tax` fallback; `buildTotalsRows` ordering; `validateInvoice` per-field + DB-shaped items [V] |
| `tests/invoices.test.ts` (169) | `calculateInvoiceTotals`, clamping, rounding; `mapInvoiceRecordToFormState` legacy-tax fallback + field renaming; `mapFormStateToPayload` trim/clamp/ceilings/fractional qty; `getInvoiceStatus`; `formatCurrency` [V] |
| `tests/numeric-input.test.ts` (203) | The whole `lib/numeric-input.ts` decision layer — sanitize/parse/live/commit/format, the "1→''→8 gives 8" regression, draft resync. **The most thorough file in the repo** [V] |
| `tests/invoice-export.test.ts` (90) | CSV formula injection (`=`,`+`,`-`,`@`); CSV totals clamp + zero-total honoring; HTML escaping; `javascript:` logo URL rejection; legacy tax in export [V] |
| `tests/invoices-isolation.test.ts` (182) | Cross-tenant isolation for all five verbs — GET?id, GET list, POST userId spoofing, PUT, PATCH soft_delete, PATCH settle [V] |
| `tests/admin-auth.test.ts` (99) | `requireAdmin` fail-closed matrix (no row / non-admin / suspended / legacy row); `assertNotSelf`; `assertNotLastActiveAdmin` [V] |
| `tests/auth-user-sync.test.ts` (102) | The account-takeover rule: unverified email → uid-only lookup, no invoice reassignment; verified → link + reassign [V] |
| `tests/ai-normalization.test.ts` (113) | JSON fence stripping, invalid JSON, cgst/sgst accepted, legacy `tax` dropped, clamping, 40-item cap, resolution upgrade, **prototype-pollution rejection** in `applyInvoiceAssistantPatch` [V] |
| `tests/api-client.test.ts` (178) | `authedFetch` bearer attach, typed `ApiError`/`UnauthenticatedError`, network vs abort/timeout, abort-signal presence, status fallback copy, `describeRequestError` retryability [V] |
| `tests/log-swallow.test.ts` (39) | `logEvent`/`recordActivity`/`logRouteError` never throw and return void (cannot block a handler) [V] |

**The coverage is genuinely good on the parts it covers** — it is characterization-style, targets the historical bugs, and every money/security invariant that has a single home is pinned.

### Highest-risk uncovered areas (ordered)
1. **`components/InvoiceEditor.tsx` (1,177 lines) — zero tests** [V-absent]. No test file imports it. This holds the %/₹ CGST-SGST mode effects (`:162-181`), `saveInvoice` (`:262+`), and `applyAiPatch`. The percent-mode `useEffect` writes derived tax back into state on every subtotal change — exactly the kind of loop that regresses silently.
2. **`components/InvoiceModal.tsx` money math — zero tests, and it is wrong** (see §9, item 1) [V].
3. **`app/api/invoices/route.ts` `normalizePayload`** is only exercised indirectly through the isolation test's mocks; there is no test that a hostile payload (string numbers, extra fields, `status` injection, missing items) round-trips correctly [V-absent].
4. **No route-level integration tests for `/api/feedback`, `/api/events`, `/api/ai/invoice-assistant`, or any `/api/admin/*` handler** — only the pure helper (`requireAdmin`) is tested [V-absent]. The rate limiters are untested.
5. **`lib/invoice-export.ts` HTML layout** — escaping is tested but nothing checks the *document* (page breaks, totals presence, multi-page). Untestable without a renderer, but at minimum a snapshot of the produced HTML would catch template regressions [I].
6. **No E2E / browser tests at all** — no Playwright/Cypress in `package.json` [V-absent]. The print flow, the popup-blocked path, and Google sign-in are entirely manual (README QA checklist).
7. **`lib/server/log.ts` TTL computation** — only the swallow behavior is tested, not that `expireAt` is actually longer for errors [V-absent].
8. **Mongoose schema-level behavior** (defaults, the `userId` validator, `providerIds` setter) is untested [V-absent].

---

## 9. Dead code, duplication, stale config

### 9.1 Real bug found: a fourth money formula in `InvoiceModal`
CLAUDE.md states `computeTotals` has exactly three delegating call sites. **There is a fourth path that does not delegate at all** — `components/InvoiceModal.tsx:52-59` [V]:
```
const subtotal = invoice.subtotal ?? invoice.items.reduce((s,i) => s + i.quantity*i.price, 0);
const discount = invoice.discount || 0;
const cgst = invoice.cgst ?? invoice.tax ?? 0;
const sgst = invoice.sgst || 0;
const convenienceCharge = invoice.convenienceCharge || 0;
const total = invoice.total || subtotal - discount + cgst + sgst + convenienceCharge;
```
and its totals ladder is hand-written JSX at `:325-348`, **not** `buildTotalsRows` [V]. Three concrete divergences from `resolveRecordAmounts` (`lib/invoice-domain.ts:80-97`):
- **`invoice.total || …` uses `||`, not `??`** — a legitimately-zero stored total is treated as falsy and recomputed. `resolveRecordAmounts` uses `??` specifically to avoid this (`lib/invoice-domain.ts:95`) and `tests/invoice-export.test.ts:59` pins that behavior for the export. **The view modal and the exported PDF can therefore show different totals for the same invoice.**
- **No clamp at 0** — an over-discounted invoice shows a negative total in the modal, while the export shows `0.00` (`tests/invoice-export.test.ts:46`).
- **No per-step `toFixed(2)`** — float dust can surface.
Fix is small (swap in `resolveRecordAmounts` + `buildTotalsRows`) but it is a correctness bug in the screen users look at most. **S.**

### 9.2 Stale/duplicate config — CLAUDE.md's claims verified
| Claim | Verdict |
|---|---|
| `tailwind.config.ts` is a stale stub, `tailwind.config.js` is real | **Confirmed** [V]. `tailwind.config.ts` (18 lines) has no `darkMode`, no shadcn HSL tokens, no `tailwindcss-animate`, and no `./lib/**` glob; `tailwind.config.js` has all of them, and `components.json:"tailwind.config": "tailwind.config.js"` names the `.js` one. **Deleting `tailwind.config.ts` is safe and should be done** — Tailwind 3 resolves `.ts` before `.js` in some setups, so this file is a live footgun, not merely dead. |
| `postcss.config.mjs` vs `postcss.config.js` | **Confirmed duplicate, and they differ** [V]: `.js` has `tailwindcss + autoprefixer`; `.mjs` has `tailwindcss` only. If the `.mjs` ever wins, **autoprefixer silently stops running**. Delete `postcss.config.mjs`. |
| `eslint-config-next` pinned to 15.x while Next is 16.x | **Confirmed** [V]: `package.json` `"next": "^16.1.6"` vs `"eslint-config-next": "15.1.7"`. |
| `components.json` declares lucide but radix icons are used | **Confirmed, with nuance** [V]: `components.json:"iconLibrary": "lucide"`; 32 references to `@radix-ui/react-icons` vs **2** to `lucide-react` (`components/ui/calendar.tsx:5`, `components/ui/dropdown-menu.tsx:5`) — so lucide is a real dependency for two vendored shadcn files, not fully dead. |
| `components.json:"rsc": true` while every page is `"use client"` | **Confirmed** [V] — misleading to anyone running `shadcn add`. |
| `connectDB()` lacks a cached connection promise | **Confirmed** [V] — see `lib/mongodb.ts`. |
| Dockerfile builds with `bunx next build --webpack` vs Turbopack in dev | **Confirmed** [V] — `Dockerfile:15`. |

### 9.3 Additional findings (not in CLAUDE.md)
1. **CLAUDE.md is itself stale in one place**: it says "A `jsonwebtoken` HS256 session token is also minted". `jsonwebtoken` is **gone from `package.json`**; tokens are minted with `jose` (`lib/server/session-token.ts`, `next.config.ts:4-6` comment) [V]. Cosmetic, but the auth section of the guide should be corrected.
2. **Unused dependency `shadcn-ui@^0.9.4` in `dependencies`** — zero source references [V]. It is a CLI; shipping it as a runtime dep bloats the production install. Also `baseline-browser-mapping` and `mongodb` have **zero direct imports** (`mongodb` comes in transitively via mongoose; the explicit dep is redundant) [V].
3. **Dead components**: `components/ui/hero.tsx` and `components/ui/separator.tsx` have **zero importers** [V]. (The three `aceternity/*` files *are* used — via `components/landing.tsx:4` and `components/ui/atmosphere.tsx:1-2` — so they are not dead [V].)
4. **`getInvoiceStatus`'s due-date branch is dead code** in production (see §5) — `lib/invoices.ts:280-287` is unreachable for any API-loaded record, yet `tests/invoices.test.ts:156-160` tests it, which makes the test suite *look* like overdue works. This is the most dangerous kind of dead code: tested, believed-working, never executed [V].
5. **`tax` legacy field**: still in the schema (`models/Invoice.ts:71`) and read in three places (`lib/invoices.ts:205`, `lib/invoice-domain.ts:87`, `components/InvoiceModal.tsx:56`) but written nowhere. It will remain forever unless a cleanup migration drops it [V].
6. **Four near-identical auth+connectDB+error blocks in one file** (`app/api/invoices/route.ts:169-176, 219-226, 274-281, 346-353`) plus the same 500-handler shape four times (`:204-215, 258-269, 326-342, 425-441`) [V]. ~120 lines of pure boilerplate that a `withUser(handler)` wrapper would remove — and that every new resource would otherwise re-copy (§3).
7. **`allowedStatuses` declared twice in the same file** — `app/api/invoices/route.ts:130` (inside `normalizePayload`) and `:166` (module scope) [V].
8. **The status string union is declared 4× and the field set 5×** (§3) — no single source of truth for the invoice shape [V].
9. **In-process rate limiters** in `app/api/feedback/route.ts:14` and `app/api/events/route.ts:22` are `Map`s in module scope. On Vercel's serverless model each instance has its own map, so the effective limit is `N_instances × limit` and resets on cold start [V + I]. Fine for feedback; **not fine as the model for the AI route's missing limiter** — that one needs a shared store.
10. **`next.config.ts` allows remote images from `via.placeholder.com`** (`:16-17`) [V] — a placeholder host in production config.
11. **`app/about/page.tsx:26` markets "payment records"**, which do not exist (§2) [V] — a launch-blocking accuracy issue for a paid product page, minor for a free one.
12. **No `robots.txt`/`sitemap.ts`, no per-page `metadata`** beyond the root `title: "Invoicey"` (`app/layout.tsx:10-19`) [V] — every marketing page shares one title/description. Bad for a public launch.
13. **`tsconfig` `target: "ES2017"`** with `String.prototype.replaceAll` used in `lib/invoice-export.ts:11-15` — fine at runtime (lib is `esnext`) but the target is unnecessarily old [V, low priority].

---

## 10. Effort sizing

Sizing assumption: one experienced solo dev with an AI coding assistant. **S** < 1 day · **M** 1-3 days · **L** > 3 days. All paths absolute-relative to `/home/faran/projects/invoicey/`.

### Tier 0 — Correctness/hygiene fixes that block nothing but should ship first
| # | Gap | Size | Files |
|---|---|---|---|
| 0.1 | InvoiceModal's fourth money formula → use `resolveRecordAmounts` + `buildTotalsRows` (§9.1) | **S** | `components/InvoiceModal.tsx:52-59, 325-348` |
| 0.2 | Delete `tailwind.config.ts` + `postcss.config.mjs`; drop `shadcn-ui`, `baseline-browser-mapping`, `mongodb` deps; delete `components/ui/hero.tsx`, `components/ui/separator.tsx`; drop `via.placeholder.com` | **S** | those files, `package.json`, `next.config.ts:16-17` |
| 0.3 | Bump `eslint-config-next` to 16.x | **S** | `package.json` |
| 0.4 | **AI route rate limit + monthly cost cap** (the only genuinely urgent one — an unmetered paid API behind a free signup) | **S-M** (S in-process, M with a shared store) | `app/api/ai/invoice-assistant/route.ts`, new `lib/server/rate-limit.ts` |
| 0.5 | Cache the Mongo connection promise (`lib/mongodb.ts:24-40` re-races `connect()` under concurrent cold-start requests) | **S** | `lib/mongodb.ts` |
| 0.6 | `withUser()` route wrapper to kill the 4× auth/connect/error boilerplate before it is copied into new resources (§3, §9.3-6) | **S** | `lib/server/auth.ts`, `app/api/invoices/route.ts` |
| 0.7 | Date format `en-US` → locale-aware / `en-IN` | **S** | `lib/invoices.ts:262-273` |
| 0.8 | Per-page `metadata`, `robots.txt`, `sitemap.ts`; fix the "payment records" claim | **S** | `app/*/page.tsx`, `app/about/page.tsx:26`, new `app/robots.ts`, `app/sitemap.ts` |

### Tier 1 — Foundations (everything else depends on these)
| # | Gap | Size | Files |
|---|---|---|---|
| 1.1 | **Business profile / settings** — model, `GET/PUT /api/settings`, settings page, prefill in `createDefaultInvoiceFormState` | **M** | new `models/BusinessProfile.ts`, new `app/api/settings/route.ts`, new `app/settings/page.tsx`, `lib/invoices.ts:127-155`, `lib/api-client.ts`, `components/InvoiceEditor.tsx` |
| 1.2 | **Logo upload + storage** (replaces the URL field; needed for reliable print) | **M** | new `app/api/upload/route.ts` (or a signed-URL flow to S3/R2/Cloudinary), `components/InvoiceEditor.tsx:524-540`, `models/BusinessProfile.ts`, `lib/invoice-export.ts:36-52` |
| 1.3 | **Server-side invoice numbering** — `Counter` model, atomic `$inc`, `{userId, invoiceNumber}` partial unique index, FY-aware format string in the profile, duplicate-detection on save | **M** | new `models/Counter.ts`, `models/Invoice.ts:56,90`, `app/api/invoices/route.ts:237-243`, `lib/invoices.ts:141`, new `lib/invoice-number.ts` |
| 1.4 | **Dashboard pagination + search + filter + sort** (the list endpoint is unbounded today) | **M** | `app/api/invoices/route.ts:194-198`, `app/dashboard/page.tsx`, reuse `lib/hooks/use-server-table.ts` + `lib/server/pagination.ts` |
| 1.5 | Derived overdue status + aging buckets (fix `lib/invoices.ts:276`) | **S** | `lib/invoices.ts:275-287`, `app/dashboard/page.tsx:162-192`, `tests/invoices.test.ts` |

### Tier 2 — GST correctness (the actual "Indian invoicing product" bar)
| # | Gap | Size | Files |
|---|---|---|---|
| 2.1 | **GSTIN on seller (profile) + buyer (client/invoice)**, with checksum validation | **M** | `models/BusinessProfile.ts`, `models/Invoice.ts`, `lib/invoices.ts` (3 shapes), `app/api/invoices/route.ts:25-158`, `components/InvoiceEditor.tsx`, `lib/invoice-export.ts:319-365`, new `lib/gstin.ts` |
| 2.2 | **Place of supply + state codes + IGST**, with automatic intra/inter-state derivation | **L** | `models/Invoice.ts`, `lib/invoice-domain.ts:33-119` (TotalsInput, computeTotals, buildTotalsRows — this changes the *formula*, so every §2 call site + all money tests), `app/api/invoices/route.ts`, `components/InvoiceEditor.tsx:900-1010`, `lib/invoice-export.ts:382-399`, `components/InvoiceModal.tsx`, `lib/ai/invoice-assistant/{prompt,contracts,normalization,apply-patch}.ts`, `tests/invoice-domain.test.ts` |
| 2.3 | **Per-line tax rate + HSN/SAC + UOM** — the item subdocument grows from 3 fields to ~7, and tax becomes per-line-derived rather than invoice-level | **L** | `models/Invoice.ts:62-68`, `lib/invoices.ts:11-15,48-52,196-247`, `lib/invoice-domain.ts:28-73`, `app/api/invoices/route.ts:17-23,96-110`, `components/InvoiceEditor.tsx` (item grid), `lib/invoice-export.ts:67-80,367-380`, `components/InvoiceModal.tsx`, all four AI files, `tests/invoice-domain.test.ts`, `tests/invoices.test.ts` |
| 2.4 | Document title variants ("Tax Invoice"/"Bill of Supply"/"Proforma"/"Quote") + a `docType` discriminator | **M** | `models/Invoice.ts`, `lib/invoice-export.ts:327`, `components/InvoiceEditor.tsx`, `components/InvoiceModal.tsx` |
| 2.5 | Amount in words, rounding-off line, signature block | **S-M** | new `lib/amount-in-words.ts`, `lib/invoice-domain.ts:112-119`, `lib/invoice-export.ts:382-421`, `components/InvoiceModal.tsx` |
| 2.6 | GSTR-1-shaped export (B2B/B2C sections, HSN summary) — depends on 2.1-2.3 | **M** | new `lib/gst-return-export.ts`, new `app/api/exports/gstr1/route.ts` |

### Tier 3 — Reusable entities
| # | Gap | Size | Files |
|---|---|---|---|
| 3.1 | **Client/customer records** + picker (denormalise onto invoice at save; keep `clientId` as a soft pointer) | **M-L** | new `models/Client.ts`, new `app/api/clients/route.ts`, new `app/clients/page.tsx`, `lib/api-client.ts`, `components/InvoiceEditor.tsx`, `models/Invoice.ts` (add `clientId`) |
| 3.2 | **Item/product catalog** + line-item autocomplete (carries default price, HSN, tax rate → depends on 2.3) | **M-L** | new `models/Product.ts`, new `app/api/products/route.ts`, new `app/products/page.tsx`, `components/InvoiceEditor.tsx` |
| 3.3 | Invoice templates / saved terms+payment info presets | **S** | `models/BusinessProfile.ts`, `components/InvoiceEditor.tsx` |

### Tier 4 — Accounts receivable + delivery
| # | Gap | Size | Files |
|---|---|---|---|
| 4.1 | **Payment records** (`{amount, date, method, reference}`) → `amountPaid`/`balanceDue`/`partially_paid` | **M** | `models/Invoice.ts:77-81` (enum) + new payments array or `models/Payment.ts`, `app/api/invoices/route.ts:392-405`, `lib/invoice-domain.ts`, `app/dashboard/page.tsx`, `components/InvoiceModal.tsx` |
| 4.2 | **Email delivery** (provider + template + `sentAt` + send log) — no email dependency exists today | **M-L** | new `lib/server/email.ts`, new `app/api/invoices/send/route.ts`, `package.json`, `models/Invoice.ts` |
| 4.3 | **Public shareable invoice link** (tokenised, unauthenticated read) → unlocks `viewed` status and payment links | **M** | new `app/i/[token]/page.tsx`, new `app/api/public/invoice/[token]/route.ts`, `models/Invoice.ts` (share token) |
| 4.4 | Payment gateway / UPI QR (Razorpay) | **L** | new `lib/server/payments.ts`, webhook route, `models/Invoice.ts`, 4.1 + 4.3 as prerequisites |
| 4.5 | Reminder emails + overdue sweep cron | **M** | new `app/api/cron/reminders/route.ts`, `vercel.json`, 4.2 as prerequisite |
| 4.6 | Status transition guards | **S** | `app/api/invoices/route.ts:407-408` |

### Tier 5 — Document types & compliance extras
| # | Gap | Size | Files |
|---|---|---|---|
| 5.1 | **Credit / debit notes** (reference the original invoice, negative-signed) | **L** | `models/Invoice.ts` (`docType`, `againstInvoiceId`), `lib/invoice-domain.ts`, editor, export, dashboard |
| 5.2 | **Recurring invoices** (schedule + generator cron) | **L** | new `models/RecurringInvoice.ts`, new `app/api/cron/recurring/route.ts`, `vercel.json`, editor |
| 5.3 | **Attachments** (needs 1.2's storage) | **M** | `models/Invoice.ts`, upload route, editor, modal |
| 5.4 | e-Invoice IRN/QR + e-way bill (IRP/GSP integration) | **L** | new integration module; only relevant above turnover thresholds |
| 5.5 | Multi-user/team accounts, roles beyond `user|admin` | **L** | `models/User.ts`, `lib/server/auth.ts`, every `userId` filter in `app/api/invoices/route.ts` |
| 5.6 | Account deletion + data export (DPDP/GDPR) | **M** | new `app/api/account/route.ts`, `models/*` |

### Tier 6 — Print/PDF quality
| # | Gap | Size | Files |
|---|---|---|---|
| 6.1 | Page-break CSS (`thead` repeat, `break-inside: avoid`, remove `overflow:hidden` in print), await image/font load before `print()`, drop the duplicated seller block, hide the status pill, fix `-` placeholders, responsive logo box | **S-M** | `lib/invoice-export.ts:108-116, 297-315, 319-346, 423-434` |
| 6.2 | Server-side true PDF (Puppeteer/Chromium or a hosted render service) — needed the moment you email invoices (4.2) | **M-L** | new `app/api/invoices/[id]/pdf/route.ts`; note Vercel serverless size limits make this non-trivial |
| 6.3 | Flat multi-invoice CSV export for accountants (one row per line item, date range) | **S-M** | new `lib/invoice-export.ts` function + `app/api/exports/invoices/route.ts` (mirror `app/api/admin/export/invoices/route.ts`) |

### Tier 7 — Test debt
| # | Gap | Size |
|---|---|---|
| 7.1 | Tests for `InvoiceEditor` percent-mode effects + `saveInvoice` + `applyAiPatch` | **M** |
| 7.2 | Route-handler tests for `normalizePayload`, feedback, events, AI, admin mutations | **M** |
| 7.3 | Playwright E2E: sign-up → verify → create → export → settle | **M-L** |

---

## Dependency-ordered build list

Each step is blocked by the ones above it. This is the order to actually build in.

```
 0. Tier-0 hygiene (0.1 modal totals bug, 0.4 AI rate limit, 0.5 conn cache,
    0.6 withUser wrapper, 0.2/0.3 config cleanup)
    └── 0.6 first if any new resource is coming, or you copy the boilerplate again.

 1. BUSINESS PROFILE  (1.1)
    ├── unblocks: logo storage, invoice-number format, seller GSTIN, default terms
    └── 1.2 LOGO UPLOAD  (needs a storage decision; also fixes print reliability)

 2. INVOICE NUMBERING  (1.3)   ← needs the profile (format/prefix/FY lives there)
    └── partial unique index + server counter, before you have volume to migrate

 3. DASHBOARD SCALE  (1.4 pagination/search/filter) + DERIVED OVERDUE (1.5)
    └── 1.5 is independent and can land any time; 1.4 gets harder the more rows exist

 4. GST FIELD SET
    4a. GSTIN seller+buyer            (2.1)  ← needs profile (1.1)
    4b. Place of supply + state codes (2.2a) ← needs 4a
    4c. IGST + intra/inter derivation (2.2b) ← needs 4b; CHANGES computeTotals
    4d. Per-line HSN/SAC + UOM + rate (2.3)  ← land with or right after 4c so the
        totals formula is rewritten ONCE, not twice
    4e. Doc-type title, amount in words, rounding, signature (2.4, 2.5)
    4f. GSTR-1 export (2.6)                  ← needs 4a-4d

 5. PRINT QUALITY  (6.1)  ← do after 4e, so the new blocks are laid out once
    └── 6.3 accountant CSV can go in parallel

 6. CLIENT RECORDS (3.1)   ← needs 4a (a client must carry a GSTIN + state)
    └── ITEM CATALOG (3.2) ← needs 4d (a product must carry HSN + tax rate)
    └── TEMPLATES/PRESETS (3.3)

 7. ACCOUNTS RECEIVABLE
    7a. Payment records + partial paid   (4.1)  ← needs 1.5 (derived status)
    7b. Status transition guards         (4.6)  ← needs 7a (new states exist)
    7c. Email delivery + sentAt          (4.2)  ← needs 6.2 server-side PDF (or
                                                   attach the HTML) and 5 (print quality)
    7d. Public shareable link            (4.3)  ← independent of 7c but pairs with it
    7e. Reminders + overdue sweep cron   (4.5)  ← needs 7c
    7f. Payment gateway / UPI            (4.4)  ← needs 7a + 7d

 8. DOCUMENT TYPES
    8a. Credit/debit notes (5.1)  ← needs 4c/4d (a note must reverse the same tax
                                     breakdown) and 2 (numbering series per type)
    8b. Recurring invoices (5.2)  ← needs 2 (numbering) + 6 (client records)
    8c. Attachments        (5.3)  ← needs 1.2 (storage)

 9. COMPLIANCE / SCALE TAIL
    9a. Account deletion + data export (5.6)   ← ship before/at public launch
    9b. e-Invoice IRN/QR, e-way bill   (5.4)   ← only above turnover thresholds
    9c. Teams/multi-user               (5.5)   ← touches every userId filter; last

 Throughout: Tier-7 tests alongside each change, not after.
```

**The three things that must happen before any public release**, in order: (0.4) an AI cost cap, (1.1+1.3) a business profile and a real invoice-numbering scheme, and (4a-4d) the GST field set — without the last one, the product cannot produce a legally valid Indian tax invoice, which is the single claim its market cares about.
