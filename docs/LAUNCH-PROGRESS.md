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

- [ ] Privacy policy, terms, named grievance contact
- [ ] Account deletion
- [ ] Bulk data export
- [ ] Nightly backup to R2; verify Atlas IP allowlist
- [ ] Sentry + uptime check on `/api/health`
- [ ] Real support email on `/contact`

## Phase 2 — Make the document correct

- [ ] 1. `taxTreatment`
- [ ] 2. GSTIN fields + `lib/gstin.ts`
- [ ] 3. Business profile
- [ ] 4. Invoice numbering
- [ ] 5. Place of supply + IGST
- [ ] 6. Per-line HSN/SAC + UOM + tax rate
- [ ] 7. Amount in words, `en-GB` dates, PAN + TDS, signature block, round-off
- [ ] 8. Print CSS hardening

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
