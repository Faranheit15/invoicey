# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

India-first, global-capable. The primary user is an India-based solo operator — a freelancer, independent consultant, or founder of a very small firm — who bills a handful of clients a month and occasionally invoices overseas. They are not an accountant and do not want to become one. GST is their default path, not an advanced feature.

The job: turn work that has already been delivered into a correct, professional-looking invoice and get it to the client, in one sitting, without setup ceremony. They are usually doing this at the end of a project or the end of the month, in a browser, on desktop, in a batch of one to five invoices.

## Product Purpose

Invoicey creates, edits, tracks, and exports invoices. Success is a user who signs in and sends a client-ready invoice in their first session, then comes back next month because the workflow did not cost them anything — time, money, or attention.

The scope is deliberately narrow: create, edit, track status, export. It is not accounting software and does not aspire to be.

## Positioning

Four claims Invoicey can make truthfully that a general accounting suite or a Word template cannot:

1. **AI drafting from plain language.** The user describes the job in a sentence and gets a filled invoice draft, with follow-up clarification when the description is ambiguous. This is the wedge.
2. **AI extraction from pasted text.** The user pastes a client's email, WhatsApp message or scope note and gets the same draft. Hindi and Hinglish input are accepted; the UI stays in English. This sits beside drafting rather than replacing it: across ~1,800 competitor reviews only five mention AI and four are negative, and the one demand signal was for extraction. Describing an invoice asks the user to compose; pasting one asks them to copy. Which of the two is the headline is an open decision — see `docs/LAUNCH-PLAN.md`.
3. **Zero-setup speed.** No onboarding wizard, no company-profile prerequisite, no chart of accounts, no accounting vocabulary. Sign in, create, send.
4. **Full workflow at $0.** No invoice caps and no feature gates, against competitors whose free tiers cap invoices or withhold exports.

## Operating Context

- Desktop browser is the real usage scene; the work happens seated, at the end of a project or billing cycle.
- The output is a document handed to a client — the invoice must survive leaving the app and looking right in someone else's inbox or printer.
- Delivery is the user's own (email, WhatsApp, upload). Invoicey does not send invoices; it produces files.
- Light and dark are both real usage modes, persisted per user.

## Capabilities and Constraints

**Confirmed capabilities**

- Invoice create / edit / list / view, with line items, dates, terms, notes, currency, status, and a company logo by URL.
- AI-assisted drafting from a natural-language prompt, with follow-up clarification questions. The assistant returns a patch into the in-memory form only — it never writes to the database, and the user must still save.
- Status lifecycle including a settle-to-paid action.
- Export in four formats: PDF (via browser print), HTML, CSV, JSON.
- Persistent light/dark theme.
- Sign-in via Google and via email + password. Password accounts must verify their email before reaching data.

**Constraints and terminology**

- **Currency:** INR is the default. Supported set is INR, USD, EUR, GBP, AED — a closed list, not free text.
- **Tax:** GST is derived, not typed. The user gives a GSTIN (or does not), a place of supply, and a rate per line; the app decides CGST+SGST, CGST+UTGST, IGST, or none. Rows render one of those sets — never all of them with zeros, which reads to an auditor as a document that does not know what it is. An unregistered user (below the ₹20 lakh services / ₹40 lakh goods thresholds) gets no tax rows at all, because §32 CGST bars them from collecting tax. Legacy single `tax` and invoice-level `cgst`/`sgst` fields still exist in production data and are read as fallbacks; neither may be surfaced as a user-facing concept.
- **`convenienceCharge` is labeled "Service Charge" in every user-facing surface.** Never expose the internal field name.
- **Nothing is ever hard-deleted.** This governs the *invoice* lifecycle: deleting an invoice is a soft delete, and no UI may promise permanent removal, purging, or unrecoverable deletion of one. **Account deletion is the single deliberate exception** — an explicitly irreversible action that destroys the account and every invoice under it, soft-deleted ones included. It is the only surface allowed to promise unrecoverable deletion, and it must promise it plainly. The exception exists because the DPDP Act 2023 gives the user a right of erasure that a soft delete does not satisfy.
- **Money formula has one home** (`computeTotals` in `lib/invoice-domain.ts`): discount is pre-tax and apportioned pro-rata across lines, tax is per line at 2dp and summed per head, and only the grand total is §170-rounded — INR only, and only when tax was actually charged. Clamped at zero. Totals are computed server-side; client numbers are never trusted. Legacy documents keep the old arithmetic exactly, because a re-print must be byte-identical to what the client already holds.
- No team, workspace, or multi-user account model exists. One user owns their own invoices.
- The product does not send email, take payments, or issue reminders.

## Brand Commitments

- Name: **Invoicey**. Current tagline in metadata: "Create invoices fast and easily".
- Voice, as written today: plain, operator-to-operator, concrete. It claims what the product does and nothing more ("Free plan. Full workflow."). Keep that register — no enterprise gloss, no hype.
- Support link: Buy Me a Coffee (`buymeacoffee.com/faaaaraaaan`) — this is the real and only monetization surface.

## Evidence on Hand

**What exists:** the product itself, working end to end. The invoice output, the editor's live preview, and the AI drafting flow are all real and demonstrable. `public/default-user-avatar.svg` is the only bespoke image asset.

**What does not exist, and must never be fabricated:** this is a solo side project with no team and no customer base yet. There are no customers, no testimonials, no customer logos, no user counts, no invoice-volume numbers, no revenue figures, no press, no case studies, no awards, no team page, no funding, no SOC 2 or comparable certification. Any surface that would conventionally carry social proof must earn attention some other way — the product's own output, the AI flow, a live demo — rather than inventing proof.

**Pricing is real:** $0, indefinite, with the Buy Me a Coffee link as voluntary support. Do not design paid tiers, "coming soon" price points, trial countdowns, or upgrade prompts. There is no paid plan to upgrade to.

## Product Principles

1. **The invoice is the product.** Every surface is judged by whether it produces a document the user is proud to send to a client.
2. **Nothing between sign-in and the first invoice.** Setup steps are a defect, not a feature. Defaults must be good enough to skip.
3. **GST is a default, not an advanced mode.** Indian tax reality is the happy path; multi-currency is supported without displacing it.
4. **Claim only what is true.** With no customers to point at, credibility comes from showing the real thing working. Fabricated proof is the one unrecoverable mistake.
5. **Narrow on purpose.** Say no to accounting features. The value is in what the product refuses to become.

## Accessibility & Inclusion

No product-specific standard has been established by the user. Both light and dark themes are first-class and must be held to the same legibility bar.
