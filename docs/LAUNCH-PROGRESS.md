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
- [x] 4. Invoice numbering
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

## Phase 3 — Make it worth coming back to

- [ ] Client memory
- [ ] Duplicate invoice
- [ ] Dashboard search / filter / sort / pagination
- [ ] Derived overdue + aging buckets
- [ ] UPI QR + structured bank block
- [ ] `wa.me` share + `navigator.share`
- [ ] Unsaved-changes guard + localStorage draft
- [ ] Sticky mobile action bar; validate-all + focus first invalid

## Phase 4 — Strategic bets

- [ ] Anonymous first invoice
- [ ] AI extraction alongside generation
- [ ] Proforma / quotation
- [ ] Credit / debit notes
- [ ] PWA install
