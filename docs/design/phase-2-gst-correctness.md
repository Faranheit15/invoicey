# Phase 2 — "Make the document correct": implementation design

Design document for `docs/LAUNCH-PLAN.md` §"Phase 2", items 1–8.
Evidence base: `docs/research/gst-compliance.md` (§1, §2, §3, §5, §7, §8, §10.4, §12).
Codebase as of `bd0f249` on `develop`.

**Status: design only. Nothing here has been implemented.**

> **On line references.** Every `file:line` below was read at `bd0f249`. Phase 0 work is
> landing concurrently in `app/api/invoices/route.ts`, `components/InvoiceModal.tsx`,
> `lib/mongodb.ts` and `lib/ai/invoice-assistant/`, so line numbers will drift. The
> symbol names will not — grep for the identifier, not the line.

An implementer should be able to work from this document without re-reading the GST
research or re-deriving the codebase's seams. Where I depart from the plan or the
research, it is called out inline and collected in the final section.

---

## 0. Cross-cutting: the shape of every change

### 0.1 The seven places an invoice field lives

`CLAUDE.md` says "~5 places". It is seven once you count the API's raw type and the AI's
four files. Every new field in this phase must be traced through this checklist, and each
item section below gives the concrete list.

| # | Place | File | What goes there |
|---|---|---|---|
| 1 | Mongoose schema | `models/Invoice.ts:33` | persistence + defaults + index |
| 2 | `IInvoice` | `models/Invoice.ts:3` | server-side TS shape |
| 3 | `InvoiceRecord` | `lib/invoices.ts:17` | DB/API read shape (all new fields **optional**) |
| 4 | `InvoiceFormState` | `lib/invoices.ts:54` | UI shape (non-optional, defaulted) |
| 5 | `InvoicePayload` | `lib/invoices.ts:78` | wire shape |
| 5a | mappers | `lib/invoices.ts:127` `createDefaultInvoiceFormState`, `:177` `mapInvoiceRecordToFormState`, `:212` `mapFormStateToPayload` | the three conversions |
| 6 | API raw + normalized | `app/api/invoices/route.ts:25` `RawInvoicePayload`, `:57` `NormalizedInvoicePayload`, `:96` `normalizeItems`, `:112` `normalizePayload` | untrusted-input normalization |
| 7 | AI contract (×4) | `lib/ai/invoice-assistant/contracts.ts:10`, `prompt.ts:26`, `normalization.ts:127` `buildPatch`, `apply-patch.ts:64` | must stay identical across all four |

Plus the three renderers, which are **not** a per-field cost if the change goes through
`buildTotalsRows`, and **are** a per-field cost otherwise:

| Renderer | File | Notes |
|---|---|---|
| Live preview (JSX) | `components/InvoiceEditor.tsx:1153` | `buildTotalsRows(totals)` |
| Read-only modal | `components/InvoiceModal.tsx:53` | `buildTotalsRows(resolveRecordAmounts(invoice))` — already routed (Phase 0 item is done in code even though `LAUNCH-PROGRESS.md` still shows `[ ]`) |
| HTML/PDF export | `lib/invoice-export.ts:385` | `buildTotalsRows(amounts)` |
| CSV export | `lib/invoice-export.ts:459` | same builder, so CSV inherits every totals change for free |

**Verified: all four call sites call `buildTotalsRows` with exactly one argument.** That
fact drives design decision D1 below.

### 0.2 Five design decisions that apply to every item

**D1 — Widen `InvoiceTotals`, do not change `buildTotalsRows`' arity.**
All presentation information (which tax heads exist, what they are labelled, the round-off
delta) rides *inside* the `InvoiceTotals` object that `computeTotals` already returns.
`buildTotalsRows(totals)` keeps its single-argument signature, so all four renderers pick
up conditional CGST/SGST/UTGST/IGST rows with **zero call-site edits**. Any design that
passes a second "context" argument to `buildTotalsRows` multiplies the blast radius by
four and creates four places for the preview and the export to drift.

**D2 — Legacy is a *mode* of `computeTotals`, not a fallback sprinkled through it.**
The tax input to `computeTotals` becomes a discriminated union with a `"legacy"` arm that
consumes the two flat invoice-level amounts exactly as today. `resolveRecordAmounts`
selects that arm for any record that predates the phase. This keeps `?? tax` in one place
(as it is today at `lib/invoice-domain.ts:87`) instead of adding a second legacy axis to
every branch of the new per-line math.

**D3 — Stored derived amounts win on read.**
Once tax rates live in a code constant (`lib/gst-rates.ts`), recomputing an *issued*
invoice on every read means a future rate-table edit silently re-prices a document a
client already has. The read path must therefore prefer stored per-line and per-head
amounts when present, and only compute when absent — the same discipline
`resolveRecordAmounts` already applies to `subtotal`/`total` at
`lib/invoice-domain.ts:94-95` via `??`. This is a stronger reason to store derived amounts
than the research's "for audit" (`gst-compliance.md:287`).

**D4 — Every new field is optional in `InvoiceRecord` and defaulted in `InvoiceFormState`.**
No exceptions. `InvoiceRecord` describes what may come back from Mongo, and Mongo holds
documents written by four different versions of this app.

**D5 — Absence of a field means "written before the field existed", and must be
distinguishable from "explicitly empty".** For `taxTreatment` this is the whole ballgame
(see item 1). Never give a new discriminator a Mongoose `default:` — a default makes old
documents indistinguishable from new ones the moment they are re-saved, and it makes the
legacy branch untestable.

### 0.3 Where pure logic goes

The repo's exemplar is `lib/numeric-input.ts` + `tests/numeric-input.test.ts`: all decision
logic pure, exported as small named functions, the React component reduced to a DOM
adapter, and the docblock explaining *why* the naive version was wrong. Phase 2 adds four
such modules:

| Module | Owns | Test file |
|---|---|---|
| `lib/gstin.ts` | GSTIN regex, mod-36 check digit, state-code table, PAN extraction | `tests/gstin.test.ts` |
| `lib/gst-supply.ts` | `deriveSupplyKind`, `resolveTaxHeads`, `splitLineTax`, UTGST set, `inferLegacyTaxTreatment` | `tests/gst-supply.test.ts` |
| `lib/gst-rates.ts` | rate slabs, UQC list, HSN/SAC format rules (constants + tiny validators) | `tests/gst-rates.test.ts` |
| `lib/invoice-number.ts` | FY derivation, charset/length validation, series parsing, next-number suggestion | `tests/invoice-number.test.ts` |
| `lib/amount-in-words.ts` | Indian-system number-to-words (item 7) | `tests/amount-in-words.test.ts` |

`lib/invoice-domain.ts` stays the composition layer: it imports from the four modules,
owns `computeTotals` / `resolveRecordAmounts` / `buildTotalsRows` / `validateInvoice`, and
imports only *types* from `lib/invoices` (the no-runtime-cycle rule at
`lib/invoice-domain.ts:8`). None of the four new modules may import `lib/invoices` or
`lib/invoice-domain`, so the dependency graph stays acyclic and each is testable alone.

### 0.4 Test files that will break and must be updated deliberately

- `tests/invoice-domain.test.ts:50` asserts `expect(t).toEqual({...6 keys})`. `toEqual` is
  exact; widening `InvoiceTotals` (D1) breaks it. Update it to the new full shape rather
  than loosening it to `toMatchObject` — the exactness is what pins the contract.
- `tests/invoice-domain.test.ts:104` pins the fixed row list ("produces the fixed ordered,
  labeled rows"). It becomes the *legacy-mode* case and gains siblings for each treatment.
- `tests/invoice-export.test.ts` and `tests/invoice-modal.test.ts` assert on rendered
  totals; expect churn there when rows become conditional.

---

## Item 1 — `taxTreatment`

**Goal (plan):** unregistered by default; tax rows conditional; document title driven by
document type. Cheapest fix, helps the most users. Size **S** in the plan; **S–M** here
once the legacy read path is done properly.

### 1.1 Answer to (a): is a 3-value union sufficient?

**The 3-value union is right, but only because it is one of three axes. It must not be
asked to carry the other two.** The plan's sentence — "`taxTreatment` … derived from
whether a GSTIN was entered, driving a conditional in `buildTotalsRows`" — is correct as
far as it goes and understates what drives the conditional.

There are three independent axes:

| Axis | Field | About | Values |
|---|---|---|---|
| A. Registration status of the **supplier** | `taxTreatment` | who is issuing | `"none" \| "gst" \| "composition"` |
| B. Geography of **this transaction** | `supplyKind` (item 5) | where it goes | `"intra" \| "inter" \| "export" \| "sez"` |
| C. Who **pays** the tax | `reverseCharge` | Rule 46(o) | `boolean` |

**Exports and SEZ must be axis B, not extra members of axis A.** Three reasons:

1. They are not registration states. A freelancer below the ₹20 lakh services threshold
   (`gst-compliance.md:628`) can and routinely does export services. Their invoice must
   show **no tax and no LUT endorsement** — it is a plain invoice that happens to go
   abroad. A registered exporter's invoice must show zero-rated tax **plus** the verbatim
   Rule 46 proviso endorsement, the country of destination, and the LUT ARN
   (`gst-compliance.md:243-252`). Folding "export" into `taxTreatment` makes these two
   documents indistinguishable, and gets the unregistered one wrong by printing an
   endorsement that only a registered person may make.
2. The research's own minimal model lists them as separate fields —
   `supplyKind` and `taxTreatment` both appear in `gst-compliance.md:268-290`.
3. SEZ is explicitly a *carve-out of the intra/inter test* (IGST §8(1) proviso,
   `gst-compliance.md:189`), i.e. it lives in the same decision as intra/inter by
   construction.

**A fourth thing also zeroes the tax amounts without changing axis A: reverse charge.** A
registered supplier making a supply under RCM issues a tax invoice showing the rate but
**no tax amount**, with "Tax payable on reverse charge: Yes" (Rule 46(o),
`gst-compliance.md:73`). Neither `taxTreatment` nor `supplyKind` can express that. This is
the concrete proof that `buildTotalsRows` must not branch on `taxTreatment` directly.

**Therefore: `buildTotalsRows` branches on a computed presentation descriptor, not on
`taxTreatment`.** One pure function collapses all three axes:

```ts
// lib/gst-supply.ts
export type TaxTreatment = "none" | "gst" | "composition";
export type TaxHead = "cgst" | "sgst" | "utgst" | "igst";

export interface TaxPresentation {
  /** [] | ["igst"] | ["cgst","sgst"] | ["cgst","utgst"] — never all three. */
  heads: TaxHead[];
  /** Why no heads, for the explanatory line under the totals. null when heads exist. */
  suppressedBecause:
    | null
    | "unregistered"       // taxTreatment === "none"
    | "composition"        // Rule 5(f) bill of supply
    | "zero_rated_lut"     // export/SEZ without payment of tax
    | "reverse_charge";    // recipient pays
}

export function resolveTaxPresentation(input: {
  taxTreatment: TaxTreatment;
  supplyKind: SupplyKind;
  supplierStateCode: string;
  withPaymentOfTax: boolean;
  reverseCharge: boolean;
}): TaxPresentation;
```

Precedence (exhaustive, and the order matters):
1. `taxTreatment === "none"` → `{ heads: [], suppressedBecause: "unregistered" }`.
2. `taxTreatment === "composition"` → `{ heads: [], suppressedBecause: "composition" }`.
   (§32 CGST forbids collection; Rule 5(f) requires the verbatim banner —
   `gst-compliance.md:692-696`.)
3. `reverseCharge === true` → `{ heads: [], suppressedBecause: "reverse_charge" }`.
4. `supplyKind === "export" | "sez"` and `!withPaymentOfTax` →
   `{ heads: [], suppressedBecause: "zero_rated_lut" }`.
5. `supplyKind === "export" | "sez"` and `withPaymentOfTax` → `{ heads: ["igst"] }`.
6. `supplyKind === "inter"` → `{ heads: ["igst"] }`.
7. `supplyKind === "intra"` and `UTGST_STATE_CODES.has(supplierStateCode)` →
   `{ heads: ["cgst","utgst"] }`.
8. `supplyKind === "intra"` otherwise → `{ heads: ["cgst","sgst"] }`.

### 1.2 The cross-product, and what is illegal in it

The two axes multiply to 12 combinations. The implementer needs the table; deriving it
from prose is how bugs get in.

| `taxTreatment` | `supplyKind` | Heads | Title | Verdict |
|---|---|---|---|---|
| none | intra | — | INVOICE | legal |
| none | inter | — | INVOICE | legal |
| none | export | — | INVOICE | legal; print country of destination, **no** Rule 46 endorsement, **no** LUT |
| none | sez | — | INVOICE | legal but odd; warn, do not block |
| gst | intra | CGST+SGST or CGST+UTGST | TAX INVOICE | legal |
| gst | inter | IGST | TAX INVOICE | legal |
| gst | export | IGST (with payment) or — (LUT) | TAX INVOICE | legal; endorsement + country required |
| gst | sez | IGST (with payment) or — (LUT) | TAX INVOICE | legal; **always** IGST even in-state |
| composition | intra | — | BILL OF SUPPLY | legal; Rule 5(f) banner required |
| composition | inter | — | BILL OF SUPPLY | **error for goods**, warn for services (see below) |
| composition | export | — | BILL OF SUPPLY | **error** |
| composition | sez | — | BILL OF SUPPLY | **error** |

On composition + inter-State: `gst-compliance.md:698` states a composition dealer "cannot
make inter-State outward supplies of goods". Invoicey cannot reliably tell goods from
services *except* via HSN/SAC (item 6): SAC always begins `99` (`gst-compliance.md:110`).
So the rule is: hard error only when a line carries an HSN that does **not** begin `99`;
otherwise a non-blocking warning. Export/SEZ under composition is blocked as a
consequence of the inter-State restriction (export is deemed inter-State, IGST §7(5)) —
**this is my derivation, not a cited source**; treat it as a warning if the maintainer
prefers not to hard-block on an inference.

### 1.3 Schema and type changes

New invoice-level fields (item 1 introduces two; item 5 adds the rest):

```ts
taxTreatment?: "none" | "gst" | "composition"   // NO Mongoose default — see D5
documentType?: "tax_invoice" | "invoice" | "bill_of_supply"
reverseCharge?: boolean                          // default false is fine here
```

`documentType` is **derived**, not chosen: `none → "invoice"`, `gst → "tax_invoice"`,
`composition → "bill_of_supply"`. Store it anyway (the printed heading is part of the
issued document and must not change if the derivation rule later changes — D3), and
compute it with a pure `documentTypeFor(taxTreatment)` in `lib/gst-supply.ts`. Keeping the
field also leaves room for Phase 4's proforma/quotation without another migration.

Per the §0.1 checklist:

1. `models/Invoice.ts:33` — `taxTreatment: { type: String, enum: [...] }` (no `default`),
   `documentType: { type: String, enum: [...] }`, `reverseCharge: { type: Boolean, default: false }`.
2. `models/Invoice.ts:3` `IInvoice` — all three optional.
3. `lib/invoices.ts:17` `InvoiceRecord` — all three optional.
4. `lib/invoices.ts:54` `InvoiceFormState` — `taxTreatment: TaxTreatment` (required,
   defaults `"none"`), `reverseCharge: boolean`. `documentType` is **not** in form state;
   it is derived at map-to-payload time so it cannot drift from `taxTreatment`.
5. `lib/invoices.ts:78` `InvoicePayload` — `taxTreatment`, `documentType`, `reverseCharge`.
5a. `createDefaultInvoiceFormState` (`:127`) → `taxTreatment: "none"`, `reverseCharge: false`
   (item 3 overrides from the business profile);
   `mapInvoiceRecordToFormState` (`:177`) → `invoice.taxTreatment ?? inferLegacyTaxTreatment(invoice)`;
   `mapFormStateToPayload` (`:212`) → passes through + `documentType: documentTypeFor(form.taxTreatment)`.
6. `route.ts:25` `RawInvoicePayload` + `:57` `NormalizedInvoicePayload` + `:112`
   `normalizePayload` — whitelist the enum (`allowed.includes(raw.taxTreatment) ? … : "none"`),
   re-derive `documentType` **server-side** and ignore whatever the client sent (the client
   must not be able to head an unregistered document "TAX INVOICE").
7. AI: add `taxTreatment` to `contracts.ts:10`, `prompt.ts:26` schema + a rule
   ("never set taxTreatment to gst unless a valid GSTIN is present"), `normalization.ts`
   `buildPatch` (enum whitelist), `apply-patch.ts`.

**Also relax `cgst`/`sgst`.** `models/Invoice.ts:72-73` currently reads
`{ type: Number, required: true, default: 0 }`. Drop `required: true`, **keep
`default: 0`**. See the disagreement section: this change is cosmetic, not functional.

### 1.4 Backwards compatibility — what the read path does

A production document written before this phase has **no `taxTreatment` field at all**.
`inferLegacyTaxTreatment` is the whole compatibility story, and it must not change a
single amount on any existing invoice:

```ts
// lib/gst-supply.ts — pure, no imports from lib/invoices
export function inferLegacyTaxTreatment(amounts: {
  cgst?: number; sgst?: number; tax?: number;
}): TaxTreatment {
  const anyTax = (amounts.cgst ?? 0) > 0 || (amounts.sgst ?? 0) > 0 || (amounts.tax ?? 0) > 0;
  return anyTax ? "gst" : "none";
}
```

Rule: **a legacy document that carried tax keeps its tax rows verbatim; a legacy document
whose tax was all zeros loses its two ₹0.00 rows.** Rationale:

- No amount ever changes. A re-print of an already-delivered invoice shows the same
  numbers it always did — a hard requirement, because the client already holds a copy.
- The only visible change is the disappearance of `CGST ₹0.00` / `SGST ₹0.00` rows, which
  is *precisely* the hazard item 1 exists to remove (`gst-compliance.md:658-664`: an
  unregistered person's document with tax rows "is the exact shape of a fraudulent
  invoice"). Retroactively fixing it is the point, not a side effect.
- The alternative — "legacy documents render exactly as today, zeros included" — leaves
  the hazard in place for every historical invoice forever and is not worth the
  pixel-fidelity it buys.
- A legacy doc that carried real tax infers `"gst"` even though its supplier had no GSTIN
  on file. That is honest: it *was* issued as a tax invoice. It will show "TAX INVOICE"
  with no GSTIN — flag it in the UI (a soft banner on the modal: "this invoice predates
  GSTIN support"), and let item 2's validation force the fix on the next edit.

`reverseCharge` absent → `false`. `documentType` absent → `documentTypeFor(inferred)`.

### 1.5 Pure module and test cases

`lib/gst-supply.ts` exports (item 1 subset): `TaxTreatment`, `TaxHead`,
`UTGST_STATE_CODES`, `resolveTaxPresentation`, `inferLegacyTaxTreatment`,
`documentTypeFor`, `DOCUMENT_TITLES`.

`tests/gst-supply.test.ts` — item 1 cases:

- `resolveTaxPresentation` returns `[]` for `none` regardless of `supplyKind` (all four).
- `composition` beats `supplyKind`: `[]` for all four kinds.
- `reverseCharge` beats geography: `gst` + `intra` + rcm → `[]`, `suppressedBecause: "reverse_charge"`.
- `gst` + `intra` + `supplierStateCode: "29"` → `["cgst","sgst"]`.
- `gst` + `intra` + `"04"` (Chandigarh) → `["cgst","utgst"]`.
- `gst` + `intra` + `"07"` (Delhi, **has** a legislature) → `["cgst","sgst"]`, and the same
  for `"34"` Puducherry and `"01"` J&K — the three that everyone gets wrong.
- `gst` + `inter` → `["igst"]`; never contains `cgst` or `sgst`.
- `gst` + `sez` + in-state supplier → `["igst"]` (the carve-out).
- `gst` + `export` + `withPaymentOfTax: false` → `[]`, `"zero_rated_lut"`.
- **Invariant test**: over all 3×4×2×2 combinations, `heads` is never length 3, never
  contains both `igst` and `cgst`, and never contains both `sgst` and `utgst`.
- `inferLegacyTaxTreatment`: `{}` → `"none"`; `{cgst:0,sgst:0}` → `"none"`;
  `{cgst:9}` → `"gst"`; `{tax:18}` (pre-migration field only) → `"gst"`;
  `{cgst:0,sgst:0,tax:0}` → `"none"`.
- `documentTypeFor` / `DOCUMENT_TITLES`: `none → "INVOICE"`, `gst → "TAX INVOICE"`,
  `composition → "BILL OF SUPPLY"`.

### 1.6 Rendering changes

- `lib/invoice-export.ts:327` — `<h1>INVOICE</h1>` becomes
  `<h1>${escapeHtml(DOCUMENT_TITLES[documentType])}</h1>`.
- The Rule 5(f) banner for composition: a literal constant printed above the header,
  verbatim, **"composition taxable person, not eligible to collect tax on supplies"**
  (`gst-compliance.md:694`). Keep it in `lib/gst-supply.ts` as `COMPOSITION_BANNER` so the
  preview and the export share the exact string.
- An explanatory line under the totals driven by `suppressedBecause`
  ("GST not applicable — not registered under GST", "Zero-rated supply under LUT — no IGST
  charged", "Tax payable by the recipient under reverse charge"). One map, one place.
- The editor hides the CGST/SGST inputs entirely when `taxTreatment !== "gst"`.

---

## Item 2 — GSTIN fields + `lib/gstin.ts` (answers (e))

**Goal (plan):** regex + verified mod-36 checksum + state table, wired into
`validateInvoice`, the API normalizer, **and** the AI normalizer. Size **S**. Agreed.

### 2.1 The algorithm, verbatim from the research

Extracted from `gst-compliance.md:823-925`. Structure: 15 chars —
`[0-1] state code | [2-11] PAN | [12] entity/branch | [13] 'Z' | [14] check char`.

```ts
// lib/gstin.ts
export const GSTIN_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Format only. Strict on the state code: accepts 01-38, rejects 00 and 39-99. */
export const GSTIN_REGEX_STRICT =
  /^(0[1-9]|[1-2][0-9]|3[0-8])[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Luhn mod-36 over the first 14 characters, factor starts at 2 at the RIGHTMOST. */
export function gstinCheckDigit(first14: string): string {
  const mod = GSTIN_ALPHABET.length;          // 36
  let factor = 2;
  let sum = 0;
  for (let i = first14.length - 1; i >= 0; i--) {
    const codePoint = GSTIN_ALPHABET.indexOf(first14[i]);
    let digit = factor * codePoint;
    factor = factor === 2 ? 1 : 2;
    digit = Math.floor(digit / mod) + (digit % mod);   // base-36 digit sum — ESSENTIAL
    sum += digit;
  }
  return GSTIN_ALPHABET[(mod - (sum % mod)) % mod];
}

export function isValidGstin(value: string): boolean {
  const gstin = normalizeGstin(value);
  if (!GSTIN_REGEX_STRICT.test(gstin)) return false;
  return gstinCheckDigit(gstin.slice(0, 14)) === gstin[14];
}

export const normalizeGstin = (value: string | undefined): string =>
  (value || "").trim().toUpperCase().replace(/\s+/g, "");

export const stateCodeFromGstin = (gstin: string): string =>
  isValidGstin(gstin) ? normalizeGstin(gstin).slice(0, 2) : "";

/** PAN is GSTIN characters 3-12, i.e. slice(2, 12). Free, zero extra typing. */
export const panFromGstin = (gstin: string): string =>
  isValidGstin(gstin) ? normalizeGstin(gstin).slice(2, 12) : "";

export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
```

Two traps the research calls out explicitly and that must survive code review:
- **`Math.floor(digit / mod) + (digit % mod)` is essential.** Dropping it (plain
  `sum += factor * codePoint`) is "the most common wrong implementation on the web and
  silently accepts invalid GSTINs" (`gst-compliance.md:889`).
- **The factor starts at 2 at the rightmost of the 14**, not at 1. The
  factor-starts-at-1 variant fails all four verification GSTINs (`gst-compliance.md:887`).

### 2.2 State-code table

Copy `gst-compliance.md:895-923` verbatim into `lib/gstin.ts` as
`GST_STATE_CODES: Record<string, string>` with the two annotations preserved as comments:

- **`"25"` (Daman & Diu) and `"28"` (undivided Andhra Pradesh) are discontinued.** Accept
  them when validating an *existing* GSTIN; never offer them in a picker. Export a second
  constant `GST_STATE_PICKER_CODES` (the table minus `25`, `28`, `99`) so the picker and
  the validator cannot drift.
- `"97"` = Other Territory (confirmed). `"96"` = Other Country, used as the
  place-of-supply sentinel for exports — the research marks 96 as **UNVERIFIED** as an
  official code (`gst-compliance.md:921`, restated at `:1481`). Keep it as an
  Invoicey-internal sentinel and never print "96" on a document; print the country name.
- `UTGST_STATE_CODES = new Set(["04","25","26","31","35","38","97"])` lives in
  `lib/gst-supply.ts` (item 5), not here, because it is a tax-head question and it must
  not tempt anyone to think Delhi/Puducherry/J&K are on it.

### 2.3 Schema and type changes

```ts
companyGstin?: string   // supplier, uppercase, validated
companyPan?: string     // auto-derived from companyGstin when present (item 7)
billToGstin?: string    // recipient
```

Through the §0.1 checklist: (1)(2) `models/Invoice.ts` as optional `String` with
`uppercase: true, trim: true`; (3) optional on `InvoiceRecord`; (4) `string` defaulting
`""` on `InvoiceFormState`; (5) on `InvoicePayload`; (5a) all three mappers; (6)
`RawInvoicePayload` + `NormalizedInvoicePayload` + `normalizePayload` calls
`normalizeGstin` (**normalize** — trim/upper — in `normalizePayload`, **reject** in
`validateInvoice`; keep the two responsibilities separate exactly as the file does today);
(7) all four AI files.

**`taxTreatment` derives from `companyGstin`.** In `mapFormStateToPayload` and in the
API's `normalizePayload`: a non-empty valid `companyGstin` and `taxTreatment !== "composition"`
⇒ `"gst"`; empty ⇒ `"none"`. The user is never asked "are you registered?"
(`gst-compliance.md:715`). Composition remains an explicit opt-in checkbox, because it
cannot be derived from a GSTIN — a composition dealer has an ordinary GSTIN.

### 2.4 Backwards compatibility

Trivially: absent ⇒ `""` ⇒ `taxTreatment` falls to the item 1 legacy inference. No legacy
document has a GSTIN, so no legacy document can fail GSTIN validation on read. The only
sharp edge is a legacy document that infers `"gst"` (it carried tax amounts) but has no
`companyGstin` — validation must not block *reading* it; it blocks the next **write**,
which is correct and is how the user gets nudged into fixing it.

### 2.5 Hook points

1. **`validateInvoice`** (`lib/invoice-domain.ts:137`). Extend `ValidatableInvoice` with
   `companyGstin?`, `billToGstin?`, `taxTreatment?`, `placeOfSupplyStateCode?`. New rules,
   in order, each returning the first error string as the function already does:
   - `companyGstin` non-empty and `!isValidGstin` → "Your GSTIN is not valid. Check the 15 characters."
   - `billToGstin` non-empty and `!isValidGstin` → "The client's GSTIN is not valid."
   - `taxTreatment === "gst"` and no `companyGstin` → "A GSTIN is required to issue a tax invoice."
   - `taxTreatment === "gst"` and `stateCodeFromGstin(companyGstin) !== supplierStateCode`
     → "Your state must match the first two digits of your GSTIN." (item 5)
   - `billToGstin` present and its first two chars ≠ `placeOfSupplyStateCode` and the user
     has not set `placeOfSupplyOverridden` → "Place of supply usually matches the client's
     GSTIN state." — the research calls this "one check [that] catches most real-world
     mistakes for free" (`gst-compliance.md:359`). **Make it a warning, not a hard error**:
     IGST §12(3)–(13) exceptions (immovable property, events, training) legitimately move
     the place of supply away from the recipient's state. `validateInvoice` currently
     returns `string | null` and has no warning channel — see §7.4 for the shape change.
2. **API normalizer** (`route.ts:112`): `normalizeGstin` on both fields; re-derive
   `taxTreatment` server-side; never trust a client-sent `documentType`.
3. **AI normalizer** (`normalization.ts:127` `buildPatch`): `companyGstin`/`billToGstin`
   must **not** go through the generic `stringFieldKeys` loop at `normalization.ts:151`.
   They need their own block that drops the field entirely when `!isValidGstin` — silent
   drop, not passthrough, matching the module's existing "hard-validate every field"
   discipline. Mirror it in `apply-patch.ts` (defense in depth, because the patch is
   applied client-side and the client is the last line). Add to `prompt.ts:26` schema and
   add rule 12: "Never invent a GSTIN. Only echo a GSTIN the user typed."

### 2.6 Test cases — `tests/gstin.test.ts`

Verification vectors (all four verified by execution in the research,
`gst-compliance.md:884`):

| GSTIN | Expect |
|---|---|
| `27AAPFU0939F1ZV` | valid; state `27`; PAN `AAPFU0939F` |
| `29AAGCB7383J1Z4` | valid; state `29` |
| `24AAACC1206D1ZM` | valid; state `24` |
| `09AAACH7409R1ZZ` | valid; state `09` |

Plus:
- `gstinCheckDigit("27AAPFU0939F1Z")` → `"V"` (and the other three).
- **Wrong check digit**: `27AAPFU0939F1ZW` → invalid. Do this for all four by bumping the
  last character — this is the test that fails if someone drops the base-36 digit-sum step.
- **Transposition**: `27AAPFU9039F1ZV` (`09`→`90` inside the PAN) → invalid. A check digit
  that does not catch a transposition is not doing its job.
- **Factor-variant regression**: assert `gstinCheckDigit` is not the factor-starts-at-1
  variant by pinning all four expected characters — the variant produces different output
  for all four.
- Length: 14 chars, 16 chars → invalid.
- Case: `"27aapfu0939f1zv"` → **valid** (normalizes first); `" 27AAPFU0939F1ZV "` → valid.
- State code: `00AAPFU0939F1Z…`, `39AAPFU0939F1Z…` → invalid (strict regex).
- Position 14 not `Z`: `27AAPFU0939F1YV` → invalid, with a comment recording that UIN/OIDAR
  registrations legitimately deviate (`gst-compliance.md:849`) and that the research
  recommends treating this rejection as an overridable warning — deferred, kept strict.
- `""`, `undefined`, `null` → invalid, no throw.
- `stateCodeFromGstin`/`panFromGstin` return `""` for an invalid input rather than a
  garbage substring.
- `PAN_REGEX`: `AAPFU0939F` valid; `AAPFU0939` invalid; `AAPF10939F` invalid.
- Every key of `GST_STATE_CODES` is exactly 2 characters; `GST_STATE_PICKER_CODES`
  excludes `25`, `28`, `99`.

---

## Item 3 — Business profile

**Goal (plan):** one document per user; seeds `createDefaultInvoiceFormState()`; unblocks
logo, numbering format, seller GSTIN, default terms and bank details. Size **M**. Agreed —
and it is the item that makes items 2, 4 and 5 *usable* rather than merely correct, because
without it the user retypes their GSTIN and state on every invoice.

### 3.1 New model

`models/BusinessProfile.ts` — a new collection, not a field on `User`. Rationale: `User`
is auth-owned (`lib/auth-user-sync.ts` funnels writes to it) and Phase 0 is actively
deleting fields from it; invoicing defaults do not belong in the auth aggregate.

```ts
export interface IBusinessProfile extends Document {
  userId: string;              // unique
  companyName?: string; companyEmail?: string; companyPhone?: string;
  companyAddress?: string; companyLogo?: string;
  companyGstin?: string; companyPan?: string;
  supplierStateCode?: string;  // "29"
  taxTreatment?: TaxTreatment; // sticky default for new invoices
  lutArn?: string;
  defaultCurrency?: string; defaultTerms?: string; defaultPaymentInfo?: string;
  defaultDueDays?: number;     // replaces the hardcoded +14 at lib/invoices.ts:130
  invoiceNumberPattern?: string; // e.g. "INV/{FY}/{SEQ:3}" — item 4
  signatureLabel?: string; signatureImageUrl?: string;
  createdAt: Date; updatedAt: Date;
}
BusinessProfileSchema.index({ userId: 1 }, { unique: true });
```

`is_deleted` is **not** on this model: it is user-owned configuration, not a business
record, so account deletion (Phase 1) hard-deletes it. Say so in a comment, because the
repo's blanket rule is "nothing is ever hard-deleted" and this is a deliberate exception.

### 3.2 New route

`app/api/profile/route.ts` — `GET` (returns `{}` when none exists, **not** 404: absence is
the normal state and a 404 would make every client handle an error path for a cold start)
and `PUT` (upsert). Must `import { requireUser, authErrorResponse } from "@/lib/server/auth"`
— do not re-copy the helper (CLAUDE.md). `connectDB()` in the handler. Every query filtered
by `{ userId }`. Add `profileApi` to `lib/api-client.ts` next to `invoicesApi`/`aiApi`;
components must not hand-roll `auth.currentUser` + fetch.

Server-side normalization mirrors the invoice route: `normalizeGstin`, `isValidGstin`
rejection, `supplierStateCode` forced to equal `stateCodeFromGstin(companyGstin)` when a
GSTIN is present.

### 3.3 The seeding seam — keep `createDefaultInvoiceFormState` pure

`createDefaultInvoiceFormState()` (`lib/invoices.ts:127`) is synchronous and pure, and must
stay that way — it is called from render paths and from tests. **Do not make it fetch.**
Change its signature to take an optional seed:

```ts
export interface InvoiceFormSeed {
  companyName?: string; companyEmail?: string; companyPhone?: string;
  companyAddress?: string; companyLogo?: string;
  companyGstin?: string; companyPan?: string; supplierStateCode?: string;
  taxTreatment?: TaxTreatment; lutArn?: string;
  currency?: string; terms?: string; paymentInfo?: string;
  dueDays?: number; invoiceNumber?: string;
}
export const createDefaultInvoiceFormState = (seed: InvoiceFormSeed = {}): InvoiceFormState
```

`InvoiceEditor` (mode `"create"`) fetches the profile once, then calls
`createDefaultInvoiceFormState(profileToSeed(profile))`. `profileToSeed` is pure and
tested. Existing zero-argument callers keep working unchanged — this is a
backwards-compatible signature widening, which is what lets item 3 ship on its own.

**Race to avoid:** the editor currently initialises state at first render. Fetching the
profile after mount and then replacing form state will blow away anything the user typed
in the intervening 200 ms, and will fight the AI patch. Gate it: only apply the seed while
the form is still pristine (`isPristine` ref set false on the first `updateField`), and
never in `mode === "edit"`.

### 3.4 Backwards compatibility

There is no profile for any existing user. Every field is optional; `profileToSeed({})`
returns `{}`; `createDefaultInvoiceFormState({})` is byte-identical to today's output
(pin this with a test). Offer "Save these as my defaults" after a successful save rather
than a setup wizard — the product principle is "nothing between sign-in and the first
invoice" (`gst-compliance.md:715` and PRODUCT.md principle 2).

Reverse direction: `lib/invoices.ts` currently hardcodes `terms: "Payment due within 14
days."` and `+14` days. Those become the fallbacks when the seed is empty. Do not silently
change them.

### 3.5 Pure module and tests

No new module — the pure part is `profileToSeed` and it belongs beside the mappers in
`lib/invoices.ts`. Tests in `tests/invoices.test.ts`:
- `createDefaultInvoiceFormState()` with no argument produces the exact same object it
  produces today (except the invoice number, item 4).
- A full seed populates every seeded field and touches nothing else.
- A seed with `taxTreatment: "gst"` but no `companyGstin` is downgraded to `"none"` —
  the seed cannot manufacture a tax invoice out of an incomplete profile.
- `dueDays: 30` moves `dueDate` 30 days out; `dueDays: 0` gives `dueDate === invoiceDate`;
  a negative or absurd `dueDays` clamps to `[0, 365]`.

---

## Item 4 — Invoice numbering (answers (d))

**Goal (plan):** server counter, `financialYear` derived field, charset/length validation,
partial unique index, 409 handling, auto-suggest next number. Size **M**.

### 4.1 What is there today, precisely

`lib/invoices.ts:141`:

```ts
invoiceNumber: `INV-${Date.now().toString().slice(-6)}`,
```

- Generated **in the browser**, at form-default time, before the user is even known to the
  server.
- The last 6 digits of the epoch in milliseconds cycle every 10^6 ms = **1000 s = 16 min
  40 s**. Two invoices created 16m40s apart get the same number. Over a year of use by one
  user this is not a rare collision — it is a certainty at any real volume.
- `INV-123456` is 10 characters and uses only legal characters, so the *format* is fine;
  everything else about it is not.
- There is **no unique index** (`models/Invoice.ts:90-96` has exactly three indexes, none
  touching `invoiceNumber`), so duplicates save silently.
- There is no FY awareness, no length cap (`validateInvoice` at `lib/invoice-domain.ts:144`
  only checks non-empty), and no charset check.

Legal constraints (Rule 46(b), `gst-compliance.md:93`): **≤16 characters**, containing
only **letters, digits, `-` and `/`** — nothing else, no `#`, no space, no `_`, no `.` —
**consecutive** and **unique for a financial year** (1 April – 31 March).

### 4.2 Pure module — `lib/invoice-number.ts`

```ts
/** "2026-27". Derived from the invoice DATE, not from today. */
export function deriveFinancialYear(date: string | Date): string;

/** Rule 46(b) charset + length. Does not trim — call normalizeInvoiceNumber first. */
export const INVOICE_NUMBER_REGEX = /^[A-Za-z0-9/-]{1,16}$/;
export function isValidInvoiceNumber(value: string): boolean;

/** Trim + collapse internal whitespace away. Does NOT change case. */
export function normalizeInvoiceNumber(value: string): string;

/** The case-insensitive key the unique index is built on. */
export function invoiceNumberKey(value: string): string;   // normalize().toUpperCase()

/** Split a number into a fixed prefix and a trailing zero-padded sequence. */
export function parseInvoiceNumber(value: string):
  | { prefix: string; sequence: number; width: number }
  | null;

/** Next number in the same series, or null when it cannot stay <= 16 chars. */
export function nextInvoiceNumber(previous: string): string | null;

/** First number of a financial year for a pattern. */
export function formatInvoiceNumber(
  pattern: string,              // "INV/{FY}/{SEQ:3}"
  input: { financialYear: string; sequence: number }
): string | null;              // null when the result would exceed 16 chars
```

**`deriveFinancialYear` timezone trap — this is the bug worth pinning.** `invoiceDate` is
a `YYYY-MM-DD` string in form state and a `Date` in Mongo. `new Date("2026-04-01")` parses
as **UTC midnight**; calling `.getMonth()` on it from a timezone west of UTC returns
`2` (March), silently filing a 1-April invoice into FY 2025-26 and putting it in the wrong
uniqueness scope. Therefore:

```ts
export function deriveFinancialYear(date: string | Date): string {
  let year: number, monthIndex: number;
  if (typeof date === "string") {
    const m = date.match(/^(\d{4})-(\d{2})-(\d{2})/);   // parse the STRING, no Date
    if (!m) return deriveFinancialYear(new Date(date));
    year = Number(m[1]); monthIndex = Number(m[2]) - 1;
  } else {
    year = date.getUTCFullYear(); monthIndex = date.getUTCMonth();  // UTC, never local
  }
  const startYear = monthIndex >= 3 ? year : year - 1;   // >= 3 is April onwards
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}
```

Default pattern: `INV/{FY}/{SEQ:3}` → `INV/2026-27/001`, **15 characters** — it fits with
one character of headroom. `{SEQ:4}` gives `INV/2026-27/0001` at exactly 16: legal, zero
headroom, and the 1000th invoice of the year cannot be numbered. `formatInvoiceNumber`
returns `null` rather than emitting a 17-character number, and the caller falls back to a
shorter pattern (`{FY2}` → `26-27`, giving `INV/26-27/0001` at 14). This is the trap the
research names explicitly (`gst-compliance.md:1252`: "`INVOICE/2026-27/0001` is 20 and is
**illegal**. This is a real trap for a 'smart numbering' feature.").

### 4.3 Schema, index, and the counter question

New stored fields:

```ts
financialYear?: string       // "2026-27", derived from invoiceDate at write time
invoiceNumberKey?: string    // normalizeInvoiceNumber(invoiceNumber).toUpperCase()
```

Both are **server-derived only** — they must never appear in `InvoiceFormState` or be
accepted from `RawInvoicePayload`. `normalizePayload` computes them; the AI contract does
not mention them.

**Index:**

```ts
InvoiceSchema.index(
  { userId: 1, financialYear: 1, documentType: 1, invoiceNumberKey: 1 },
  { unique: true, name: "uniq_user_fy_doctype_number" }
);
```

- **Full, not partial.** The research offers both (`gst-compliance.md:1272-1278`) and
  leans to full; I agree, and the reason is decisive: nothing is ever hard-deleted here, so
  a soft-deleted invoice **still holds its number**, and GST says a cancelled invoice
  number must not be reused. A partial filter on `{ is_deleted: { $ne: true } }` would let
  a user soft-delete `INV/2026-27/007` and issue a second, different `INV/2026-27/007` —
  two documents, one number, both retained for 72 months under §36. That is exactly the
  audit finding the item exists to prevent. Cost: a user who deletes a mis-typed draft
  cannot reuse its number. Mitigate by suggesting the next free number (which will skip
  it) and by shipping trash/restore later (Phase 3, H11) so the number is visibly parked
  rather than lost.
- **`documentType` is in the key** so that a future proforma/credit-note series (Phase 4)
  is a separate series, as Rule 46(b) permits ("one or multiple series"). It is in the key
  from day one so the index never has to be rebuilt for it.
- **`invoiceNumberKey` rather than `invoiceNumber`** makes the constraint
  case-insensitive. `inv/2026-27/001` and `INV/2026-27/001` are the same series in any
  real accounting sense, and a case-only difference is a typo, not an intention. The
  alternative — a collation-based case-insensitive index — is more magic and harder to
  reason about from the shell; an explicit stored key is greppable.
- **Interaction with the existing indexes** (`models/Invoice.ts:90-96`): no overlap. The
  existing `{userId, is_deleted, createdAt}` is a *read* index for the list endpoint; the
  new one is a *write constraint* with a different prefix beyond `userId` and cannot serve
  those queries, nor they it. The new index additionally serves the "highest number in this
  FY" suggestion query (`find({userId, financialYear, documentType}).sort({invoiceNumberKey: -1}).limit(1)`)
  as a covered index scan, which is why the field order is `userId → financialYear →
  documentType → invoiceNumberKey` and not anything else. Total index count goes 3 → 4;
  the collection is small and write volume is trivial.
- **Build it in the background, off-hours**, as `models/Invoice.ts:88` already instructs
  for the others.

**On the plan's "server counter": I recommend not building one.** A `Counter` collection
with `findOneAndUpdate({_id: userId+fy}, {$inc:{seq:1}}, {upsert, returnDocument:"after"})`
is atomic and correct, but it burns a number on every *suggestion*, so every abandoned
draft leaves a **gap** in the series — and a gap in a consecutive series is itself an audit
question the research tells us to warn about (`gst-compliance.md:1288`). Incrementing at
save time instead of suggest time means the counter and the user-editable field can
disagree, so the counter is advisory anyway. The unique index is the real guarantee.

**Design instead:**
1. Suggestion is a **read**: `GET /api/invoices/next-number?date=YYYY-MM-DD` (or a field on
   the profile response) → highest `invoiceNumberKey` in `(userId, financialYear,
   documentType)` → `nextInvoiceNumber(...)` → fall back to `formatInvoiceNumber(pattern,
   {financialYear, sequence: 1})` when there is none. No writes, no gaps.
2. Save races are resolved by the index: catch `E11000`, recompute the suggestion, retry
   **at most twice**, then return 409 to the user. Bound the retry — an unbounded retry
   loop against a unique index is a livelock waiting for a bad day.
3. If the maintainer later wants monotonicity under genuine concurrency, the counter can be
   added behind the same `next-number` endpoint without changing the schema or the index.

### 4.4 The 409 path

`app/api/invoices/route.ts` `POST` (`:257`) and `PUT` (`:324`) currently funnel everything
into a 500. Add, **before** the generic handler in both:

```ts
const isDuplicateKeyError = (e: unknown): boolean =>
  (e as { code?: number })?.code === 11000;
```

Response: **409** with
`{ error: "Invoice number INV/2026-27/007 is already used in 2026-27.", code: "DUPLICATE_INVOICE_NUMBER", suggestion: "INV/2026-27/008" }`.
Do not leak the raw Mongo error message (Phase 0 is removing four such leaks).

Client: `lib/api-client.ts` already converts failures to typed `ApiError`; make sure the
parsed body (including `code` and `suggestion`) survives onto the error object — check
whether `ApiError` currently carries the body, and widen it if not. `InvoiceEditor.saveInvoice`
shows the message with a one-click "Use INV/2026-27/008" action. This is also the natural
place to warn on a **gap** (suggested 008, user typed 011) — a non-blocking notice.

`PUT` needs no self-exclusion: re-saving a document with its own unchanged number does not
violate a unique index (it is the same document).

### 4.5 Backwards compatibility — and the only genuinely irreversible step in Phase 2

Existing documents have **no** `financialYear` and **no** `invoiceNumberKey`. Mongo indexes
missing fields as `null`, so building a unique index on a collection where every document
is missing both fields would collapse them all to one key and fail immediately. The order
is therefore fixed:

1. **Ship the derivation first**, writing `financialYear`/`invoiceNumberKey` on every
   create and update, with **no index**. Deploy. Nothing can break.
2. **Migration script** (`scripts/migrate-invoice-numbering.ts`, matching the existing
   `migrate:*` scripts in `package.json`): for every document, set `financialYear =
   deriveFinancialYear(invoiceDate)` and `invoiceNumberKey = invoiceNumberKey(invoiceNumber)`.
   Preserve `invoiceNumber` untouched — the established migration discipline in this repo
   is additive (CLAUDE.md: prior migrations "preserve the legacy field rather than dropping
   it").
3. **Duplicate report, before any index is created:**
   ```js
   db.invoices.aggregate([
     { $group: { _id: { u: "$userId", fy: "$financialYear", d: "$documentType", n: "$invoiceNumberKey" },
                 n: { $sum: 1 }, ids: { $push: "$_id" } } },
     { $match: { n: { $gt: 1 } } }
   ])
   ```
   **Expect hits.** A 16m40s number cycle plus soft-deleted rows makes real duplicates
   likely. Resolve them by hand or by a documented rule (keep the oldest; suffix the rest
   `-A`, `-B`, checking the 16-char cap) — and record that suffixing **changes an issued
   document's number**, which is why a human decides, not a script.
4. **Only then create the unique index**, in the background.
5. `is_deleted` documents are included at every step. They hold their numbers.

Rollback: dropping the index is instant and safe. The backfilled fields are additive and
harmless. The *irreversible* part is step 3 — any renumbering of a duplicate. Do it with a
`--dry-run` default, as a separate reviewed step, with the before/after list written to a
file.

**Legacy invalid numbers.** Some existing numbers may exceed 16 chars or contain `#`/`_`
(the app never enforced anything). They must not break reads. `validateInvoice` runs on
**write** only, so viewing, printing and listing are unaffected. On edit, an illegal legacy
number will fail validation — which is correct but must not be a dead end: the editor
pre-fills a legal suggestion and explains why ("Invoice numbers may use only letters,
numbers, - and /, max 16 characters"). The alternative (grandfather an unchanged legacy
number through validation) is defensible and cheaper; I prefer hard validation because the
number is the field an auditor looks at, and because the grandfather rule requires
threading "was it changed?" into a pure validator that currently has no access to the
previous document.

### 4.6 Test cases — `tests/invoice-number.test.ts`

`deriveFinancialYear`:
- `"2026-04-01"` → `"2026-27"`; `"2026-03-31"` → `"2025-26"` (the boundary, both sides).
- `"2027-01-15"` → `"2026-27"`; `"2026-12-31"` → `"2026-27"`.
- `new Date("2026-04-01T00:00:00Z")` → `"2026-27"` — and assert it **does not** depend on
  `process.env.TZ`; run the boundary cases with `TZ=America/Los_Angeles` and `TZ=Asia/Kolkata`
  if the harness allows, otherwise assert on the string path and document why UTC getters
  are used.
- `"2026-04-01T18:30:00.000Z"` (an IST-midnight timestamp) → `"2026-27"`.
- Garbage → does not throw; returns the FY of an invalid date deterministically or `""`
  (pick one and pin it).

`isValidInvoiceNumber`:
- valid: `"INV/2026-27/001"`, `"INV-001"`, `"26-27/0042"`, `"A"`, `"1234567890123456"` (16).
- invalid: `"INVOICE/2026-27/0001"` (20), `"INV #001"` (space and `#`), `"INV_001"` (`_`),
  `"INV.001"` (`.`), `""`, `"INV 001"`, `"INV 001"` (non-breaking space).

`parseInvoiceNumber` / `nextInvoiceNumber`:
- `"INV/2026-27/001"` → `{prefix:"INV/2026-27/", sequence:1, width:3}`; next → `"INV/2026-27/002"`.
- `"INV/2026-27/099"` → next `"INV/2026-27/100"` (width preserved).
- `"INV/2026-27/999"` → next would be `"INV/2026-27/1000"` = **16 chars**, still legal → returned.
- `"INV/2026-27/9999"` (16) → next is 17 → **`null`**.
- `"INV-123456"` (the current generated shape) → next `"INV-123457"`.
- `"ABC"` (no trailing digits) → `parseInvoiceNumber` returns `null`, `nextInvoiceNumber`
  returns `null` (caller falls back to the pattern).
- `"001"` → `{prefix:"", sequence:1, width:3}` → `"002"`.

`invoiceNumberKey`: `" inv/2026-27/001 "` → `"INV/2026-27/001"`; two numbers differing only
in case produce the same key.

`formatInvoiceNumber`: `"INV/{FY}/{SEQ:3}"` + `{financialYear:"2026-27", sequence:1}` →
`"INV/2026-27/001"` (assert `.length === 15`); `"INVOICE/{FY}/{SEQ:4}"` → `null`;
`{SEQ:3}` + `sequence: 1000` → `"INV/2026-27/1000"` (16, allowed).

---

## Items 5 + 6 — Place of supply / IGST, and per-line HSN-SAC / UOM / rate

**These two ship as one change set.** The plan says item 6 must land "with or immediately
after" item 5 so `computeTotals` changes once; I would go further — **they are one commit
to `lib/invoice-domain.ts`**, because item 5 without item 6 means writing an invoice-level
IGST amount that item 6 then deletes, i.e. writing the money formula twice and migrating
the schema twice. Split the *UI* work if you like; do not split the domain layer.

Answers (b) and (c) below.

### 5.1 Answer to (b): `deriveSupplyKind` and `splitLineTax`

Both live in `lib/gst-supply.ts`, pure, no imports from `lib/invoices` or
`lib/invoice-domain`.

```ts
export type SupplyKind = "intra" | "inter" | "export" | "sez";

export interface SupplyContext {
  supplierStateCode: string;        // "29"; "" when unknown
  placeOfSupplyStateCode: string;   // "27"; "96" = outside India; "" when unknown
  recipientIsSez: boolean;
  recipientIsOutsideIndia: boolean;
}

export function deriveSupplyKind(ctx: SupplyContext): SupplyKind;
```

**Exhaustive case table, in precedence order.** The order is the specification; an
implementer who reorders these produces a wrong invoice for a real case.

| # | Condition | Result | Authority |
|---|---|---|---|
| 1 | `recipientIsOutsideIndia \|\| placeOfSupplyStateCode === "96"` | `"export"` | IGST §13 default POS = recipient's location; §16 zero-rated (`gst-compliance.md:238`) |
| 2 | `recipientIsSez` | `"sez"` | IGST §7(5)/§8(1) proviso — deemed inter-State **even in-state** (`gst-compliance.md:189`) |
| 3 | both codes non-empty and equal | `"intra"` | IGST §8 |
| 4 | both codes non-empty and different | `"inter"` | IGST §7 |
| 5 | either code empty | `"intra"` (documented fallback) | — |

Notes the implementer must not lose:
- **Export beats SEZ** (row 1 before row 2). If both flags are set the data is
  contradictory; `deriveSupplyKind` still returns a value (it is total), and
  `validateInvoice` raises "An SEZ unit is inside India — clear either the SEZ flag or the
  overseas recipient."
- **SEZ beats the state comparison** (row 2 before rows 3–4). This is the single
  counter-intuitive rule in GST place-of-supply and the one most likely to be
  "simplified" away by a later refactor. Give it a named test.
- **Row 5 is unreachable for a saved GST invoice**, because `validateInvoice` requires both
  codes when `taxTreatment === "gst"`. It exists only so the function is total and so the
  *live preview* renders something sane before the user has filled the fields. Do **not**
  add an `"unknown"` member to the union to model this: it would force every consumer,
  every switch, and every test to handle a state that can never be persisted. The gate is
  validation, not the type.
- `deriveSupplyKind` knows nothing about `taxTreatment`. Callers gate on it.

```ts
/**
 * Union territories WITHOUT a legislature charge UTGST in place of SGST.
 * Delhi (07), Puducherry (34) and Jammu & Kashmir (01) HAVE legislatures -> SGST.
 */
export const UTGST_STATE_CODES = new Set(["04","25","26","31","35","38","97"]);
```

(Chandigarh 04, Daman & Diu 25 (legacy), Dadra & Nagar Haveli and Daman & Diu 26,
Lakshadweep 31, Andaman & Nicobar 35, Ladakh 38, Other Territory 97 —
`gst-compliance.md:307-311`.)

```ts
export interface LineTaxInput {
  taxableValue: number;        // AFTER line discount and apportioned invoice discount
  ratePercent: number;         // the FULL rate: 0 | 0.25 | 3 | 5 | 18 | 40
  kind: SupplyKind;
  withPaymentOfTax?: boolean;  // consulted only for export | sez
}
export interface LineTax { cgst: number; sgst: number; igst: number; }

export function splitLineTax(input: LineTaxInput): LineTax;
```

**Exhaustive case table.** `t` = `max(0, taxableValue)`, `r` = `max(0, ratePercent)`:

| `kind` | `withPaymentOfTax` | `cgst` | `sgst` | `igst` |
|---|---|---|---|---|
| `intra` | (ignored) | `round2(t*r/200)` | same as cgst | `0` |
| `inter` | (ignored) | `0` | `0` | `round2(t*r/100)` |
| `export` | `false`/absent | `0` | `0` | `0` |
| `export` | `true` | `0` | `0` | `round2(t*r/100)` |
| `sez` | `false`/absent | `0` | `0` | `0` |
| `sez` | `true` | `0` | `0` | `round2(t*r/100)` |

Plus the degenerate inputs, all of which must return zeros without throwing: `r === 0`,
`t === 0`, `t < 0`, `NaN`, `Infinity`, `ratePercent` negative.

- **`splitLineTax` does not know about UTGST.** UTGST is stored in the `sgst` slot and
  differs only in label, which is `resolveTaxPresentation`'s job. Storing a separate
  `utgst` field would double the number of legacy fallbacks in `resolveRecordAmounts` and
  in the exporters for zero arithmetic benefit — GSTR-1 reports SGST and UTGST in one
  column. **This is a deliberate decision to record in code comments**, because the field
  name lies about its contents for UT suppliers.
- **`splitLineTax` does not know about `taxTreatment` or `reverseCharge`.** Those suppress
  tax entirely and are handled one level up, in `computeTotals`, by not calling it. Keeping
  suppression out of `splitLineTax` is what makes its case table small enough to be
  exhaustively tested.
- **Half-rate rounding:** `cgst = sgst = round2(t*r/200)`, each rounded *then* used —
  so `cgst + sgst` may differ from `round2(t*r/100)` by ≤ ₹0.01. That is intentional. Equal
  CGST and SGST amounts matter more than an exact sum, because unequal halves are a
  reporting red flag in GSTR-1; the research states the same ("note: half is rounded, then
  doubled", `gst-compliance.md:333`). Pin it with an explicit test: `t = 1000.05, r = 18`.

Bug note: the research's own sketch at `gst-compliance.md:322` references an undefined
`withPayment` identifier inside `splitLineTax`. The signature above fixes it by making it a
parameter. Do not copy the sketch verbatim.

### 5.2 Answer to (b), part 2: `buildTotalsRows` and the three renderers

`buildTotalsRows` keeps its signature (decision D1). The row list becomes:

```
Subtotal                     always
Discount                     always (preserves current behaviour, including 0.00)
<tax rows>                   0, 1 or 2 rows from totals.taxRows — never 3, never zeros-as-placeholders
Service Charge               always (preserves current behaviour)
Round Off                    only when totals.roundOff !== 0
Total                        always
```

`totals.taxRows` is `Array<{ head: TaxHead; label: string; amount: number }>` produced by
`computeTotals` from `resolveTaxPresentation`. Labels: `CGST`, `SGST`, `UTGST`, `IGST`,
each suffixed with the rate when every taxed line shares one rate (`"IGST @ 18%"`), and
unsuffixed when the invoice is mixed-rate — the per-line rate column carries the detail in
that case (Rule 46(k) is satisfied per line, not by the totals block).

**Verified in the current code that all three renderings inherit this for free:**

- `components/InvoiceEditor.tsx:1153` — `buildTotalsRows(totals).map(...)`, one argument,
  keys on `row.label`. ⚠️ It uses `key={row.label}`; with a rate suffix the labels stay
  unique, but if a future change emits two rows with the same label React will warn. Switch
  the key to `row.head ?? row.label`.
- `components/InvoiceModal.tsx:53` — `buildTotalsRows(resolveRecordAmounts(invoice))`, one
  argument. (The Phase 0 "route InvoiceModal through resolveRecordAmounts + buildTotalsRows"
  item is already done in code, though `docs/LAUNCH-PROGRESS.md` still shows it unchecked.)
- `lib/invoice-export.ts:385` — HTML totals table, one argument.
- `lib/invoice-export.ts:459` — CSV, one argument. **CSV inherits the change too**, which
  the plan does not mention. New labels must still go through `neutralizeCsvValue`
  (`lib/invoice-export.ts:29`) — they do, because the CSV writer neutralizes every cell.

So the totals section cannot drift. What is **not** shared and must be changed in two
places is the **line-item table**: `lib/invoice-export.ts:367-380` (HTML `<thead>`/rows) and
`components/InvoiceEditor.tsx:1127` (preview grid). Item 6 adds HSN/SAC, UOM, rate and
per-line tax columns to both. Consider extracting a `buildLineItemColumns(totals)` in
`lib/invoice-domain.ts` on the same principle as `buildTotalsRows` — the plan does not ask
for it, and I recommend it, because otherwise item 6 re-creates exactly the drift that
`buildTotalsRows` was introduced to eliminate.

New invoice-level fields for item 5, through the §0.1 checklist (all optional on
`InvoiceRecord`, defaulted on `InvoiceFormState`, present in all four AI files):

```ts
supplierStateCode?: string          // "29"
placeOfSupplyStateCode?: string     // "27" | "96"
placeOfSupplyLabel?: string         // "Maharashtra" | "United States" — printed
placeOfSupplyOverridden?: boolean   // user moved POS away from the client's GSTIN state
supplyKind?: SupplyKind             // DERIVED but STORED (audit trail + D3)
recipientIsSez?: boolean
withPaymentOfTax?: boolean          // export/SEZ: IGST-with-refund vs LUT
lutArn?: string
countryOfDestination?: string       // required when supplyKind === "export"
```

Print, when `supplyKind` is `export` or `sez`, the **verbatim** Rule 46 proviso endorsement
(`gst-compliance.md:243-247`) — two exact strings, chosen by `withPaymentOfTax`, kept as
constants in `lib/gst-supply.ts` (`EXPORT_ENDORSEMENT_WITH_TAX`,
`EXPORT_ENDORSEMENT_UNDER_LUT`) so the preview and the export share one copy. They are
statutory wording: do not reflow, re-case, or "improve" them.

### 5.3 Answer to (c): the new `computeTotals` contract

Today (`lib/invoice-domain.ts:55`): takes `{items:[{quantity,unitPrice}], discount, cgst,
sgst, convenienceCharge}`, returns six numbers, formula
`subtotal - discount + cgst + sgst + convenienceCharge`, clamped at 0, `round2` at each
step.

#### Input

```ts
export interface TotalsLineInput {
  quantity: number;
  unitPrice: number;
  discount?: number;         // per-line, absolute, in currency units
  taxRatePercent?: number;   // full rate; undefined => untaxed
  /** Set only when replaying a stored, already-issued invoice (decision D3). */
  storedTax?: LineTax;
}

export type TotalsTaxContext =
  /** Pre-Phase-2 documents, and any record with no taxTreatment. */
  | { mode: "legacy"; cgst: number; sgst: number }
  /** taxTreatment "none" | "composition", or reverseCharge, or zero-rated under LUT. */
  | { mode: "none"; suppressedBecause: TaxPresentation["suppressedBecause"] }
  /** The real path. */
  | { mode: "derived";
      supplyKind: SupplyKind;
      supplierStateCode: string;
      withPaymentOfTax: boolean };

export interface TotalsInput {
  items: TotalsLineInput[];
  discount: number;                 // invoice-level, absolute
  convenienceCharge: number;
  tax?: TotalsTaxContext;           // ABSENT => { mode: "legacy", cgst: 0, sgst: 0 }
  /** Deprecated flat fields, kept so existing call sites compile unchanged. */
  cgst?: number;
  sgst?: number;
}
```

`tax` absent + flat `cgst`/`sgst` present ⇒ `{mode:"legacy"}` with those amounts. **Every
existing call site and every existing test therefore keeps working with no edit**, which
is what lets items 5+6 land behind a flag and be verified against the current behaviour
before anything switches over. Remove the deprecated fields in a follow-up commit, not in
this one.

#### Output

```ts
export interface ComputedLine {
  gross: number;         // round2(qty * unitPrice)
  lineDiscount: number;  // as entered, clamped to [0, gross]
  apportioned: number;   // share of the invoice-level discount
  taxable: number;       // round2(gross - lineDiscount - apportioned), >= 0
  ratePercent: number;   // 0 when untaxed
  tax: LineTax;          // {cgst, sgst, igst}
}

export interface TaxRow { head: TaxHead; label: string; amount: number }

export interface InvoiceTotals {
  subtotal: number;            // Σ gross — unchanged meaning, still pre-discount
  discount: number;            // total actually applied (line + invoice)
  taxableValue: number;        // subtotal - discount  (Rule 46(j))
  lines: ComputedLine[];
  taxRows: TaxRow[];           // 0, 1 or 2 entries. Never 3. Never zero placeholders.
  cgst: number;                // rollup; holds UTGST for UT intra-state suppliers
  sgst: number;                // rollup
  igst: number;                // rollup  (NEW)
  convenienceCharge: number;
  roundOff: number;            // signed, may be 0  (NEW)
  total: number;               // whole rupees when roundOff !== 0
  suppressedBecause: TaxPresentation["suppressedBecause"];  // for the explanatory line
}
```

`subtotal`, `discount`, `cgst`, `sgst`, `convenienceCharge`, `total` keep their exact
current names, positions and meanings, so `resolveRecordAmounts`, `InvoiceModal`, the
exporters and the API's `NormalizedInvoicePayload` all continue to compile and to persist
the same six numbers. `igst`, `roundOff`, `taxableValue`, `lines`, `taxRows`,
`suppressedBecause` are additive.

#### The algorithm, in order

```
1. per line:  gross_i    = round2(max(0,qty_i) * max(0,price_i))
              lineDisc_i = clamp(lineDiscount_i, 0, gross_i)
              net_i      = gross_i - lineDisc_i
2. subtotal   = round2(Σ gross_i)
3. netBase    = Σ net_i
   invDisc    = clamp(invoiceDiscount, 0, netBase)          // cannot exceed what is there
4. apportion invDisc across lines pro-rata to net_i  (see 5.4)
5. taxable_i  = round2(max(0, net_i - apportioned_i))
   taxableValue = round2(Σ taxable_i)
   discount   = round2(Σ lineDisc_i + invDisc)
6. tax:
     mode "legacy":  cgst/sgst from input verbatim (round2, clamp >= 0), igst = 0,
                     lines[].tax all zeros, taxRows = [CGST, SGST] with the legacy labels
     mode "none":    all zeros, taxRows = []
     mode "derived": per line  tax_i = splitLineTax({taxable_i, ratePercent_i, kind, withPaymentOfTax})
                     cgst = round2(Σ tax_i.cgst), sgst = round2(Σ tax_i.sgst), igst = round2(Σ tax_i.igst)
                     taxRows from resolveTaxPresentation(...) heads, in head order
7. charge     = round2(max(0, convenienceCharge))
8. rawTotal   = max(0, taxableValue + cgst + sgst + igst + charge)
9. total      = Math.round(rawTotal)          // §170, nearest rupee, half up
   roundOff   = round2(total - rawTotal)      // signed; the printed Round Off row
```

The old formula is the `mode:"legacy"` path of exactly this, with one line and no
apportionment: `subtotal - discount + cgst + sgst + convenienceCharge`, clamped at 0,
`round2` at each step. The generalisation replaces the scalar `cgst + sgst` with
`Σ per-line splits` and inserts steps 4, 5 and 9. `round2` discipline and the clamp at 0
are preserved verbatim.

`Math.round` is half-up for positive values, which is what §170 requires — normal
rounding, not banker's, not always-up (`gst-compliance.md:431`). Export it as
`roundToRupee` for reuse and for testability.

### 5.4 Discount: pre-tax, apportioned pro-rata. Justified from law, not intuition.

**Decision: an on-invoice discount reduces the taxable value BEFORE tax, and an
invoice-level discount is apportioned across lines pro-rata to their post-line-discount
value.** Both a per-line `discount` and the existing invoice-level `discount` are
supported; the per-line field is the preferred input and the invoice-level one is kept
because it is what the app has today and what users type.

The authority is **CGST §15(3)(a)**: the value of a supply excludes a discount "given
before or at the time of the supply" where it "has been duly recorded in the invoice issued
in respect of such supply." A discount printed on the invoice is by definition recorded in
it, so it is excluded from the value of supply, and tax is charged on the reduced value.
The research reaches the same place from the invoice side: **Rule 46(j)** requires the
"**taxable value** after discount/abatement" as a distinct particular
(`gst-compliance.md:68`), and it flags today's behaviour — "discount is invoice-level
only" — as the gap. §15(3)(b) (post-supply discounts) is out of scope by construction: it
needs a pre-existing agreement and is settled by a **credit note**, not by an invoice line
(`gst-compliance.md:529` puts post-supply discount squarely in credit-note territory, and
credit notes are Phase 4).

Why **apportioned** rather than any of the alternatives:

- *Post-tax (today's behaviour)* — wrong. It taxes value the supplier never charged. On an
  ₹1,00,000 invoice with a ₹10,000 discount at 18%, it overstates output tax by ₹1,800 per
  invoice, which the supplier pays and the recipient cannot claim. This is the actual
  defect, not a rounding nicety.
- *Pre-tax but applied to a single "dominant rate"* — wrong on any mixed-rate invoice, and
  mixed-rate invoices are the whole reason item 6 exists (`gst-compliance.md:410`: ₹50,000
  consulting at 18% + ₹2,000 books at 0%). Attributing the whole discount to the 18% line
  understates tax; attributing it to the 0% line overstates it.
- *Per-line only, refusing an invoice-level discount* — legally clean and a UX regression;
  the invoice-level discount is an existing, used field, and removing it mid-phase is not
  something item 5 should be doing.
- *Pro-rata apportionment* — matches how every Indian accounting package attributes a bill
  discount, keeps the printed `Discount` row equal to what the user typed, and reduces each
  rate's taxable value in proportion to that rate's share of the bill. It is also the only
  option under which the sum of the per-line taxable values equals `subtotal - discount`,
  which is exactly what Rule 46(i)/(j) asks the document to show.

**The apportionment must not leak paise.** Naive `round2(invDisc * net_i / netBase)` on
every line does not sum back to `invDisc` (₹100 across three equal lines gives
33.33×3 = 99.99), and then the printed `Discount` row disagrees with the sum of the line
reductions by a paisa — the kind of thing an accountant emails about. Algorithm:

```
apportioned_i = round2(invDisc * net_i / netBase)   for every line with net_i > 0
                except the LAST such line, which takes:
apportioned_last = round2(invDisc - Σ apportioned_others)
```

Edge cases, all of which need a test:
- `netBase === 0` (everything free, or every line fully line-discounted) → every
  `apportioned_i = 0`, and `invDisc` clamps to 0 in step 3. **No division by zero.**
- A line with `net_i === 0` gets `apportioned_i = 0` and is skipped by the "last line"
  selection.
- Exactly one line with `net_i > 0` → it takes the whole `invDisc` (the residual branch).
- `invoiceDiscount > netBase` → clamped to `netBase`; total taxable value is 0; total is
  `convenienceCharge` only. Preserves today's clamp-at-0 behaviour.

**`convenienceCharge` stays outside the tax base — deliberately, and it is legally
questionable.** §15(2)(c) includes "incidental expenses… charged by the supplier" in the
value of supply, so a Service Charge is very likely taxable. Making it taxable now would
silently change the total of every invoice a user habitually produces, in the same commit
that changes everything else about tax — an untraceable diff. Phase 2 therefore preserves
today's post-tax placement; the right fix is to retire the field into an ordinary line item
with its own HSN/SAC and rate (which item 6 makes possible) and delete it. **Flagged as an
open decision, not silently kept.**

### 5.5 Item 6 — line-item schema

```ts
items: [{
  name: string,              // existing
  hsnSac?: string,           // 4, 6 or 8 digits, digits only
  quantity: number,          // existing
  unit?: string,             // UQC code: NOS, PCS, KGS, MTR, LTR, HRS, DAY, OTH...
  price: number,             // existing (unit price)
  discount?: number,         // per-line, absolute
  taxRatePercent?: number,   // 0 | 0.25 | 3 | 5 | 18 | 40
  // derived, STORED for audit and for D3:
  taxableValue?: number, cgstAmount?: number, sgstAmount?: number, igstAmount?: number,
}]
```

Rates (`lib/gst-rates.ts`), with a `lastVerified` comment — GST 2.0 took effect
**22 Sep 2025**, abolishing 12% and 28% and adding 40%
(`gst-compliance.md:386-396`):

```ts
// lastVerified: 2026-08 (source: docs/research/gst-compliance.md §3(a))
export const GST_RATES = [0, 5, 18, 40] as const;
export const GST_SPECIAL_RATES = [0.25, 3] as const;   // rough stones, bullion
export const GST_RETIRED_RATES = [12, 28] as const;    // accept on READ, never offer
```

**Do not hardcode 12 or 28 in a picker.** Accept them on read (documents issued before
22 Sep 2025 legitimately carry them; Invoicey has no per-line rates from that era, but a
user may type one) and show a warning: "12% and 28% were withdrawn on 22 Sep 2025."

HSN/SAC validation (`gst-compliance.md:101-110`): digits only, length ∈ {4, 6, 8};
services use SAC, 6 digits, always beginning `99`. Digit-count requirement is
turnover-based (4 digits ≤ ₹5cr, 6 digits above) — Invoicey does not know the user's
turnover, so **do not enforce a digit count**; validate the format, and require *presence*
only when `taxTreatment === "gst"`.

UQC list: keep a short curated set (`NOS, PCS, KGS, GMS, LTR, MLT, MTR, SQF, SQM, HRS,
DAY, MON, SET, BOX, BAG, OTH`) in `lib/gst-rates.ts` with `OTH` as the fallback, and let
the field be free text capped at 8 characters rather than a hard enum — a wrong UQC is a
return-filing annoyance, a blocked save is a lost invoice.

Through the §0.1 checklist, the line item touches: `models/Invoice.ts:62` (subdocument),
`IInvoice.items`, `InvoiceLineItem` (`lib/invoices.ts:11`), `InvoiceFormItem`
(`lib/invoices.ts:48`), all three mappers, `normalizeItems` (`route.ts:96` — which already
accepts both item shapes defensively and must keep doing so), and the AI's `InvoiceFormItem`
usage in `contracts.ts:25`, `prompt.ts:51`, `normalization.ts:96`, `apply-patch.ts:32`.

### 5.6 Backwards compatibility for items 5+6

| Field | Absent on an old document ⇒ |
|---|---|
| `taxTreatment` | `inferLegacyTaxTreatment` (item 1) ⇒ `computeTotals` `mode:"legacy"` |
| `supplyKind` | not derived, not needed — legacy mode never calls `splitLineTax` |
| `supplierStateCode` / `placeOfSupplyStateCode` | `""`; nothing printed; no place-of-supply block |
| `items[].taxRatePercent` | `undefined` ⇒ the line contributes no tax; in legacy mode the invoice-level amounts carry the tax instead |
| `items[].hsnSac` / `unit` | column omitted from the printed table when **no** line has one — do not print an empty column |
| `items[].taxableValue` etc. | recomputed; for legacy documents they are never written |
| `igst` | `0` |
| `roundOff` | `0`; the Round Off row is not emitted |

`resolveRecordAmounts` (`lib/invoice-domain.ts:80`) becomes the mode selector:

```ts
const treatment = invoice.taxTreatment ?? inferLegacyTaxTreatment(invoice);
const tax: TotalsTaxContext =
  invoice.taxTreatment === undefined
    ? { mode: "legacy", cgst: invoice.cgst ?? invoice.tax ?? 0, sgst: invoice.sgst ?? 0 }
    : treatment !== "gst" || invoice.reverseCharge
      ? { mode: "none", suppressedBecause: ... }
      : { mode: "derived", supplyKind: invoice.supplyKind ?? "intra",
          supplierStateCode: invoice.supplierStateCode ?? "",
          withPaymentOfTax: invoice.withPaymentOfTax ?? false };
```

The existing `?? tax` fallback survives **in exactly one place**, as it does today
(`lib/invoice-domain.ts:87`), and the existing `??` honouring of stored `subtotal`/`total`
(`:94-95`) extends to stored per-line tax amounts (D3): when
`invoice.items[i].cgstAmount !== undefined`, use it rather than recomputing. That is what
stops a future `GST_RATES` edit from re-pricing an issued document.

### 5.7 Test cases — `tests/gst-supply.test.ts` and `tests/invoice-domain.test.ts`

`deriveSupplyKind` — one test per row of the 5.1 table, plus the named traps:
- SEZ in the **same** state → `"sez"`, not `"intra"`. ("SEZ is always inter-State.")
- SEZ **and** outside India → `"export"` (precedence), and `validateInvoice` errors.
- `supplier "29"`, POS `"29"` → `"intra"`; POS `"27"` → `"inter"`.
- POS `"96"` → `"export"` even with `recipientIsOutsideIndia: false`.
- Either code `""` → `"intra"`, with a comment that validation makes this unreachable
  for a saved GST invoice.

`splitLineTax` — one test per row of the case table, plus:
- 18% intra on ₹1,000 → `{cgst: 90, sgst: 90, igst: 0}`.
- 18% inter on ₹1,000 → `{cgst: 0, sgst: 0, igst: 180}`.
- **half-rounding**: `t = 1000.05, r = 18` → cgst = sgst = `90.00` (`90.0045` → `90.00`),
  and `cgst + sgst` (180.00) vs `round2(t*18/100)` (180.01) differ by 0.01 — assert both,
  so the behaviour is pinned rather than discovered.
- export under LUT → all zeros; export with payment → full IGST.
- `r = 0` → all zeros for every kind. `t = -5` → all zeros. `r = NaN` → all zeros.
- **Invariant over all kinds and rates**: never both `igst > 0` and (`cgst > 0` or `sgst > 0`).

`computeTotals` — the table-driven set the research asks for (`gst-compliance.md:474`):
- **Legacy parity**: the exact input from `tests/invoice-domain.test.ts:40` produces the
  exact same six numbers. This is the regression that must never go red.
- Mixed rate, intra: ₹50,000 @ 18% + ₹2,000 @ 0% → cgst = sgst = 4,500, igst = 0,
  taxable 52,000, total 61,000.
- Same invoice, inter: igst = 9,000, cgst = sgst = 0, `taxRows.length === 1`.
- **Discount apportionment**: two lines ₹1,000 @ 18% and ₹1,000 @ 5%, invoice discount
  ₹200 → apportioned 100/100, taxable 900/900, cgst = round2(81) + round2(22.5) …
  assert the exact per-line taxable and the exact head totals.
- **Apportionment residual**: ₹100 discount across three equal ₹1,000 lines →
  apportioned `[33.33, 33.33, 33.34]`, Σ = exactly 100.00, and `totals.discount === 100`.
- Discount > subtotal → taxable 0, tax 0, total = convenienceCharge, never negative.
- `netBase === 0` (single line, qty 0) → no NaN anywhere; every number finite.
- **Round off**: an invoice whose raw total is 1,234.56 → `total 1235`, `roundOff 0.44`;
  raw 1,234.49 → `total 1234`, `roundOff -0.49`; raw exactly 1,234.00 → `roundOff 0` and
  **`buildTotalsRows` emits no Round Off row**.
- `mode:"none"` → `taxRows: []`, all heads 0, and `total === taxableValue + charge`.
- Export under LUT with an 18% rate on the lines → tax 0 (the rate does not leak into the
  total), `suppressedBecause: "zero_rated_lut"`.
- UT supplier (`"04"`), intra → `taxRows[1].label === "UTGST"` while `totals.sgst` carries
  the amount (the field-name-lies-about-contents case).
- **`buildTotalsRows` invariant**: for every treatment × kind combination, the rows never
  contain a zero-amount tax row, and never contain both an IGST row and a CGST row.

### 5.8 The editor's %/₹ toggle must go (for tax), and the AI contract must follow

`components/InvoiceEditor.tsx:87-90` holds `cgstMode`/`sgstMode`/`cgstRate`/`sgstRate` as
**UI-only** state, and `:163-180` are two effects that recompute `invoice.cgst` /
`invoice.sgst` from `subtotal × rate` whenever the subtotal changes. The percentage itself
is never persisted, so an edited invoice always reopens in amount mode (CLAUDE.md says so
explicitly).

Once tax is per-line and derived, this whole apparatus is dead and **must be deleted**, not
left switched off:
- Delete `cgstMode`, `sgstMode`, `cgstRate`, `sgstRate` and both effects
  (`InvoiceEditor.tsx:163-180`), and the two toggle buttons (`:908-1010`).
- Keep the %/₹ toggle for **`discount`**, where both modes are genuinely meaningful
  (`gst-compliance.md:467`). Note that a percentage discount must be resolved to an amount
  *before* `computeTotals` sees it, exactly as it is today.
- ⚠️ `lib/numeric-input.ts:106-112` documents that an empty draft publishes the field
  minimum specifically so that "clearing Qty cannot momentarily zero the subtotal and,
  **through the percent-mode effects**, the stored CGST/SGST". Deleting the percent-mode
  effects removes that coupling. Do **not** take it as licence to relax
  `liveNumericValue`: the reason is now the per-line tax derivation instead, which has the
  same hazard (a blank Qty would momentarily zero a line's taxable value and its stored
  tax). Update that comment rather than the behaviour.

**AI contract (all four files must stay identical — CLAUDE.md).** The assistant currently
emits absolute `cgst`/`sgst` amounts and `prompt.ts:71` instructs it to split a single
"tax" request evenly. That rule becomes wrong the moment tax is derived: an even split is
correct for intra-State and *silently wrong* for inter-State.

- `contracts.ts:10` — drop `cgst`/`sgst` from `InvoiceAssistantPatch`; add
  `items[].taxRatePercent`, `items[].hsnSac`, `items[].unit`, `items[].discount`, plus
  `companyGstin`, `billToGstin`, `placeOfSupplyStateCode`, `taxTreatment`.
- `prompt.ts:26` — replace the `cgst`/`sgst` schema entries with the per-line fields, and
  **replace rule 11 entirely**: "Tax is per line. Emit `taxRatePercent` on each item, using
  only 0, 5, 18 or 40 (also 0.25 and 3 for bullion and rough stones). Never emit tax
  amounts; the app derives CGST/SGST/IGST from the rate and the place of supply. Never
  invent a GSTIN or an HSN/SAC code."
- `normalization.ts:183-191` — delete the `cgst`/`sgst` blocks; add a rate normalizer that
  **whitelists** against `GST_RATES ∪ GST_SPECIAL_RATES ∪ GST_RETIRED_RATES` and drops
  anything else (a hallucinated 15% must not reach form state), and an `hsnSac` normalizer
  (`/^\d{4}(\d{2})?(\d{2})?$/`, drop otherwise).
- `apply-patch.ts:142-158` — delete the `cgst`/`sgst` application blocks; add the per-line
  fields to `normalizeItems` (`apply-patch.ts:32`).
- `tests/ai-normalization.test.ts` — add: a hallucinated GSTIN is dropped; a 15% rate is
  dropped; a 12% rate is **kept** (retired but real); `hsnSac: "99A314"` is dropped;
  `hsnSac: "998314"` is kept; the model emitting `cgst: 500` is ignored entirely.

### 5.9 Validation rules added to `validateInvoice`

In `lib/invoice-domain.ts:137`, in this order (first error wins, as today). `ValidatableInvoice`
gains the new optional fields.

- `taxTreatment === "gst"` and no `supplierStateCode` → "Select the state you're registered in."
- `taxTreatment === "gst"` and no `placeOfSupplyStateCode` → "Select the place of supply."
- `supplierStateCode !== stateCodeFromGstin(companyGstin)` (when both present) →
  "Your state must match the first two digits of your GSTIN." (`gst-compliance.md:360`)
- `supplyKind === "export"` and no `countryOfDestination` → "Country of destination is
  required on an export invoice."
- `supplyKind === "export" | "sez"` and `!withPaymentOfTax` and no `lutArn` → "Enter your
  LUT ARN, or switch to 'with payment of tax'." (`gst-compliance.md:355`)
- `supplyKind === "inter"` and `totals.cgst + totals.sgst > 0` → hard error. Unreachable by
  construction once tax is derived, which is exactly why it should be asserted: it is a
  cheap tripwire on the derivation itself.
- `supplyKind === "intra"` and `totals.igst > 0` → hard error, same reasoning.
- `taxTreatment === "gst"` and any line has a `taxRatePercent` but no `hsnSac` → "Add an
  HSN or SAC code for every taxed line." (Rule 46(f))
- `taxTreatment === "composition"` and `supplyKind !== "intra"` → error for goods lines
  (HSN not starting `99`), warning otherwise (see §1.2).
- `invoiceNumber` fails `isValidInvoiceNumber` → the Rule 46(b) message (item 4).

**`validateInvoice` needs a warning channel.** It returns `string | null` today, and at
least three of the rules above are warnings, not errors (the POS-vs-client-GSTIN mismatch,
retired rates, composition + inter-State services). Widen it as:

```ts
export interface InvoiceValidation { error: string | null; warnings: string[] }
export const validateInvoice = (i: ValidatableInvoice): string | null   // keep, delegates
export const validateInvoiceDetailed = (i: ValidatableInvoice): InvoiceValidation  // new
```

Keeping the old export as a thin delegate means `route.ts:230`, `route.ts:303` and
`InvoiceEditor.saveInvoice` compile untouched, and the editor opts into warnings when it is
ready to display them. Do not change the existing signature in place — three call sites and
a test file depend on `string | null`.

---

## Item 7 — Amount in words, `en-GB` dates, PAN + TDS, signature block, round-off

Five independent **S** changes. Round-off is already delivered by items 5+6 (§5.3 step 9);
the rest follow.

### 7.1 Amount in words — `lib/amount-in-words.ts`

```ts
/** Indian system: crore / lakh / thousand / hundred, plus paise. */
export function amountInWordsIndian(value: number, currency?: string): string;
```
Output shape: `"Indian Rupees One Lakh Twenty Three Thousand Four Hundred Fifty and Sixty
Paise Only"`. Not a Rule 46 requirement, but "the single most commonly remarked-on
omission when an Indian accountant reads a foreign-built invoice"
(`docs/LAUNCH-PLAN.md`, "Other correctness gaps").

Tests: `0` → "Zero … Only"; `1` → "One Rupee Only" (singular); `100000` → "One Lakh";
`10000000` → "One Crore"; `1234567.89` → the full string with paise; `0.05` → "Five Paise
Only"; a negative → prefixed "Minus"; a non-INR currency uses the currency name, not
"Rupees". The lakh/crore grouping (2,2,3 digits) is the thing to pin — Western
thousands-grouping here is the classic bug.

Print it under the totals block in both renderings. It reads `totals.total`, so it is
correct for legacy documents too, with no compatibility concern.

### 7.2 `en-GB` dates

`lib/invoices.ts:268` — `toLocaleDateString("en-US", …)` → `"en-GB"`, giving
"17 Aug 2026". One character of diff. Note the blast radius: `formatDateLong` is used by
the export (`lib/invoice-export.ts:341,343,447,448,420`), `InvoiceModal`, the editor
preview (`InvoiceEditor.tsx:1114,1122`) and the dashboard. That is the point — one change,
everywhere. Currency is already correctly `en-IN` for INR (`lib/invoices.ts:251`).

Update `tests/invoices.test.ts` / `tests/invoice-export.test.ts` if they assert on a
formatted date. **This is the only Phase 2 change that alters the appearance of every
existing invoice**, so land it alone, in its own commit.

### 7.3 PAN and TDS

```ts
companyPan?: string        // auto-derived via panFromGstin(companyGstin) when present
tdsSection?: "194J_professional" | "194J_technical" | "194C" | "none"
tdsRatePercent?: number    // prefilled from the section, overridable
tdsAmount?: number         // derived, stored
```

Rates (`gst-compliance.md:954-960`): 194J professional **10%**, 194J technical **2%**,
194C **1%** individual/HUF and **2%** otherwise; threshold ₹50,000 per FY for 194J.

**The one rule that must not be got wrong: `tdsAmount` is computed on the pre-GST taxable
value, never on the total** (CBDT Circular 23/2017, `gst-compliance.md:975`). So
`tdsAmount = round2(totals.taxableValue * rate / 100)` — `taxableValue` exists on
`InvoiceTotals` precisely for this.

`buildTotalsRows` gains two rows **after** `Total`, emitted only when
`tdsSection && tdsSection !== "none"`:
`{ label: "Less: TDS @10% (194J)", amount: -tdsAmount, kind: "info" }` and
`{ label: "Net Payable", amount: total - tdsAmount, kind: "grand" }`.
This needs a new `TotalsRowKind` value `"info"` (`lib/invoice-domain.ts:99`), and all four
renderers must handle an unknown kind gracefully — check each: the editor
(`InvoiceEditor.tsx:1156`) and the export (`invoice-export.ts:388`) both branch only on
`"grand"` and `"discount"` and fall through to a default style, so `"info"` degrades
safely even before it is styled. Good; add the styling anyway.

The **legal Total is still `Total`** — TDS is the client's deduction, not a reduction of the
invoice's value. The `"info"` kind exists to make that visually unambiguous.

Section codes: FY 2026-27 renumbers 194J → "Section 393 SN 11" and 194C → "SN 6"
(`gst-compliance.md:966`, marked **UNVERIFIED**). Print both or neither; the research's
advice, which I would follow, is to print both: `"194J / s.393 SN 11"`.

Backwards compatibility: absent ⇒ no rows. Nothing changes for any existing document.

### 7.4 Signature block

```ts
signatureLabel?: string       // defaults to `For ${companyName}`
signatureImageUrl?: string    // MUST go through toSafeImageUrl (invoice-export.ts:36)
```
Plus the conventional line **"This is a computer-generated invoice and does not require a
signature."** — the research is explicit that this is ubiquitous *practice*, **not** a
statutory safe harbour (`gst-compliance.md:80-86`, restated at `:1484`). Word the UI so it
does not promise otherwise.

### 7.5 Reverse-charge indicator

Rule 46(o) requires "whether tax is payable on reverse charge" as a printed particular
(`gst-compliance.md:73`). The `reverseCharge` field arrives in item 1; item 7 is where the
`Reverse Charge: Yes/No` line gets printed in both renderings. Print it for every GST
document, including when it is `No` — the requirement is the *indicator*, not the flag.

---

## Item 8 — Print CSS hardening

Everything is in `lib/invoice-export.ts`'s `<style>` block (`:89-315`) and the iframe print
path in `components/InvoiceModal.tsx:64-131`.

1. **Repeating table header.** `thead { display: table-header-group }` and
   `tfoot { display: table-footer-group }`. Without it, a two-page invoice's second page
   has an unlabelled item table.
2. **`break-inside: avoid`** on `tbody tr`, `.box`, `.summary`, `.notes h3 + p`, and the
   signature block. Add `page-break-inside: avoid` alongside for older engines.
3. **Remove `overflow: hidden` in print.** `.sheet { overflow: hidden }`
   (`lib/invoice-export.ts:114`) is a rounded-corner trick that in several engines clips
   the element to one page — content past the first page silently disappears. The existing
   `@media print` block (`:302-314`) already resets `border`, `box-shadow`, `max-width` and
   `border-radius`; add `overflow: visible`.
4. **Await fonts and images before printing.** `frame.onload` (`InvoiceModal.tsx:104`)
   fires before web fonts settle and before a remote `companyLogo` decodes, so the print
   dialog can capture a logo-less, fallback-font page. Before calling
   `frameWindow.print()`:
   ```ts
   await Promise.race([
     Promise.all([
       frameWindow.document.fonts?.ready ?? Promise.resolve(),
       ...Array.from(frameWindow.document.images).map(img =>
         img.complete ? Promise.resolve() : img.decode().catch(() => {})),
     ]),
     new Promise(r => setTimeout(r, 3000)),   // never block the dialog on a dead CDN
   ]);
   ```
   The race is not optional: a `companyLogo` pointing at an unreachable host must not stop
   the user printing. The existing 15 s load timeout and the `afterprint` teardown
   (`InvoiceModal.tsx:100-120`) stay as they are — that logic is already careful and
   well-commented, and this hooks inside it.
5. `@page { size: A4; margin: 14mm }` already exists (`:297-300`). Add
   `orphans: 3; widows: 3` on `body`.
6. Guard the new columns from item 6: the item table gains up to four columns (HSN/SAC,
   UOM, rate, per-line tax). At A4 width that overflows. Give the description column
   `width: 100%` with the rest `white-space: nowrap`, and drop the UOM and HSN columns from
   the printed table when no line populates them.

No schema, no types, no backwards-compatibility surface. It is the one item in Phase 2
that can ship at any time, in any order.

---

## Answer to (f): sequencing, shippable seams, and what cannot be rolled back

The plan's order (1 → 8) is right in its dependencies and wrong in two places about what
can ship independently. Here is the work broken into steps that each end at a deployable
state.

| Step | Work | Ships alone? | Reversible? |
|---|---|---|---|
| **A** | `lib/gstin.ts` + `tests/gstin.test.ts`. Pure module, zero wiring. | yes (no user-visible change) | fully |
| **B** | `lib/gst-supply.ts` + `lib/gst-rates.ts` + `lib/invoice-number.ts` + tests. Still pure, still unwired. | yes | fully |
| **C** | Item 1 — `taxTreatment`, `documentType`, `reverseCharge`; `inferLegacyTaxTreatment`; conditional tax rows in `buildTotalsRows`; document title. **`InvoiceTotals` widens here** (D1). | yes — this is the "cheapest fix, helps the most users" release | schema additive; the visible change is that all-zero legacy tax rows disappear |
| **D** | Item 2 — GSTIN fields wired into the form, the API normalizer, `validateInvoice` and the four AI files; `taxTreatment` derives from the GSTIN. | yes | fully (fields are additive and optional) |
| **E** | Item 3 — `BusinessProfile` model, `/api/profile`, `profileApi`, seeded `createDefaultInvoiceFormState`. | yes | new collection; drop it to revert |
| **F1** | Item 4a — derive and **write** `financialYear` + `invoiceNumberKey`, charset/length validation, auto-suggest endpoint. **No index.** | yes | fully |
| **F2** | Item 4b — backfill migration + duplicate report (`--dry-run` first). | yes | read-only until a human approves renumbering |
| **F3** | Item 4c — create the unique index; add 409 handling and the client retry. | yes | index drops instantly; **renumbering done in F2 does not** |
| **G** | Items 5+6 — the `computeTotals` rewrite, per-line fields, place of supply, IGST, round-off, the AI contract change, deleting the %/₹ tax toggle. **One change set.** | yes, but it is the big one | schema additive; behaviour change is large |
| **H** | Item 7 — amount in words, PAN + TDS rows, signature block, reverse-charge line. | yes, each independently | fully |
| **H'** | Item 7b — `en-GB` dates. **Its own commit.** | yes | fully |
| **I** | Item 8 — print CSS + font/image await. | yes, at any time | fully |

Notes on the ordering that are not obvious from the plan:

- **A and B come before everything and cost nothing.** They are pure modules with tests and
  no call sites. Merging them early means step G is composition rather than invention, and
  it means the mod-36 checksum and the case tables get reviewed on their own, where they
  are readable, instead of inside a 1,500-line diff.
- **C must precede G**, exactly as the plan says: the tax rows must become conditional
  *before* a third tax head exists, or every renderer briefly grows a three-way branch that
  then has to be unwound.
- **D before E before F**: the GSTIN is what makes the profile worth having, and the
  profile is what holds the numbering pattern.
- **F1/F2/F3 must be three deploys, not one.** Creating a unique index in the same release
  that starts populating the fields it indexes is how you get a failed deploy against a
  collection you cannot fix from the app.
- **G is the only step where I would consider a feature flag** — a per-user
  `enablePerLineTax` on the business profile, so the new math is exercised by real invoices
  before it becomes the only path. The `mode:"legacy"` arm of `computeTotals` makes this
  nearly free, since both paths already coexist in the same function.
- **H' alone** because it changes the appearance of every historical invoice; if a user
  complains, you want a one-line revert with nothing else in it.

### Irreversible or hard to roll back

1. **F2's duplicate renumbering.** Changing an issued invoice's number is the only step in
   Phase 2 that alters a document a client already holds. `--dry-run` default, written
   before/after list, human approval, no exceptions.
2. **The unique index (F3), once live.** Dropping it is instant, but any *rejected save*
   between F3 and a rollback is a save the user had to redo. Low severity, non-zero.
3. **Stored derived tax amounts (G).** Once `items[].cgstAmount` etc. are written, they are
   the record of what was issued (D3), and a later bug fix in `splitLineTax` will **not**
   retroactively correct them — by design. That is the right behaviour and it means a bug
   shipped in G is baked into every invoice issued while it was live. Weight the test suite
   accordingly: `splitLineTax` and the apportionment are the two functions where a defect
   is permanent.
4. **The AI contract change (G).** Removing `cgst`/`sgst` from the patch is fine going
   forward, but any *in-flight* conversation state held in a client that has not reloaded
   will emit the old shape. `normalization.ts` drops unknown fields silently already, so
   this degrades to "the model's tax instruction is ignored" rather than a crash — verify
   that with a test rather than assuming it.
5. **Deleting the %/₹ tax toggle (G).** Not technically irreversible, but the toggle is the
   only way a user can currently express a tax amount, and per-line rates must be in place
   in the same deploy or the app has no tax input at all for one release.

### What is genuinely low-risk

Items 7 and 8, and steps A/B, carry no schema risk, no migration and no behaviour change to
existing documents. If Phase 2 has to be cut short, **C + D + F1 + H + I** is a coherent
release: it makes the document lawful for the unregistered majority, adds GSTINs, stops
duplicate numbers being *created* (validation and suggestion, without the index), and
improves the printed sheet — while leaving the IGST rewrite for a later, focused effort.
That is close to the research's own "defensible first release" (`gst-compliance.md:1433`).

---

## What I disagree with in the plan

Seven points. Five are corrections; two are places where the plan is right but the
supporting research is not, and an implementer following the research directly would ship
a defect.

### 1. "`cgst`/`sgst` are `required: true`" is not what forces tax on users

`docs/LAUNCH-PLAN.md:70-71` ("`cgst`/`sgst` are `required: true` and always print as ₹0.00
rows"), echoed by `gst-compliance.md:665` and `:722` ("relax `cgst`/`sgst` from
`required: true` to genuinely optional"), reads as if the schema constraint were part of
the problem. It is not. `models/Invoice.ts:72-73` is
`{ type: Number, required: true, default: 0 }` — a Mongoose `required` validator with a
`default` **can never fail**, because the default is applied before validation. And
`required` is a write-time validator only; it has no effect on reads.

What actually forces the rows onto every document is `lib/invoice-domain.ts:115-116`: two
unconditional entries in `buildTotalsRows`. The `required: true` removal is cosmetic
housekeeping (worth doing for honesty), and an implementer who does it and stops has fixed
nothing. **Keep `default: 0`** while dropping `required` — undefined numbers reaching the
arithmetic buy nothing and cost `??` guards everywhere.

Corollary, and this is the part the plan does not say: **nothing breaks when they become
optional**, because nothing depends on their presence. The only real compatibility question
in item 1 is the one the plan does not raise at all — what `taxTreatment` means for a
document that predates it (§1.4).

### 2. `taxTreatment` cannot be the only thing driving the conditional

`docs/LAUNCH-PLAN.md:80-82` — "one `taxTreatment: "none" | "gst" | "composition"` field,
derived from whether a GSTIN was entered, driving a conditional in `buildTotalsRows`". The
union is fine; "driving a conditional" is where it goes wrong. Three separate things
suppress or reshape tax rows: registration status, supply geography (item 5's export/SEZ
under LUT), and reverse charge (Rule 46(o), which the plan lists as a missing Rule 46
particular at `docs/LAUNCH-PLAN.md:57` but never connects to the totals). A `switch` on
`taxTreatment` inside `buildTotalsRows` gets rewritten twice. Branch on a computed
`TaxPresentation` instead (§1.1).

### 3. Export/SEZ is a second axis, not a fourth enum member

Follows from 2, and matters most for the case the plan is quietest about: an
**unregistered** freelancer invoicing a foreign client. `docs/LAUNCH-PLAN.md:94-97` frames
exports purely as a registered-supplier problem ("must be zero-rated with a verbatim Rule
46 endorsement… and the LUT ARN"). But the ₹20 lakh services threshold
(`gst-compliance.md:628`) means many exporting freelancers have no GSTIN, and printing a
Rule 46 endorsement or an LUT ARN on their invoice would be a false statement. The
`taxTreatment × supplyKind` matrix in §1.2 is the thing to implement; the plan's prose
does not contain it.

### 4. The research's per-component rupee rounding is wrong for the printed invoice

`gst-compliance.md:428-448` reads §170 as requiring each tax component to be rounded to the
nearest rupee **on the invoice**, and `:1396` lists the 2-decimal behaviour as a HIGH gap.
I disagree, and I recommend **tax heads printed at 2 dp with a single Round Off row on the
grand total** (§5.3 step 9).

- §170 governs "the amount of tax, interest, penalty, refund or any other sum **payable**"
  — a return-filing rule about the sum a person pays, not a rule about invoice
  presentation.
- The research contradicts itself here: `:445` says plainly "a 2-decimal tax amount is not
  an offence".
- Rounding a tax head to the rupee while its base is at 2 dp produces an invoice where
  `tax ≠ rate × taxable value`, which is what an auditor or a client's accounts payable
  system actually queries. Tally and Zoho both print tax at 2 dp with one Round Off line.

The research's *ordering* warning at `:448` — never round per line and then sum — is
correct and is preserved: per-line tax at 2 dp, sum per head, round only the grand total.
`roundToRupee` is exported so the maintainer can flip this with one constant if they
disagree.

### 5. A server-side counter for invoice numbers is the wrong mechanism

`docs/LAUNCH-PLAN.md:43` and `:248` both prescribe a "server-side counter". A counter that
increments when a number is *suggested* burns a number on every abandoned draft, producing
**gaps** in a series that Rule 46(b) requires to be consecutive — the same research tells
us to warn about gaps (`gst-compliance.md:1288`). A counter that increments at *save* time
is redundant with the unique index, which is doing the real work. Recommend: suggestion is
a read of the highest number in the FY, the unique index is the guarantee, and a bounded
409-retry resolves races (§4.3).

### 6. Partial vs full unique index — the plan says partial, and partial is wrong

`docs/LAUNCH-PLAN.md:43` says "partial unique index"; `docs/LAUNCH-PLAN.md:249` repeats it.
The research is better here — it raises both and leans full (`gst-compliance.md:1272-1278`).
Because nothing is ever hard-deleted, a partial index filtered on
`{ is_deleted: { $ne: true } }` lets a user soft-delete an invoice and re-issue its number
to a different document, leaving two retained-for-72-months records sharing one serial.
Use a **full** unique index (§4.3).

### 7. "Land item 6 with or immediately after item 5" understates the coupling

`docs/LAUNCH-PLAN.md:254-255`. "Immediately after" implies item 5 can ship a working
invoice-level IGST that item 6 then converts to per-line. That intermediate state means
writing the money formula twice, migrating the schema twice, and shipping an invoice-level
IGST amount into production documents that then has to be reconciled with per-line
amounts. Items 5 and 6 are **one change set in `lib/invoice-domain.ts`** (§5). The UI can
be staged; the domain layer cannot.

### Two smaller notes

- `docs/LAUNCH-PROGRESS.md` shows "InvoiceModal through `resolveRecordAmounts` +
  `buildTotalsRows`" as not started, but `components/InvoiceModal.tsx:53` already does
  exactly that. The progress file is stale, and the fact matters for Phase 2, because it
  means there are **three** renderers inheriting `buildTotalsRows`, not two.
- The research's `splitLineTax` sketch (`gst-compliance.md:322`) references an undefined
  `withPayment` identifier. Copying it verbatim will not compile — and if someone "fixes"
  it by reading a module-scope variable, exports under LUT will silently charge IGST.

### Where the plan is right and I want to say so

- The dependency claim at `docs/LAUNCH-PLAN.md:238-239` — "`taxTreatment` must land before
  IGST, because the tax rows have to become conditional before a third tax is added to
  them" — is exactly right and is the load-bearing insight of the whole phase.
- "Rows render CGST+SGST **or** CGST+UTGST **or** IGST — never all three with zeros"
  (`:252-253`) is right, and the reason given (zero rows read as a red flag to an auditor)
  is the same reason the ₹0.00 rows have to go for unregistered users. One mechanism
  solves both.
- Refusing to build e-invoicing/IRN (`docs/LAUNCH-PLAN.md:110-119`) is correct and should
  not be revisited.

---

## Open questions I could not settle from the available evidence

1. **`convenienceCharge` and the tax base.** §15(2)(c) suggests a service charge is part of
   the value of supply and therefore taxable. The research does not address the field at
   all. I have kept it post-tax (today's behaviour) and recommend retiring it into a line
   item; a maintainer decision is needed (§5.4).
2. **Composition + export/SEZ** is blocked in my design by inference from the inter-State
   restriction, not from a cited source (§1.2).
3. **Whether "96" is an official place-of-supply code** for Other Country — the research
   marks it UNVERIFIED (`gst-compliance.md:921`, `:1481`). Used here as an internal
   sentinel only, never printed.
4. **Composition rates under GST 2.0** (1% / 5% / 6%) are UNVERIFIED
   (`gst-compliance.md:686`). Not needed by this design — a composition invoice shows no
   tax at all — but do not build a composition rate picker on them.
5. **Whether any rate notification changed the slabs between Sep 2025 and Aug 2026**
   (`gst-compliance.md:1483`). `lib/gst-rates.ts` carries a `lastVerified` date so this is
   cheap to re-check; it should be re-checked before launch.
6. **Whether `tests/` can control `TZ`** for the financial-year boundary tests under Bun's
   runner. If not, the string-parsing path is still fully testable and the `Date` path
   should be asserted with explicit UTC instants (§4.6).
