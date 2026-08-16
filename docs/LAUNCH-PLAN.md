# Invoicey — Public Launch Plan (India)

Synthesis of five parallel audits, 2026-08-17. Full evidence in `docs/research/`:
`gst-compliance.md`, `market-competitors.md`, `codebase-audit.md`, `ux-audit.md`,
`prod-readiness.md`. Every claim below traces to one of those; `file:line` citations
are theirs, verified.

---

## The one-paragraph verdict

Invoicey is a **well-built application that produces a legally invalid document for its
own target user**. The engineering is genuinely good — tenant isolation is clean, the
export escaping holds under a line-by-line audit, the money formula has a single home,
the numeric-input layer is properly extracted and tested, the account-linking security
rule is correct. The problems are almost entirely in two places the code quality never
touched: **the domain model** (no GSTIN, no IGST, no place of supply, no HSN/SAC, tax as
two hand-typed invoice-level amounts) and **the perimeter** (no rate limits, no security
headers, no privacy policy, secrets persisted that shouldn't be). Neither is an
architectural problem. Both are finite, and the existing discipline — one `computeTotals`,
one `validateInvoice`, one `buildTotalsRows` shared by preview and export — means the tax
rework lands in far fewer places than a typical codebase of this size would require.

Three findings arrived independently from three different audits and should anchor the
plan:

1. **The PDF path is broken for every user, on every device, right now.**
2. **The product has no memory between invoices** — invoice #12 costs exactly what
   invoice #1 cost.
3. **Most invoices it produces are legally wrong** — inter-state supply requires IGST,
   which does not exist in the schema, and unregistered users are forced to print tax
   rows they are legally barred from charging.

---

## What is broken right now (verified in code)

| # | Finding | Where | Fix |
|---|---|---|---|
| 1 | **`window.open(url, "_blank", "noopener,noreferrer")` returns `null` on *success*** per the HTML spec. The code always takes the popup-blocked branch, revokes the blob URL while the new tab is still resolving it, and shows a banner blaming the user's popup blocker. The only route to a client-ready PDF is non-functional. | `components/InvoiceModal.tsx:76` | Drop the features argument; better, print via a hidden same-document iframe. **S** |
| 2 | **A fourth money formula** that bypasses `computeTotals` — `\|\|` instead of `??` on the stored total, no clamp, no rounding. The view modal and the exported PDF can disagree on the same invoice. | `components/InvoiceModal.tsx:52-59` | Use `resolveRecordAmounts` + `buildTotalsRows`. **S** |
| 3 | **Overdue is dead code.** The due-date branch is unreachable because the API always stamps a status. It is tested, believed working, and never executes. Invoices never go overdue on their own. | `lib/invoices.ts:280-287` vs `app/api/invoices/route.ts:130-132` | Make `overdue` a derived display state. **S** |
| 4 | **Invoice numbers are `Date.now().toString().slice(-6)`, generated in the browser.** Cycles every 16m40s, no unique index, no FY series. Two tabs in the same window produce the same number and both save. | `lib/invoices.ts:141` | Server-side counter + partial unique index. **M** |
| 5 | **The AI endpoint has no rate limit and no cost cap**, while `/api/feedback` and `/api/events` both do. The `draft` is accepted with only `typeof === "object"` and serialised wholesale into the prompt. | `app/api/ai/invoice-assistant/route.ts`, `service.ts:28-30` | Per-user quota + size cap + budget alert. **M** |
| 6 | **Firebase refresh + ID tokens are persisted in MongoDB** and mirrored into a JS-readable cookie. Refresh tokens never expire; nothing reads them back. Pure liability. | `lib/auth-user-sync.ts:143`, `app/auth/page.tsx:205` | Delete both fields, `$unset` existing docs. **S** |
| 7 | **No security headers at all** — no `headers()` in `next.config.ts`, no `middleware.ts`. No CSP, HSTS, X-Frame-Options. The app is clickjackable. | `next.config.ts` | Add a headers block. **S** |
| 8 | **Four raw exception leaks** — `details: err.message`, an outlier; every other route returns a bare error. | `app/api/invoices/route.ts:212, 267, 339, 438` | Remove. **S** |
| 9 | **`connectDB()` has no cached promise and no `maxPoolSize`.** Driver default is 100 connections per lambda against M0's 500 cap — roughly five busy instances can lock out the database. Fails suddenly and globally rather than degrading. | `lib/mongodb.ts:24-40` | Cache the promise, `maxPoolSize: 5`. **S** |
| 10 | **The hero shows the Y Combinator wordmark next to `!Backed by`.** It sits in a `quips` array beside two other jokes, so it is a joke among jokes — not a fake credential dressed as a real one. But it relies on readers parsing `!` as programmer negation, which almost nobody outside engineering does, and it is unlicensed trademark use regardless. | `components/landing.tsx:55-75` | Delete it. Say it in words instead. **S** |

---

## Where the invoice is legally wrong

A GST tax invoice must carry 16 particulars (CGST Rule 46). **Invoicey is missing 8 of
them**: both GSTINs, HSN/SAC, unit of measure, tax rate, per-line taxable value, place of
supply, reverse-charge indicator, and the signature block.

### The two blockers that matter most

**IGST does not exist anywhere in the codebase** — not in the schema, `computeTotals`,
`buildTotalsRows`, the AI contract, or the export. GST is a destination tax: when the
supplier's state differs from the place of supply, the correct tax is IGST at the full
rate, *not* CGST+SGST. For a solo consultant with a nationwide client list, **inter-state
is the majority case, not the edge case**. Today the app can only offer CGST+SGST, so the
recipient cannot claim input tax credit, the supplier's GSTR-1/3B is misstated, and fixing
it requires a credit note plus a fresh invoice. The app is *confidently* wrong, which is
worse than being incomplete.

**GST is forced on users who are legally barred from charging it.** `cgst`/`sgst` are
`required: true` and always print as ₹0.00 rows. Registration thresholds are ₹20 lakh for
services and ₹40 lakh for goods, so plausibly **most** target users have no GSTIN — and
§32 CGST prohibits an unregistered person from collecting tax at all. The app currently
has them emit a tax-invoice-shaped document with no GSTIN on it, which is the exact shape
of a fraudulent invoice. `PRODUCT.md` principle 3 says "GST is a default, not an advanced
mode"; it is currently implemented as "GST is mandatory and unskippable", which is a
different and wrong thing.

The fix for the second is small and has the highest value-per-line in the entire audit: one
`taxTreatment: "none" | "gst" | "composition"` field, derived from whether a GSTIN was
entered, driving a conditional in `buildTotalsRows`. The user is never asked "are you
registered?" — they are asked for a GSTIN, which they either have or don't. Because
`buildTotalsRows` is already shared by the preview and the export, fixing it in one place
fixes both.

### Other correctness gaps

- **The 12% and 28% slabs no longer exist.** GST 2.0 (22 Sep 2025) cut the slabs to
  **0 / 5 / 18 / 40**, plus 3% (bullion) and 0.25% (rough stones). Any rate picker built
  from memory ships wrong. Keep them in `lib/gst-rates.ts` with a `lastVerified` date.
- **Invoice numbers must be ≤16 characters, using only letters, digits, `-` and `/`, and
  unique per financial year (Apr–Mar).** `INV/2026-27/001` is 15 chars and just fits;
  `INV #001` and `INV_001` are both illegal. There is no unique index, so duplicates save
  silently — a guaranteed audit finding.
- **Exports are unhandled.** The app ships USD/EUR/GBP/AED, but an export of services must
  be zero-rated with a verbatim Rule 46 endorsement, country of destination, and the LUT
  ARN. Today it silently takes whatever CGST/SGST the user typed.
- **Dates render `en-US`** ("Aug 17, 2026") on an India-first product. Currency is
  correctly `en-IN` for INR; the date was missed. `en-GB` short-month gives "17 Aug 2026".
- **No amount in words.** Not a Rule 46 requirement, but its absence is the single most
  commonly remarked-on omission when an Indian accountant reads a foreign-built invoice.
- **No PAN field.** Every Indian client deducting TDS needs the payee's PAN; without it
  they must deduct at 20%. PAN is derivable from GSTIN characters 3–12 — zero extra typing.

The GSTIN mod-36 check-digit algorithm was verified by execution against four published
real GSTINs, including the `floor(d/36) + (d%36)` step that most web implementations get
wrong. It is ~15 lines, zero dependencies, fully offline. There is no excuse for not
having it.

### Explicitly do not build

**e-invoicing (IRN/QR) and e-way bill.** The threshold is ₹5 crore turnover — two to three
orders of magnitude from the target user. It cannot be done free (per-document GSP
contracts or per-GSTIN IRP credentials). And a failed IRN call silently invalidates the
user's invoice, which is a different risk class from "the PDF looked slightly off" and not
one a solo maintainer should absorb. Refuse loudly, the way `PRODUCT.md` already refuses to
send email. Offer a paste-in field for an externally-obtained IRN instead.

---

## What the market evidence actually says

~2,050 Play Store reviews were pulled directly for Vyapar, myBillBook, Khatabook, Zoho
Invoice, Refrens and BillBook, in both English and Hindi locales. Headline ratings are
uniformly ~4.5–4.8 and therefore useless; the signal is in 226 substantive 1–2 star
reviews.

**Four findings that should change decisions:**

1. **The paywall is the market's rawest nerve.** Price/paywall is 50% of Vyapar's and 41%
   of myBillBook's substantive negative reviews — and specifically *pricing that changed
   under them* ("my free version stopped working suddenly one day"). `PRODUCT.md`'s "$0, no
   paid tier to upgrade to" is the exact antidote, and no funded competitor can match it
   without breaking their own model. **This is the strongest asset Invoicey has.** The
   related lock-in complaint ("very hard to move everything") turns the existing JSON export
   from a feature into a trust argument.

2. **The AI wedge is aimed slightly wrong.** Of ~1,800 reviews, **5 mention AI at all, and
   4 are negative** — all about AI replacing human support. The one demand signal is for
   *extraction* ("Wake up and add AI invoice scanning", 82 upvotes), not generation from a
   blank prompt. "Describe your invoice in a sentence" asks the user to compose; "paste the
   client's email and I'll draft it" asks them to copy. The existing Gemini plumbing —
   provider, contracts, hard normalization, patch-apply — supports either; it is a change of
   input, not architecture.

3. **Mandatory sign-in is a conversion and trust tax.** The most-upvoted trust complaint in
   the sample: *"I don't want to give my email or phone number just so I can create an
   invoice."* Invoicey gates harder than Zoho does — Firebase sign-in **plus** email
   verification before any data route answers — on a product with none of Zoho's brand
   trust. A local-only "make one invoice now, sign in to save it" path is simultaneously the
   top conversion fix, the top trust fix, and a reduction in DPDP surface.

4. **"Easy" beats every functional feature by 2.5×** in positive reviews (43% vs GST at 4%).
   Nobody praises GST depth; they praise not having to think. Adding features is not how
   this market is won.

**On language:** Devanagari share in Hindi-locale reviews tracks *segment*, not geography —
Khatabook 87%, Vyapar 60%, myBillBook 39%, **Zoho Invoice 0%, Refrens 0%**. The two
competitors closest to Invoicey's user have effectively zero vernacular usage. Translating
the UI is a permanent maintenance commitment aimed at a segment Invoicey has chosen not to
serve. Accepting Hindi/Hinglish *input* to the AI assistant captures the value at zero cost.

**The framing that matters most:** the Indian invoicing market is several non-competing
segments. Invoicey is in **professional-services invoicing** (Zoho Invoice, Refrens).
Vyapar/myBillBook/Swipe are **shopkeeper billing** — and most of what makes those apps look
feature-rich (inventory, barcode, thermal printing, POS) is table stakes for a different
product. Reading the Play Store charts literally would produce a roadmap that destroys this
product.

---

## What it costs to run

Vercel Hobby forbids commercial use, so **Pro is required from day one** (verify against
current terms). Atlas M0 is not viable past ~100 users — 512 MB storage, 100 ops/sec, and
no backups.

| | 100 users | 1,000 users | 10,000 users |
|---|---|---|---|
| Monthly, USD | ~$32 | ~$174 | ~$766–1,100 |
| Monthly, INR | ~₹2,800 | ~₹15,300 | ~₹67,000–97,000 |

**First failure at 1,000 users is Atlas M0 storage, in roughly 10–12 weeks** — and AI
prompt logs are more than half of that growth, because the full prompt is written to Mongo
on every request. Second is the unpaginated list (a one-year-old account is ~1 MB of JSON
on every dashboard load). Third is connection exhaustion, which is the dangerous one
because it fails suddenly rather than degrading.

**Move off the free Gemini key before launch on privacy grounds, not just quota.** Google's
pricing page states free-tier prompts are used to improve their products — and the prompt
serialises the entire draft, meaning your users' clients' names, addresses, emails and
amounts. That is a disclosure failure as well as a commercial one.

This is worth saying plainly: **"$0 indefinite" and ~₹15,000/month at 1,000 users are in
tension.** That is not an argument for paid tiers — it is an argument for knowing the number
at which the promise needs restating, and for saying out loud what happens if the maintainer
stops. Honesty about the mechanism is what makes the $0 claim credible in the first place.

---

## The plan

Sequenced so the money formula is rewritten **once**, not four times, and so nothing gets
built on a foundation that has to move.

### Phase 0 — Stop the bleeding (~3 days)

Everything here is already broken or already a liability. None of it needs a product
decision.

- Fix the Print/PDF `noopener` bug — **the product's primary output is non-functional**
- Route `InvoiceModal` through `resolveRecordAmounts` + `buildTotalsRows`
- AI rate limit, per-user daily quota, `draft` size cap, Google Cloud budget alert, paid
  Gemini key
- Delete `User.accessToken` / `User.refreshToken`, `$unset` from existing docs
- Cache the Mongo connection promise, set `maxPoolSize: 5`
- Security headers + CSP report-only; remove the four `err.message` leaks
- Remove the YC quip; fix the landing CTA contrast (currently 1.08:1, invisible on hover)
- Delete `tailwind.config.ts` and `postcss.config.mjs` (the shadowed one silently drops
  autoprefixer); drop unused `shadcn-ui`, `mongodb`, `baseline-browser-mapping`
- Fix the "payment records" claim on `/about` — the feature does not exist

### Phase 1 — Legal to open signups (~1 week)

- **Privacy policy, terms, named grievance contact.** SPDI Rules 2011 bind *now*; DPDP
  substantive duties are enforceable from 2027-05-13. This also blocks Google OAuth
  verification — a published consent screen requires a privacy-policy URL, without which
  sign-in is capped at the unverified-app screen and 100 users.
- **Account deletion + bulk data export.** Neither exists today. Both are DPDP rights, and
  the export doubles as the "take your data and leave" trust argument the market research
  says is worth more than the feature.
- Nightly `mongodump` to R2; verify the Atlas IP allowlist isn't `0.0.0.0/0`
- Sentry + an uptime check on a new `/api/health`
- A real support email on `/contact` (three social profiles is not a support channel)

### Phase 2 — Make the document correct (~2–3 weeks)

Dependency order is real. `taxTreatment` must land before IGST, because the tax rows have
to become conditional before a third tax is added to them.

1. **`taxTreatment`** — unregistered by default, tax rows conditional, document title driven
   by type. *Cheapest fix, helps the most users.* **S**
2. **GSTIN fields + `lib/gstin.ts`** (regex + verified mod-36 checksum + state table), wired
   into `validateInvoice`, the API normalizer, and the AI normalizer — a model can
   hallucinate a plausible GSTIN. **S**
3. **Business profile** — one document per user; seeds `createDefaultInvoiceFormState()`.
   Unblocks logo, numbering format, seller GSTIN, default terms and bank details. **M**
4. **Invoice numbering** — server counter, `financialYear` derived field, charset/length
   validation, partial unique index, 409 handling, auto-suggest next number. **M**
5. **Place of supply + IGST** — `deriveSupplyKind()` (intra/inter/export/SEZ; SEZ is always
   IGST even in-state) and `splitLineTax()`, both pure and tested like `lib/numeric-input.ts`
   is. Rows render CGST+SGST **or** CGST+UTGST **or** IGST — never all three with zeros,
   which reads as a red flag to an auditor. **L**
6. **Per-line HSN/SAC + UOM + tax rate** — land with or immediately after (5) so
   `computeTotals` changes once. **L**
7. Amount in words, `en-GB` dates, PAN + TDS line, signature block, round-off row. **S each**
8. **Print CSS hardening** — `break-inside: avoid`, repeating `<thead>`, remove
   `overflow:hidden` in print, await image/font load before `print()`. Print fidelity is a
   documented complaint category across every competitor. **S**

### Phase 3 — Make it worth coming back to (~2 weeks)

The retention story. All three audits independently flagged "no memory between invoices" as
the top structural reason a user doesn't return.

- **Client memory** — derivable from existing invoice history with zero new schema. Cheapest
  large win available.
- **Duplicate invoice** — ~20 lines. The archetypal use is a monthly retainer to the same
  client; today that means retyping 23 fields.
- **Dashboard search, filter, sort, pagination** — `SearchInput` and `Pagination` already
  exist in the repo and are used *only by the admin panel*. So does `use-server-table`.
- **Derived overdue + aging buckets** — no schema change, just fix the dead branch.
- **UPI QR + structured bank block** — offline `upi://pay` URI encoded as a QR. No gateway,
  no merchant account, no KYC, no per-transaction fee, no regulatory surface. The single
  most useful thing per line of code for an Indian invoice.
- **`wa.me` share + `navigator.share`** — WhatsApp is the delivery channel for this
  audience, and a share link is a hand-off, not sending, so it stays inside "delivery is the
  user's own".
- Unsaved-changes guard + `localStorage` draft — one back-swipe currently destroys
  everything
- Sticky mobile action bar; validate all fields at once and focus the first invalid one

### Phase 4 — Strategic bets (decide before building)

These are genuine product decisions, not backlog items. My recommendations, all reversible:

- **Anonymous first invoice** — *recommend building.* Top conversion fix, top trust fix, and
  it shrinks DPDP surface. It extends `PRODUCT.md` principle 2 from "nothing between sign-in
  and the first invoice" to "nothing before sign-in either."
- **AI extraction alongside generation** — *recommend adding extraction, keeping generation.*
  The evidence against generation-as-wedge is real but it is absence-of-demand in a review
  corpus, not proof it doesn't work; it has never been marketed. Extraction is a change of
  input on plumbing that already exists.
- **Proforma / quotation** — *recommend building.* The most-requested missing document for
  freelancers; same editor, different heading, separate numbering series.
- **Credit / debit notes** — *recommend building after Phase 2.* Today a user who over-billed
  has no lawful path, and the app instead lets them edit an issued invoice, which is the
  wrong answer under GST and a quiet audit hazard.
- **PWA install** — cheap retention hook; icons already exist.

---

## Do not build

Each of these is something a competitor has, a user might ask for, or a feature-comparison
table would flag — and each is wrong for this product.

| Do not build | Why |
|---|---|
| Inventory, stock, barcode, POS, thermal printing | Different segment, different product, competing with Vyapar on their turf |
| e-invoicing (IRN) and e-way bill | ₹5cr threshold; can't be free; a failed IRN silently invalidates the invoice |
| Full accounting, ledgers, GSTR filing | Correctness guarantees a solo maintainer cannot underwrite |
| Paid tiers, trial countdowns, upgrade prompts, invoice caps | Forbidden by `PRODUCT.md`, and the market's most-hated pattern |
| Payment gateway | Drags in RBI localization, PCI scope, KYC, chargebacks. A UPI QR delivers the outcome with none of it |
| Sending email/SMS on the user's behalf | Never-sending is a *feature* in trust terms |
| Native Android app | A PWA gets the install affordance for a fraction of the effort |
| Hindi/regional UI translation | Zoho and Refrens show ~0% vernacular usage in this segment |
| Teams, roles, RBAC | No multi-user model; the README's roadmap predates the product definition and is stale |
| An AI support chatbot | Every AI-and-support mention in 1,800 reviews was negative |
| Social proof — user counts, testimonials, logos | There are no customers. `PRODUCT.md`: fabricated proof is "the one unrecoverable mistake" |

---

## Open decisions

Four calls I could not make from the code or the research:

1. **Does the AI wedge stay generation-first?** `PRODUCT.md` names it "the wedge"; the review
   evidence says organic demand is for extraction. Both can coexist, but only one can be the
   headline.
2. **What is the cost ceiling behind "$0 indefinite"?** ~₹15,000/month at 1,000 users is the
   number. Knowing it now determines whether the promise gets restated, capped, or
   underwritten.
3. **Is anonymous-first-invoice acceptable?** It is the highest-leverage change the market
   data suggests, and it contradicts the current mandatory-verification posture.
4. **Services-only, or serve goods too?** Everything above assumes segment C
   (professional services). Serving goods pulls in delivery challans, e-way bills, UOM depth
   and inventory pressure — and changes the answer to "do not build".

---

## What is already right

Recorded so a later pass doesn't undo it: tenant isolation and IDOR are clean across every
verb; mass-assignment and NoSQL injection are clean; the hand-rolled export escaping held
under a line-by-line audit; CSV formula injection is neutralised in both exporters; the
email-verified account-linking rule closes a real takeover vector and is tested; the admin
gate is fail-closed with self-action and last-admin guards; `LogEntry` has a real TTL index;
`buildTotalsRows` already prevents preview/export drift; `lib/api-client.ts` has typed errors
and a genuinely good `describeRequestError`; `components/ui/modal.tsx` is a complete,
correct dialog; `pointer: coarse` 44px tap targets and safe-area insets are handled properly;
`text-base md:text-sm` correctly defeats iOS zoom-on-focus; there are zero webfont bytes;
and framer-motion and recharts are admin-only chunks that no customer downloads — **do not
"optimize" them.**

The security problems found here are all perimeter problems — headers, rate limits, secrets
hygiene. That is a much cheaper class of fix than architectural ones, and it is the direct
result of the existing code being disciplined where it counts.
