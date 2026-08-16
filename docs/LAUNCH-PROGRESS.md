# Launch Plan — Execution Progress

Tracks `docs/LAUNCH-PLAN.md` through to completion. One line per plan item.
`[ ]` not started · `[~]` in progress · `[x]` done and verified · `[-]` deliberately
not done (reason given) · `[!]` owner action, outside the repo.

## Phase 0 — Stop the bleeding

- [x] Print/PDF `noopener` bug — primary output non-functional
- [x] `InvoiceModal` through `resolveRecordAmounts` + `buildTotalsRows`
- [x] AI rate limit + per-user daily quota + `draft` size cap
- [!] Google Cloud budget alert (billing console — owner)
- [!] Paid Gemini key (billing console — owner)
- [x] Delete `User.accessToken` / `refreshToken`, `$unset` migration
- [x] Cache Mongo connection promise, `maxPoolSize: 5`
- [x] Security headers + CSP report-only
- [x] Remove four `err.message` leaks
- [x] Remove YC quip
- [x] Landing CTA contrast
- [x] Delete `tailwind.config.ts` + `postcss.config.mjs`
- [x] Drop unused deps
- [x] Fix false "payment records" claim on `/about`

### Found and fixed during Phase 0 verification

Two independent reviewers audited the combined diff; these were their confirmed
findings, all fixed before the commit.

- [x] AI quota counted successes, so a billed call whose output failed to parse
      was free — it now reserves before the provider call
- [x] Admin JSON user export dropped its token projection, but `.lean()` returns
      what the driver returned, so legacy tokens still leaked until the migration
      ran — now an allow-list
- [x] Sign-in responses returned the raw mongoose doc, same problem — allow-list
- [x] Print frame was removed after 60s, blanking the preview of anyone slower
      than that in Save-as-PDF
- [x] Print iframe now sandboxed (`allow-same-origin allow-modals`, no scripts)
- [x] Report-only CSP had no collector — added `/api/csp-report`
- [x] `tests/invoices-isolation.test.ts` leaked a partial module mock process-wide,
      making the suite order-dependent (pre-existing)

### Owner actions, outside the repo

- [ ] Run `bun run migrate:purge-tokens`, then rotate DB backups and revoke
      Firebase refresh tokens
- [!] Google Cloud budget alert
- [!] Paid Gemini key — free-tier prompts train Google's models, and the prompt
      carries the user's clients' names, addresses and amounts

## Phase 1 — Legal to open signups

- [x] Privacy policy, terms, named grievance contact
- [x] Account deletion
- [x] Bulk data export
- [~] Nightly backup to R2 — script + runbook + restore drill written; the
      GitHub Actions workflow files must be added by the owner, so **no backup
      is running yet**
- [!] Atlas IP allowlist — `0.0.0.0/0` is currently the only working config for
      Vercel's dynamic egress; hardened via least-privilege users instead
- [x] Sentry + uptime check on `/api/health`
- [x] Real support email on `/contact`

### Found and fixed during Phase 1 verification

- [x] Erasure did not erase: log rows were stripped of uid and IP only, while AI
      rows hold the typed prompt and the whole serialised draft — the user's
      address and phone, the client's name/email/address, and the bank details.
      All identifying fields are now emptied.
- [x] The partial-failure message said "nothing has been lost" at the one moment
      it was false — Firebase is the last step, so by then the invoices are gone
- [x] Sentry `contexts.trace.data` bypassed every span rule (it does not travel
      in `event.spans`), leaking full URLs with query strings, hostname and UA on
      every sampled transaction
- [x] `verify-backup.ts` index check was self-fulfilling — Mongoose `autoIndex`
      rebuilt the indexes it was verifying, so a restore that lost the LogEntry
      TTL would still pass
- [x] `backup-to-r2.ts` claimed argv hid the DB credential from `ps`; argv is
      exactly what `ps` shows. Corrected, with the real mitigation named.
- [x] Privacy policy published two contradictory Gemini paragraphs, and
      understated both what is logged and what deletion removes

### Owner actions from Phase 1

- [ ] Fill the placeholders in `components/legal.tsx` (entity, grievance officer,
      support/security email, postal address, effective date) and the region and
      jurisdiction values on `/privacy` and `/terms`
- [ ] Have a lawyer review `/privacy` and `/terms` before launch
- [ ] Add `.github/workflows/` backup + restore-drill files from the runbook
- [ ] Sentry project + DSN; R2 bucket, tokens and lifecycle; `age` keypair;
      least-privilege Atlas users; uptime monitor on `/api/health`

## Phase 2 — Make the document correct

- [x] 1. `taxTreatment`
- [x] 2. GSTIN fields + `lib/gstin.ts`
- [x] 3. Business profile
- [~] 4. Invoice numbering — pure module done and tested, but **not enforced**:
      no unique index, no charset/length rule on the write path, and
      `lib/invoices.ts` still mints `Date.now().slice(-6)`. Marked done in error.
- [x] 5. Place of supply + IGST
- [x] 6. Per-line HSN/SAC + UOM + tax rate
- [x] 7. Amount in words, `en-GB` dates, PAN + TDS, signature block, round-off
- [x] 8. Print CSS hardening

### Corrections Phase 2 made to the plan itself

- `cgst`/`sgst` being `required: true` was a red herring — with `default: 0` that
  validator can never fire. The forced ₹0.00 rows came from `buildTotalsRows`.
- A server-side invoice counter is the wrong mechanism: it burns a number on
  every abandoned draft, creating the Rule 46(b) gaps it was meant to prevent.
  Suggestion reads the highest number in the FY; the unique index guarantees it.
- The unique index must be **full**, not partial. Nothing is ever hard-deleted,
  so a partial index lets a soft-deleted number be reissued while both records
  are retained for 72 months.
- The financial year must be derived as the civil date in **IST**, not UTC —
  1 April 04:00 IST is 31 March 22:30 UTC, the previous FY's uniqueness scope.
- §170 rounding applies in derived mode only. Applying it to legacy invoices
  would change the total on documents clients already hold.
- The AI must never set `taxTreatment` or `companyGstin`: a model inferring
  "registered" could head an unregistered person's document "TAX INVOICE".

### Found and fixed during Phase 2

- [x] `toSafeImageUrl` accepted any `data:` URL, including `data:text/html` —
      script execution, since the print path renders in a same-origin iframe
- [x] Unescaped `row.label` in the totals table, safe only while every label was
      a constant and unsafe the moment they carried computed rate suffixes
- [x] Every module landed correctly and the invoice still had no GSTIN columns,
      so neither party's GSTIN could print — caught only because it was flagged
      rather than routed around

### Phase 2 audit — confirmed defects

Fixed:
- [x] §170 rupee rounding applied to USD/EUR/GBP/AED invoices, printing a
      "Round Off $0.07" line on a foreign document
- [x] Rounding fired on a zero-rated LUT export but not on an identical
      unregistered invoice, so two zero-tax documents disagreed on the total
- [x] Legacy re-save drift: the new per-line rounding summed rounded values
      where the old code summed raw and rounded once, shifting the total by a
      paisa on fractional quantities — silently rewriting an issued document

Still open:
- [ ] Rule 46(b) unenforced (see item 4 above) — **highest remaining risk**
- [ ] Rule 46(j): per-line taxable value never printed, so the line table does
      not reconcile (a line reads Rate 18 | Tax 174.00 | Amount 1000.00)
- [ ] The statutory export endorsement prints on an unregistered supplier's
      document, and the LUT rule *blocks them from saving at all*
- [ ] Omitting `taxTreatment` still buys arbitrary invoice-level CGST/SGST
- [ ] A non-slab rate (e.g. 15%) is silently dropped rather than rejected
- [ ] Rule 46(e)/(n): no delivery-address field exists in the schema

## Phase 3 — Make it worth coming back to

- [x] Client memory
- [x] Duplicate invoice
- [x] Dashboard search / filter / sort / pagination
- [x] Derived overdue + aging buckets
- [x] UPI QR + structured bank block
- [x] `wa.me` share + `navigator.share`
- [x] Unsaved-changes guard + localStorage draft
- [x] Sticky mobile action bar; validate-all + focus first invalid

### Found during Phase 3

- [x] The dashboard summed INR and USD invoices into one number and labelled it
      with whatever currency the first invoice happened to use — arithmetically
      real, financially meaningless. Now grouped by currency.
- [x] Two QR encoder bugs that produced perfect-looking, undecodable symbols:
      short EC blocks missing the placeholder byte before interleaving, and the
      zigzag not stepping left past the timing column. Found by diffing 368
      matrices against an independent encoder, not by inspection.
- [x] Line-item rows exist twice in the DOM (table and cards, swapped by media
      query), so stamping both would have left focus-first-invalid focusing a
      `display:none` element half the time.
- [x] The localStorage draft was cleared only incidentally by a blanket
      `localStorage.clear()`; now explicit, because it holds the client's name,
      address and amounts.

## Phase 4 — Strategic bets

- [ ] Anonymous first invoice
- [ ] AI extraction alongside generation
- [ ] Proforma / quotation
- [ ] Credit / debit notes
- [ ] PWA install
