# Phase 1 — Legal to open signups: design & research

**Status: DESIGN DOCUMENT. Nothing here has been implemented.** This is the
research and specification pass for the "Phase 1 — Legal to open signups"
section of `docs/LAUNCH-PLAN.md`. No file in `/home/faran/projects/invoicey`
was modified to produce it.

**This is not legal advice.** The policy and terms text drafted in §2.6 and §2.7
is a *starting draft written by an engineer* for the owner to review with a
lawyer before publishing. It is written to be accurate about what the code
actually does — which is the part a lawyer cannot supply — not to be a
defensible legal instrument on its own.

Two conventions used throughout:

- **CODE** — work that can be done in the repo by an agent or the maintainer.
- **OWNER ACTION** — work that requires a console, a billing relationship, a
  domain, a mailbox, or a signature. An agent cannot do these and must not
  pretend to. They are collected in one checklist in §7.

Scope note: Phase 0 is still in flight (`docs/LAUNCH-PROGRESS.md` shows it
unchecked, though `next.config.ts` already carries the security headers, so
other agents are landing work concurrently). This document assumes Phase 0
lands first, and calls out the two places where it depends on a Phase 0 item.

---

## 1. What the law actually requires, verified

Every date and duty below was checked against current sources in August 2026,
not recalled. Sources are listed at the end of this section.

### 1.1 DPDP Act 2023 — notified, but substantive duties bite on 2027-05-13

Confirmed, and the launch plan's date is correct:

- The **Digital Personal Data Protection Rules, 2025 were notified by MeitY on
  2025-11-14**. So the answer to "have the Rules since been notified" is **yes** —
  the plan and `prod-readiness.md` §8.2 both marked this UNVERIFIED; it is now
  verified and settled.
- Enforcement is **phased in three steps**:
  - **2025-11-13** — the Data Protection Board, the definitions, and the
    rule-making machinery came into force. No direct compliance burden.
  - **2026-11-13** — the Consent Manager registration framework opens.
    (Invoicey is not a Consent Manager. Not applicable.)
  - **2027-05-13** — **full substantive compliance becomes enforceable.** Notice,
    consent, Data Principal rights (access / correction / erasure / grievance /
    nomination), retention limits, security safeguards and breach reporting are
    all live from this date.
- **Section 44(2) of the DPDP Act is notified to take effect 2027-05-13**, which
  is the date **IT Act s.43A and the SPDI Rules 2011 stand omitted**.

**The operative consequence for a launch in 2026:** DPDP is not yet
*enforceable* against Invoicey, but the SPDI Rules **are**, and they do not stop
being enforceable until DPDP's do start. There is no gap and no grace window in
which nothing applies. Designing to DPDP now is the cheap move — it satisfies
SPDI as a strict subset and avoids a second pass before May 2027.

### 1.2 SPDI Rules 2011 — binding *today*

Under IT Act s.43A, a "body corporate" handling sensitive personal data or
information must:

- **Publish a privacy policy on its website**, stating the types of information
  collected, the purpose of collection and usage, the disclosure policy, and the
  reasonable security practices in place. This is Rule 4 and it is a *publication*
  duty, not a "have one on file" duty.
- **Name a Grievance Officer, publish that officer's contact details on the
  website, and redress grievances within ONE MONTH of receipt.** This is Rule 5(9).

Note the asymmetry that matters for drafting: **SPDI's one month is stricter
than DPDP's ninety days.** Until 2027-05-13, the binding SLA is one month. The
draft policy therefore commits to a shorter window than DPDP would require —
deliberately, because committing to ninety days now would be non-compliant with
the rule that is actually in force.

Whether Invoicey is a "body corporate" (the term covers a firm, sole
proprietorship or association of individuals engaged in commercial or
professional activities) is an **OWNER ACTION** question tied to whether the
maintainer registers an entity. Assume yes; the cost of assuming yes is one page.

### 1.3 DPDP duties Invoicey will owe from 2027-05-13

Invoicey is a **Data Fiduciary**. Concretely:

| Duty | Source | What it means here |
|---|---|---|
| Itemised notice at/before collection | s.5, Rule 3 | A privacy notice presented at signup, in plain language, itemising each category and purpose — not a link buried in a footer |
| Right to access | s.11 | The bulk export in §3 |
| Right to correction & erasure | s.12 | Editing already exists; erasure is §3 |
| Right of grievance redressal | s.13, Rule 14(3) | Named contact + **response within a reasonable period not exceeding 90 days** |
| Right to nominate | s.14 | Must be *disclosed*; a functional nominee flow is not a launch blocker for a solo product, but the policy must say how to exercise it (email the grievance contact) |
| Erasure when purpose is served | s.8(7) | **Unless retention is required by law** — this is the hinge for §3.2 |
| Breach intimation | Rule 7 | Affected Data Principals **without delay**; a preliminary report to the Board **without delay**, and a **detailed report within 72 hours** |
| Publish a contact | Rule 3 / Rule 14 | A non-SDF must publish the business contact of the person who can answer questions about processing. A formal **DPO is only required of a Significant Data Fiduciary** — Invoicey is not one |

**Third Schedule retention caps do NOT apply.** The 3-year hard cap applies to
e-commerce (2 crore+ users), social media (2 crore+ users) and online gaming
(50 lakh+ users). Invoicey is none of these and is orders of magnitude below any
threshold. Outside those classes retention is purpose-bound: keep while the
purpose lasts, erase when it ends. That is the rule Invoicey lives under.

### 1.4 CGST s.36 — 72 months, and *who* it binds

CGST Act s.36 requires **every registered person** to retain the books and
records required by s.35(1) for **72 months from the due date of furnishing the
annual return** for the relevant financial year — extended to one year after
final disposal of any appeal, revision, proceeding or investigation, whichever
is later.

**Read the subject of the sentence.** The duty is on the *registered person* —
the user, who is the taxpayer — not on the software that helped them typeset the
document. Invoicey is not a registered person in respect of its users' supplies,
does not file their returns, and is not their books of account. This is the fact
that resolves the conflict in §3.2, and it is worth stating precisely because
getting it backwards would justify never deleting anything.

### 1.5 Google OAuth — the launch plan's claim, corrected

The plan says: "a published consent screen requires a privacy-policy URL,
without which sign-in is capped at the unverified-app screen and 100 users."
That is **directionally right but imprecise**, and the imprecision matters for
sequencing. What is actually true as of August 2026:

- Invoicey's Google sign-in goes through Firebase Auth and requests only
  **non-sensitive scopes** (`email`, `profile`, `openid`). The **OAuth user cap
  and the sensitive-scope unverified-app screen apply to *sensitive/restricted*
  scopes**, so those specific mechanics are not what gates Invoicey.
- The gate that *does* apply is **brand verification**. It is required when an
  app is **External + Published** *and* **displays a logo or display name on the
  consent screen** — which Invoicey does. Google states this "applies regardless
  of scope sensitivity."
- Brand verification requires exactly three things: a **publicly accessible
  homepage URL** relevant to the app; a **privacy policy URL disclosing how the
  app accesses, uses, stores and shares Google user data, hosted on the same
  domain as the homepage**; and **domain ownership verified in Google Search
  Console** for every authorized domain (homepage, privacy policy, redirect
  URIs).
- Separately, an app left in **Testing** audience is capped at **100 test users**,
  and their grants expire after 7 days (basic profile/email scopes are exempt
  from the 7-day expiry). Publishing removes that.

**Net for this project:** the privacy policy is a hard prerequisite for Google
sign-in at any real scale, and it must live on the **same domain as the app** —
so it is a page in this Next app at `/privacy`, not a Notion doc or a Google
Doc. Failing brand verification does not merely look bad; it holds the project
in Testing, at 100 users. It also means **the custom domain must be settled
before verification is submitted**, because the privacy policy URL and the
homepage URL have to share it and both have to be verified in Search Console.

### 1.6 Gemini data use — the disclosure that cannot be omitted

Confirmed from Google's own Gemini API Additional Terms:

- **Unpaid (free-tier) services:** content submitted, *and the generated
  responses*, may be used to "provide, improve, and develop Google products and
  services", **human reviewers may read it**, and Google explicitly instructs:
  *"Do not submit sensitive, confidential, or personal information to the Unpaid
  Services."*
- **Paid services:** prompts (including system instructions, cached content and
  files) and responses are **not** used to improve Google's products; retention
  is short and for safety/compliance only, under a data-processor agreement.

And what Invoicey actually sends: `lib/ai/invoice-assistant/prompt.ts:83-105`
serialises the **entire draft** into the user prompt — `serializeDraft` spreads
`...draft`, which is an `InvoiceFormState` and therefore includes `billTo`,
`billToEmail`, `billToAddress`, `companyEmail`, `companyPhone`, every line item
description and every amount. Those are **the user's clients' names, email
addresses, postal addresses and commercial terms** — third parties who have no
account and have consented to nothing.

So on a free key, Invoicey is doing precisely the thing Google's terms tell it
not to do, with data belonging to people who were never asked. **Moving to a paid
Gemini key is a Phase 0 item and a hard prerequisite for the privacy policy in
§2 being truthful.** A policy that omits this is false; a policy that discloses
it while still on a free key is truthful but describes an indefensible practice.

### Sources

- [DPDP Rules 2025 notification and 18-month timeline — Shardul Amarchand Mangaldas](https://www.amsshardul.com/insight/enforcement-of-the-dpdp-act-and-notification-of-the-dpdp-rules/)
- [DPDP Rules, 2025 Notified — PIB](https://static.pib.gov.in/WriteReadData/specificdocs/documents/2025/nov/doc20251117695301.pdf)
- [India's DPDP regime takes effect; s.44(2) and s.43A omission from 13.05.2027 — S&R Associates](https://www.snrlaw.in/indias-digital-personal-data-protection-regime-takes-effect/)
- [Are the SPDI Rules still in force after the DPDP Act — Opsio](https://opsiocloud.com/in/knowledge-base/are-spdi-rules-still-in-force/)
- [SPDI Rules 2011: privacy policy publication + grievance officer + one-month redressal — Singhania & Co](https://singhania.in/blog/spdi-rules-2011-taking-a-step-towards-securing-data)
- [Rule 14 — Rights of Data Principals, 90-day grievance response](https://www.dpdpa.com/dpdparules/rule14.html)
- [Rule 7 — Intimation of Personal Data Breach, 72-hour detailed report](https://www.dpdpa.com/dpdparules/rule7.html)
- [DPDP s.8 general obligations of a Data Fiduciary, incl. 8(7) erasure](https://www.dpdpa.com/dpdpa2023/chapter-2/section8.html)
- [DPDP Rules Third Schedule retention thresholds — MediaNama](https://www.medianama.com/2025/11/223-dpdp-rules-2025-data-fiduciary-obligations/)
- [CGST Act s.36 — period of retention of accounts (CBIC)](https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_CGST_act/active/chapter8/section36_v1.00.html)
- [Google — Brand verification requirements](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)
- [Google — When is verification not needed](https://support.google.com/cloud/answer/13464323?hl=en)
- [Google — Manage App Audience (Testing vs In production, 100 test users)](https://support.google.com/cloud/answer/15549945?hl=en)
- [Gemini API Additional Terms of Service — paid vs unpaid data use](https://ai.google.dev/gemini-api/terms)

---

## 2. Privacy policy, terms of service, named grievance contact

### 2.1 What this app actually collects — read out of the code

Nothing below is inferred from what an invoicing app "probably" does. Each row
was read from the schema or the route that writes it.

**A. Identity, held by Firebase Auth (Google LLC)**

Firebase holds the authoritative account: email address, display name, photo
URL, sign-in provider, `email_verified` flag, uid, and — for password accounts —
the password verifier. The app never sees a password. Source: `lib/firebase.ts`,
`lib/server/auth.ts`, `lib/auth-user-sync.ts`.

**B. The user profile, in MongoDB — `models/User.ts`**

`uid`, `email`, `name`, `avatar` (URL), `providerIds[]`, `lastLoginAt`,
`createdAt`, `role`, `status`, `updatedAt`.

> Phase 0 removes `accessToken` / `refreshToken` from this document. **This
> design assumes that has landed.** If it has not, the privacy policy would have
> to disclose that the app stores a non-expiring Firebase refresh token in its
> database, which is not a sentence anyone should have to publish. Sequencing
> dependency, not a suggestion.

**C. The invoices, in MongoDB — `models/Invoice.ts`. This is the sensitive part.**

Two distinct kinds of personal data live in one document:

- *The user's own* business details: `companyName`, `companyEmail`,
  `companyPhone`, `companyAddress`, `companyLogo`, and `paymentInfo` — a free
  text field into which users will put **bank account numbers, IFSC codes and
  UPI IDs**, because that is what it is for.
- *Their client's* details: **`billTo`, `billToEmail`, `billToAddress`** — plus
  every `items[].name` (which describes the work done for that client) and every
  amount. These belong to **a third party who has no account with Invoicey, has
  never seen a notice, and has consented to nothing.**

That second category is the fact that raises Invoicey's obligations above those
of a typical B2C app, and the policy has to say out loud who is responsible for
it. The honest framing, and the one the code supports: **the user is the
controller of their clients' data; Invoicey processes it on their instruction.**
Invoicey's own duty is to hold it securely, not use it for anything else, and
delete it when told.

Also: `is_deleted: true` documents persist forever today. Every read filters
`is_deleted: { $ne: true }` (`app/api/invoices/route.ts:183`, `:194`), but the
admin surface can read them back (`includeDeleted=true`) and the admin CSV
export emits an `is_deleted` column (`app/api/admin/export/invoices/route.ts:29`
queries `{}`). **A policy that says "deleted means deleted" would be false as the
code stands.** §3 fixes this; until it does, the policy must describe the recycle
bin accurately.

**D. Feedback — `models/Feedback.ts`**

`userId`, free-text `message`, optional `rating`, `category`, `page`,
`createdAt`. Free text, so it can contain anything the user types.

**E. Telemetry — `models/LogEntry.ts`, written by `lib/server/log.ts`**

Every entry carries `at`, `level`, `category`, `event`, `userId`, `message`,
`meta`, `requestId`, `ip`, `userAgent`, `expireAt`. So **IP address and
user-agent are collected and stored against a user id** — that is personal data
and must be disclosed by name.

`meta` is redacted before write: keys matching
`/token|secret|authorization|password|api[_-]?key|refresh|access|cookie|jwt/i`
become `[REDACTED]`, any string containing `key=` becomes `[REDACTED]`, strings
are capped at 16 000 chars and the whole object at 32 KB
(`lib/server/log.ts:44-107`). That is genuinely careful. It is **not** a
personal-data filter, though: `meta` routinely carries `invoiceId`, `amount`,
`currency`, and on errors a full `stack`.

Retention is already differentiated and enforced by a per-document TTL index
(`computeExpireAt`, `lib/server/log.ts:33-42`):

| Kind of log | Retention |
|---|---|
| `level: "error"` (includes stack traces) | **365 days** |
| `category: "admin"` (audit trail) | **365 days** |
| `level: "warn"` | 90 days |
| `category: "ai"` or `"client"` | 30 days |
| `level: "info"` + `category: "auth"` or `"invoice"` | 180 days |
| everything else | 30 days |

These are real, working numbers. **Publish them verbatim** — a retention table a
reader can check against behaviour is worth more than a paragraph of "as long as
necessary".

**F. Cookies and local storage — `modules/UserSessionManager.ts`**

Cookies: `session-token`, `session-id` (both `secure`, `sameSite: Strict`, both
set by `js-cookie` so neither is `httpOnly`). Local storage: `username`,
`user-id`, `user`. The constructor now purges the legacy `access-token` /
`refresh-token` cookies on every instantiation (`LEGACY_TOKEN_KEYS`), which is
the right call and worth a line in the policy's history.

Firebase's own SDK separately persists a session in IndexedDB.

**G. Third-party scripts on every page — `app/layout.tsx`**

`@vercel/analytics` and `@vercel/speed-insights` load on every route, including
marketing pages seen by logged-out visitors.

### 2.2 Every processor, named

A privacy policy has to name these. This is the complete list as the code stands
today, plus the two that Phase 1 adds.

| Processor | What reaches it | Where processed | Notes |
|---|---|---|---|
| **Google LLC — Firebase Auth** | Email, name, avatar URL, provider, password verifier, sign-in IPs | Google's global infrastructure, primarily US | The authoritative identity store |
| **Google LLC — Gemini API** (`generativelanguage.googleapis.com`) | **The entire invoice draft**, serialised: client name, client email, client address, line-item descriptions, all amounts, plus the last 10 turns of conversation | Google's global infrastructure | **The disclosure that matters.** See §1.6. On a free key, human-reviewable and used for product improvement |
| **MongoDB Inc. — Atlas** | Everything in §2.1 B–E | Whichever cloud region the M0 cluster sits in — **OWNER ACTION to confirm; it must be stated in the policy** | Currently M0, which has **no backups** |
| **Vercel Inc.** | All HTTP traffic; function execution; runtime logs; Analytics + Speed Insights page events | Functions run in Vercel's **default region unless pinned** — `vercel.json` sets no `regions`, so today that is `iad1` (Washington DC), i.e. **US**, not India | Pinning `["bom1"]` is a separate Phase-2-ish perf item but it also changes the transfer story the policy must tell |
| **Cloudflare, Inc. — R2** | Nightly full database dump (i.e. all of the above) | Bucket region chosen at creation — **OWNER ACTION** | New in §4 |
| **Functional Software, Inc. (Sentry)** | Error events: stack traces, request route, user id | US or EU region, chosen at project creation — **OWNER ACTION** | New in §5. Must be configured *not* to carry invoice data — see §5.4 |
| **GitHub, Inc.** | Runs the backup workflow; holds the Atlas and R2 credentials as secrets | US | New in §4 |

Cross-border transfer: DPDP s.16 works as a **blocklist** — transfers are
permitted except to countries the Central Government notifies as restricted.
**No such notification has been issued.** So these transfers are lawful today;
they still have to be *disclosed*, and the policy should name the countries.

### 2.3 Files to create — CODE

| Path | What |
|---|---|
| `app/privacy/page.tsx` | The privacy policy page. Server component, no `"use client"` needed — it is static text |
| `app/terms/page.tsx` | Terms of service |
| `lib/legal.ts` | One module exporting `LEGAL_CONTACT` (`{ grievanceOfficer, email, postalAddress, lastUpdated, entityName }`) and the retention table as data. **Both pages and `/contact` import it.** The point is that the grievance email appears in exactly one place in the source, so it cannot drift between three pages |
| `components/ui/footer.tsx` | **Modify.** Currently 10 lines with zero links. Add Privacy / Terms / Contact. Required: SPDI Rule 4 is a *publication* duty and a policy nobody can reach from the app is not published |
| `app/contact/page.tsx` | **Modify.** See §6 |
| `public/.well-known/security.txt` | RFC 9116 security contact. Cheap, and it is the channel a researcher uses instead of a public tweet |

Deliberately **not** building a cookie consent banner. Reasoning: the app's own
two cookies are strictly functional (session), and Vercel Analytics is
cookieless. DPDP has no separate cookie-consent regime — it has a notice regime,
which the privacy policy and the signup notice satisfy. A banner would be
cargo-culted from GDPR, would violate `PRODUCT.md` principle 2 ("nothing between
sign-in and the first invoice"), and would buy nothing. **Disclose the cookies in
the policy; do not interrupt anyone.** If the maintainer later adds a non-Vercel
analytics tool that sets cookies, revisit.

One in-product disclosure **is** worth the interruption, and it is not a banner:
a single line of copy at the AI panel in `components/InvoiceEditor.tsx` saying
the draft is sent to Google Gemini, with a link to the policy section. That is
the one place a user would be genuinely surprised, and surprise is the test.
Size: one `<p>`.

### 2.4 The named grievance contact — what it has to be

Both regimes want a *person*, not a form.

- **SPDI Rule 5(9):** name and contact details of a Grievance Officer published
  on the website; grievances redressed **within one month**.
- **DPDP Rule 14(3):** a working grievance-redressal mechanism, response within
  **a reasonable period not exceeding ninety days**; and the published business
  contact of the person who can answer questions about processing. A formal DPO
  is required only of a **Significant Data Fiduciary**, which Invoicey is not.

**Design decision: publish one named human, one role address, one SLA, and make
the SLA the stricter of the two (one month / 30 days).** Do not publish two
different response times for two different laws; nobody reading it cares, and
the shorter one is the one in force.

The name must be a real person — realistically the maintainer, since
`PRODUCT.md` is explicit that there is no team and that inventing one is "the
one unrecoverable mistake". "Grievance Officer: Faran Mohammad" on a solo
project is honest and adequate. A fictitious "Privacy Team" is not.

The address must be a **role mailbox on the app's own domain**
(`privacy@<domain>`), not a personal Gmail and not a social DM — see §6.

### 2.5 OWNER ACTION for §2

1. Decide and record the **legal entity**: sole proprietorship in the
   maintainer's name, or a registered company. This determines the name on both
   documents and the governing-law clause. It is the one input an agent cannot
   invent.
2. Provide a **postal address** for the entity. SPDI/DPDP contact requirements
   and Google's brand verification both expect a real, reachable contact; a
   privacy policy with no address reads as anonymous.
3. Confirm the **MongoDB Atlas cluster's cloud region**, and Sentry's and R2's
   regions once created. The policy names countries; guessing is not an option.
4. Register/confirm the **custom domain**, and **verify it in Google Search
   Console** — required for OAuth brand verification (§1.5).
5. Provision `privacy@` and `support@` on that domain (§6).
6. **Have a lawyer read both documents before publishing.** Particularly the
   limitation-of-liability and governing-law clauses in the terms, and the
   controller/processor framing of clients' data in §2.1(C) — that framing is
   the load-bearing legal claim in the whole policy and it is one an engineer
   should not make unassisted.
7. Move to a **paid Gemini key** (already a Phase 0 owner action) — §1.6. The
   policy's AI section is written assuming this has happened; if it has not, the
   bracketed alternative paragraph has to be used instead, and it is not a
   paragraph anyone wants to publish.

---

### 2.6 DRAFT — Privacy Policy

> **DRAFT FOR THE OWNER TO REVIEW. NOT LEGAL ADVICE.** Written by an engineer
> from a read of the source, so that the *facts* are right. The *law* still needs
> a lawyer. Square brackets are inputs only the owner can supply. The paragraph
> marked FREE-KEY ALTERNATIVE is what this section would have to say if the
> Gemini key is still on the free tier at launch.

---

**Privacy Policy**

Last updated: [DATE]

Invoicey is run by [ENTITY NAME] ("we", "us"), based at [POSTAL ADDRESS], India.
This page explains what we collect, why, who else sees it, how long we keep it,
and how to make us delete it. It is written to be read, not to be survived.

**The short version**

You sign in, you type invoices, we store them so you can come back to them. If
you use the AI assistant, the draft you are working on is sent to Google to be
turned into fields. We do not sell anything, we do not advertise, and we do not
share your invoices with anyone except the service providers listed below that
we need in order to run the product. You can export everything and delete
everything, from inside the app, at any time.

**Who is responsible for what**

Your invoices contain your clients' names, addresses and email addresses. Those
people are not our users and have never heard of us. **You decide what goes into
an invoice; we just store and process it for you.** In data-protection terms you
are the one responsible for that information, and we handle it on your
instructions. Our job is to keep it secure, not use it for anything else, and
delete it when you tell us to.

**What we collect**

*Your account.* Email address, display name, profile picture URL, and which
sign-in method you used (Google, or email and password). This is held by Firebase
Authentication, which is operated by Google. If you use a password, Google holds
it — we never see it. We keep a copy of your email, name, picture URL, sign-in
methods, account creation date and last sign-in date in our own database.

*Your invoices.* Everything you type into one: your business name, address,
email, phone and logo URL; your client's name, address and email; line items,
descriptions and amounts; dates, currency, tax amounts, notes, terms, and the
payment details you choose to print on the invoice. **The payment-details field
is free text — if you type a bank account number or UPI ID there, we store it as
typed.** We do not verify it, use it, or send anything to it. Invoicey never
takes payments and never sends your invoices anywhere; it produces files that you
send yourself.

*Feedback.* If you send feedback, we store your message, an optional rating, the
category and which page you were on.

*Technical logs.* We record events like sign-ins, invoice creation, errors and
AI requests. Each entry can include your user id, **your IP address**, your
browser's user-agent string, and context such as an invoice id, an amount, or —
for errors — a stack trace. Secrets and anything that looks like a token or key
are stripped out automatically before an entry is written.

*Cookies and browser storage.* We set two cookies (`session-token`,
`session-id`) and store your display name, user id and basic profile in your
browser's local storage, so you stay signed in. Firebase stores its own sign-in
session in your browser. We do not use advertising or tracking cookies. We also
run Vercel Analytics and Vercel Speed Insights on our pages to count page views
and measure loading speed; these are cookieless and do not build a profile of
you. Your theme preference is stored locally under `invoicey-theme`.

**The AI assistant, in detail**

This is the part people are most likely to be surprised by, so it gets its own
section.

When you use the AI assistant to draft an invoice, **the whole draft you are
currently working on is sent to Google's Gemini API**, along with your message
and the recent conversation. That includes your client's name, email address and
postal address, your line-item descriptions, and the amounts. It has to be — that
is what lets the assistant fill in the right fields.

We use Gemini on a **paid Google plan**. Under Google's paid API terms, prompts
and responses are **not** used to improve Google's products, and are retained
only briefly for security and legal-compliance purposes.

The assistant never writes to your saved invoices. It hands a suggested set of
changes back to your browser, you review them, and nothing is stored until you
press Save. If you never open the AI panel, nothing is ever sent to Google's AI
service.

> **[FREE-KEY ALTERNATIVE — use only if still on a free Gemini key, and read
> what it says before shipping it]** We currently use Gemini on Google's free
> tier. Under Google's terms for the free tier, the content sent and the
> responses produced **may be used by Google to improve its products, and may be
> reviewed by humans**. That means your clients' details, as included in a draft
> you send to the assistant, may be read by Google reviewers. If that is not
> acceptable to you, do not use the AI assistant. We are moving to the paid tier,
> under which this does not apply.

**Who else sees your data**

| Who | What they get | Where |
|---|---|---|
| Google (Firebase Authentication) | Your email, name, profile picture, sign-in method and sign-in activity | Google's global infrastructure, mainly the United States |
| Google (Gemini API) | The invoice draft you send to the AI assistant, only when you use it | Google's global infrastructure |
| MongoDB Atlas | Your account record, invoices, feedback and logs | [ATLAS REGION] |
| Vercel | Hosting, request handling, and the analytics described above | [VERCEL FUNCTION REGION] |
| Cloudflare R2 | Encrypted nightly backups of the database | [R2 REGION] |
| Sentry | Error reports: what broke and where. Configured to exclude invoice contents and client details | [SENTRY REGION] |
| GitHub | Runs our backup job; holds no personal data itself | United States |

We do not sell personal data, we do not share it for advertising, and we do not
give it to anyone else except where the law requires it.

**How long we keep things**

- **Your account and invoices:** until you delete them. Deleting your account
  removes them (see below).
- **A deleted invoice:** it goes to a recycle bin for **30 days**, so you can
  recover it if you deleted it by mistake, and is then permanently removed.
  During those 30 days it is not visible in your dashboard but it still exists.
- **Logs:** error logs and administrative audit records, **365 days**; warnings,
  **90 days**; sign-in and invoice activity, **180 days**; AI-assistant and
  in-browser events, **30 days**; everything else, **30 days**. These are
  enforced automatically by the database, not by hand.
- **Backups:** nightly snapshots kept for **30 days**, then destroyed. If you
  delete your account, your data is gone from the live database immediately but
  may persist in backups until those backups age out.
- **Feedback:** kept while the product exists, because it is how we decide what
  to build. Tell us if you want yours removed.

**Your rights, and how to actually use them**

- **See what we hold.** Account → Export my data. You get one JSON file with your
  profile, every invoice including deleted ones, and your feedback.
- **Correct it.** Edit any invoice in the app. For your name or email, change it
  with your sign-in provider.
- **Delete it.** Account → Delete my account. This is described in detail on that
  screen. It removes your invoices, your feedback and your account record, and
  deletes your sign-in account with Firebase.
- **Complain.** Contact our Grievance Officer, below. If you are not satisfied,
  you can complain to the Data Protection Board of India.
- **Nominate someone.** You can nominate a person to exercise these rights on
  your behalf if you die or become incapable of exercising them yourself. We do
  not have a form for this yet — email the Grievance Officer and we will handle
  it manually.

**Grievance Officer**

[GRIEVANCE OFFICER NAME]
[GRIEVANCE EMAIL, e.g. privacy@invoicey.app]
[POSTAL ADDRESS]

**We respond to privacy grievances within 30 days.** If we need longer we will
tell you why, before the 30 days is up.

**Security**

Access to your data requires a verified sign-in; every request is checked against
the identity of the signed-in user and scoped to that user's records. Traffic is
served over HTTPS with HSTS. Data is encrypted in transit and at rest by our
hosting providers. Nightly backups are stored encrypted in a private bucket.

We are a small operation and we will not claim more than that: there is no
SOC 2 report, no external audit and no security team. If you find a
vulnerability, please email [SECURITY EMAIL] — we would much rather hear it from
you.

**If something goes wrong**

If personal data is breached, we will tell affected users without delay,
describing what happened, what was exposed, and what to do about it, and we will
report it to the Data Protection Board of India as required.

**Children**

Invoicey is for people running a business and is not intended for anyone under
18. We do not knowingly collect data from children.

**Changes**

If we change this policy in a way that affects you, we will say so in the app
before it takes effect, not quietly edit this page. The date at the top always
reflects the current version.

---

### 2.7 DRAFT — Terms of Service

> **DRAFT FOR THE OWNER TO REVIEW. NOT LEGAL ADVICE.** The limitation of
> liability and governing law clauses in particular need a lawyer's eyes.

---

**Terms of Service**

Last updated: [DATE]

These terms cover your use of Invoicey, a web app operated by [ENTITY NAME],
[POSTAL ADDRESS], India. Using it means you accept them.

**What Invoicey is**

A tool for creating, editing, tracking and exporting invoices. That is the whole
scope. It is deliberately not accounting software.

**What Invoicey is not, and will not do for you**

- It does not send invoices. It produces files — PDF, HTML, CSV, JSON — which
  you send yourself, however you like.
- It does not take payments, process payments, or track them. A "paid" status is
  a label you set; nothing behind it talks to a bank.
- It does not issue reminders.
- **It is not tax advice.** Invoicey will print whatever tax figures you enter.
  Whether an invoice is correct under GST — the right treatment, the right rate,
  a valid GSTIN, the right invoice number series, whether you are entitled to
  charge tax at all — **is your responsibility, and we do not check any of it.**
  If in doubt, ask your accountant.
- It does not keep your statutory records for you. If you are registered under
  GST you are required to retain your books and records for 72 months. Invoicey
  is a tool you used to make a document; it is not your books of account. Export
  your invoices and keep them somewhere you control.

**The price**

Invoicey is free. There is no paid tier, no trial, no invoice limit and no
feature that is withheld from you. If the day comes when this cannot continue,
we will say so plainly and give you time to export everything — we will not
quietly switch off features you were relying on. There is a Buy Me a Coffee link
if you want to support the work; it buys you nothing extra and it is not a
subscription.

**Your account**

You need a verified email to use it. One person, one account — there are no
teams, roles or shared workspaces. Keep your sign-in secure; anything done
through your account is treated as done by you.

**Your content**

Your invoices are yours. We claim no ownership of them. You grant us only the
permission needed to store, display and export them for you, and to send a draft
to Google's Gemini API when you choose to use the AI assistant.

You are responsible for what you put in. That includes making sure you are
entitled to store your clients' details, and that anything you upload or link to
— a logo URL, for instance — is yours to use.

**Things you must not do**

Use Invoicey to create fraudulent, misleading or unlawful documents. Invoice
people who are not your customers. Attempt to reach other users' data. Automate
against the app to a degree that degrades it for others, or run scripted loops
against the AI assistant. Attempt to break, probe or overload the service, other
than a good-faith security report to the address in our privacy policy.

We may suspend an account that does these things. If we do, you can still ask for
an export of your data.

**The AI assistant**

It guesses. It will sometimes guess wrong — wrong amounts, wrong dates, invented
detail. It never saves anything by itself: it proposes changes, you review them,
you press Save. **Check the numbers before you send an invoice to a client.** We
are not responsible for an invoice you sent without reading it.

**Availability**

This is a small, free service run by one person. There is no uptime guarantee,
no support SLA beyond the grievance timeline in our privacy policy, and
maintenance may happen without notice. We back the database up nightly, but you
should keep your own copies — the export button exists for exactly this reason.

**Ending it**

You can delete your account at any time from inside the app; see our privacy
policy for what that removes. We may close an account that breaches these terms,
or discontinue the service entirely — in which case we will give reasonable
notice and a window to export.

**No warranty**

Invoicey is provided "as is". To the extent the law allows, we make no warranty
that it will be uninterrupted, error-free, or fit for any particular purpose,
including any tax or legal purpose.

**Limitation of liability**

To the extent the law allows, we are not liable for indirect or consequential
loss, lost profit, lost business or lost data arising from your use of Invoicey.
Where liability cannot be excluded, it is limited to [AMOUNT — the service is
free, so the conventional cap is a nominal sum such as INR 1,000; a lawyer should
set this].

Nothing here limits liability that cannot be limited by law.

**Governing law**

These terms are governed by the laws of India, and the courts at [CITY], India
have exclusive jurisdiction.

**Changes**

If we change these terms materially, we will tell you in the app before the
change takes effect.

**Contact**

[SUPPORT EMAIL] · [POSTAL ADDRESS]

---

## 3. Account deletion + bulk data export

### 3.1 The architectural conflict, stated before it is resolved

`CLAUDE.md` and `PRODUCT.md` both say it: **"Nothing is ever hard-deleted."**
`PRODUCT.md` goes further and makes it a product constraint — *"No UI may promise
permanent removal, purging, or unrecoverable deletion."* There is no `DELETE`
handler anywhere in `app/api/`; deletion is `PATCH { action: "soft_delete" }`
setting `is_deleted: true` (`app/api/invoices/route.ts:378-386`), and every read
filters it out.

A right of erasure requires a UI that promises exactly what the charter forbids.
These cannot both hold.

**This is a charter amendment, and it is an OWNER decision, not an agent's.** An
agent implementing account deletion is contradicting `PRODUCT.md` in writing, and
should not do so silently. The amendment needed is narrow and does not gut the
constraint:

> *Proposed `PRODUCT.md` amendment.* "Nothing is ever hard-deleted" governs the
> **invoice** lifecycle: deleting an invoice is a soft delete and the UI must not
> promise otherwise. **Account deletion is a separate, explicitly irreversible
> action** which permanently destroys the account and all of its invoices,
> including soft-deleted ones. It is the only surface in the product allowed to
> promise unrecoverable deletion, and it must promise it clearly.

Everything below assumes that amendment is accepted. If it is not, Phase 1 cannot
ship item 2, and the product cannot be DPDP-compliant by 2027-05-13.

### 3.2 Erasure vs. the 72-month GST retention — resolved

This is the sharpest question in Phase 1 and it deserves a direct answer rather
than a hedge.

**The conflict as commonly stated:** CGST s.36 requires 72 months of retention;
DPDP s.12 gives a right of erasure; therefore an invoicing app must refuse to
delete for six years. **That reasoning is wrong, and the error is in the subject
of the sentence.**

s.36 binds **"every registered person"** — the taxpayer — to retain the books and
records required under s.35(1). Invoicey is not a registered person in respect of
its users' supplies. It does not file their returns, is not their books of
account, and has no statutory record-keeping duty over their invoices. It is a
tool that typeset a document.

DPDP s.8(7) requires erasure on consent withdrawal or when the purpose is served,
**"unless retention is necessary for compliance with any law for the time being
in force."** That carve-out is what a retention obligation would enter through.
**Invoicey has no such obligation over invoice content, so the carve-out does not
open, and erasure wins outright.**

**Resolution, stated as a rule:**

1. **On account deletion, Invoicey destroys the invoice data.** It does not
   retain it "for GST reasons", because those reasons are not Invoicey's.
2. **The user's own 72-month duty is real, and deletion defeats it if they leave
   empty-handed.** That is a genuine harm and the product must not walk them into
   it. The answer is not to refuse deletion; it is to **make the export
   unavoidable on the way out** — the delete flow puts the export in the path and
   the confirmation copy states the obligation in plain words. See §3.6.
3. **Say it in the terms**, once, without weaselling: *"Invoicey is not your books
   of account. If you are registered under GST you must retain your records for
   72 months. Export before you delete."* (Drafted in §2.7.)
4. **Nothing Invoicey itself is required to keep is at stake.** There is no
   payment relationship with users — the product is free, takes no payments, and
   holds no financial records of its own about them — so no Income Tax Act or
   Companies Act retention duty attaches to the user data either.
5. **Two things do survive deletion, and both are disclosed:** anonymised
   telemetry, and backups until they age out. Detailed next.

**Anticipating the objection.** If Invoicey ever *does* acquire a records duty of
its own — it starts charging, it becomes a GSP, it signs a customer contract with
retention terms — this analysis changes and must be redone. Record that as the
trigger condition, not as a reason to over-retain today.

### 3.3 What is destroyed, what is retained, and on what basis

| Data | On account deletion | Basis |
|---|---|---|
| `Invoice` documents for the uid — **including `is_deleted: true` ones** | **Destroyed.** `deleteMany({ userId })` with no `is_deleted` filter | Purpose ended; no legal retention duty on Invoicey (§3.2) |
| `Feedback` documents for the uid | **Destroyed** | Same. Product-improvement value does not survive an erasure request |
| `User` document | **Destroyed** | Same |
| Firebase Auth user | **Destroyed** via `admin.auth().deleteUser(uid)` | Must be explicit — see §3.4 |
| `LogEntry` documents for the uid | **Anonymised, not destroyed:** `$set: { userId: null, ip: null }` | Once the identifier and the IP are gone the row is no longer personal data; it stays as aggregate operational/audit history and expires on its own TTL (max 365 days) |
| Nightly R2 backups | **Persist until they age out**, max 30 days | Backups are a security safeguard; disclosed explicitly in the policy. Selectively editing backups would destroy their integrity as backups |
| The deletion audit record itself | Retained **without the uid** | So an operator can answer "was an account deleted on this date" without re-identifying the person |

**On the 30-day invoice recycle bin.** Independently of account deletion, this
design changes what soft delete *means*, because "we told the user it was deleted
and kept it forever, visible to admins and included in admin exports" is
retention beyond purpose:

- **CODE:** a scheduled purge that hard-deletes `Invoice` documents with
  `is_deleted: true` and `createdAt` (ideally a new `deletedAt`) older than 30
  days. **Add `deletedAt: Date`** set in the `soft_delete` branch of
  `app/api/invoices/route.ts` — `createdAt` is the wrong clock, since an invoice
  created a year ago and deleted today would be purged immediately.
- Runs as a new cron, `app/api/cron/purge/route.ts`, guarded by the exact same
  `CRON_SECRET` bearer check already used by
  `app/api/cron/keep-alive/route.ts:22-28`. Add the entry to `vercel.json` next
  to the existing `keep-alive` cron.
- This is disclosed in the policy (§2.6) as a 30-day recycle bin, which is a
  *better* user promise than today's silent forever-retention, and it is
  compatible with the unamended `PRODUCT.md` constraint — nothing in the invoice
  UI promises permanence.

### 3.4 Firebase and Mongo are two deletions, and the order matters

Deleting the Mongo `User` row does **not** delete the Firebase Auth account. Worse
— `lib/auth-user-sync.ts` is the login funnel and will happily **recreate** a
`User` row on the next sign-in, so a Mongo-only deletion silently resurrects the
account. Both must be deleted, and the sequence has to be chosen for its failure
mode.

**Specified order:**

1. Verify token + freshness + typed-email confirmation (§3.6).
2. Write an audit log `account.delete.requested` (category `admin`, with the uid —
   it gets anonymised in step 5 along with everything else).
3. `Invoice.deleteMany({ userId: uid })` — **no `is_deleted` filter**.
4. `Feedback.deleteMany({ userId: uid })`.
5. `LogEntry.updateMany({ userId: uid }, { $set: { userId: null, ip: null } })`.
6. `User.deleteOne({ uid })`.
7. `admin.auth().deleteUser(uid)` — **last**.
8. Write `account.deleted` (category `admin`, `userId: null`, meta carrying only a
   salted SHA-256 of the uid so two support tickets can be correlated without
   re-identification).

**Why Firebase last.** If steps 3–6 fail, the Firebase account still exists and
the user can retry — nothing is lost. If Firebase deletion failed *first*, the
user would be left signed-out-forever with their data still in Mongo and no way
to reach it. The residual failure mode is step 7 failing after 3–6 succeeded:
the user retains a Firebase identity that, on next sign-in, mints a fresh empty
account. Annoying, not harmful, and detectable.

**CODE:** `scripts/audit-orphan-firebase-users.ts` — the reconciliation script
for exactly that case, in the same idiom as the existing
`scripts/audit-orphan-invoices.ts`. Also: the response must only be 200 after
step 7; a partial failure returns 500 and the client must **not** sign the user
out, so they can retry.

### 3.5 Route shapes

Everything routes through `lib/server/auth.ts` and the existing error idiom. No
new auth code.

#### `GET /api/account/export`

New file: `app/api/account/export/route.ts`.

- Auth: `requireUser(req)` → `authErrorResponse(error)`. Verified email is
  already enforced inside `verifyRequestToken`.
- `connectDB()` **inside** the try (this is a new route; do not reproduce the
  bug where five existing handlers call it outside — `prod-readiness.md` §4.1).
- `?format=json` (default) or `?format=csv`.
- Reads, all `.lean()`, all scoped to the uid:
  - `User.findOne({ uid })` — project out `role`, `status`, `_id`, `__v`.
  - `Invoice.find({ userId: uid })` — **no `is_deleted` filter**, `.sort({ createdAt: -1 })`, `.limit(CAP + 1)` with `CAP = 20_000`.
  - `Feedback.find({ userId: uid })`.
  - `LogEntry.find({ userId: uid }).sort({ at: -1 }).limit(5_000)`.
- JSON body shape:

```jsonc
{
  "meta": {
    "generatedAt": "2026-08-17T00:00:00.000Z",
    "format": "invoicey-account-export",
    "version": 1,
    "counts": { "invoices": 0, "feedback": 0, "activity": 0 },
    "truncated": { "invoices": false, "activity": false }
  },
  "profile":  { "uid": "…", "email": "…", "name": "…", "avatar": "…",
                "providerIds": ["…"], "createdAt": "…", "lastLoginAt": "…" },
  "invoices": [ /* full documents, each with is_deleted preserved */ ],
  "feedback": [ /* message, rating, category, page, createdAt */ ],
  "activity": [ /* see redaction rule below */ ]
}
```

- **`activity` redaction rule — deliberate and load-bearing.** Emit only
  `at`, `category`, `event`, `ip`, `userAgent`, and a **whitelisted** `meta`
  (`invoiceId`, `amount`, `currency`, `format`). **Drop `message`, `meta.stack`,
  `meta.route`, `meta.statusCode`, `requestId`.** The user's IP and their own
  activity are their personal data and belong in the export; our stack traces and
  internal route names are not their data and shipping them is the same
  information-disclosure class as the `details: err.message` leak that Phase 0
  removes. Include the redaction as a note in `meta` so it is honest.
- CSV variant: **reuse `toCsv` from `lib/server/admin-export.ts` unchanged.** It
  already does quoting, doubled quotes and `neutralizeCsvValue` formula-injection
  defusal, and is characterization-tested. Do not write a third CSV encoder. CSV
  covers invoices only (it is a flat format); the JSON is the complete record and
  the UI should say so.
- Response headers: `Content-Type: application/json; charset=utf-8`,
  `Content-Disposition: attachment; filename="invoicey-export-<YYYY-MM-DD>.json"`,
  and **`Cache-Control: no-store`** — this is the whole account in one response
  and must not sit in any cache.
- Records `logEvent({ category: "admin", event: "account.export", userId: uid, meta: { format, counts } })`. That event is also what the durable quota counts (§3.7).
- Errors: `logRouteError` + bare `{ error: "Internal Server Error" }`, 500. No `details`.

**Why GET and not the `POST` the launch plan sketched:** the two existing bulk
exports (`app/api/admin/export/invoices/route.ts`,
`app/api/admin/export/users/route.ts`) are `GET`, and this is a read. Matching
the existing convention is worth more than the marginal argument for POST, and
`no-store` handles the caching concern.

#### `DELETE /api/account`

New file: `app/api/account/route.ts`.

- Auth: **`verifyRequestToken(req)` directly, not `requireUser`** — this route
  needs the full `DecodedIdToken`, because of the freshness check below.
- **Re-authentication check, server-side:** reject unless
  `Date.now() / 1000 - decodedToken.auth_time <= 300` (5 minutes). `auth_time` is
  the moment the user actually proved their identity, and it does **not** advance
  on a silent token refresh — which is precisely what makes it the right signal.
  A stolen long-lived session cannot delete an account. Return **`401` with
  `{ error: "Please sign in again to confirm.", code: "REAUTH_REQUIRED" }`** so
  the client can trigger a re-auth and retry rather than showing a dead end.
- **Typed-confirmation check:** body `{ confirmEmail: string }`; require a
  case-insensitive, trimmed exact match against `decodedToken.email`. Mismatch →
  `400`. This is checked on the server, not only in the dialog.
- Then the ordered deletion in §3.4.
- Response `200 { deleted: { invoices: n, feedback: n, activity: n } }` — the
  counts are the receipt.
- Failure at any step: `logRouteError` + `500 { error: "Account deletion did not complete. Nothing has been lost — please try again." }`, and the client stays signed in.

**Client:** add an `accountApi` to `lib/api-client.ts` alongside `invoicesApi` /
`aiApi` — `exportData(format)` returning a `Blob`, and `deleteAccount(confirmEmail)`.
Both use the existing `authedFetch`, so both inherit `authStateReady()`, the
Bearer attach, and the typed `ApiError` / `UnauthenticatedError`. **Do not
hand-roll `auth.currentUser` + fetch.** Download uses `downloadBlobObject` from
`lib/download.ts` — already written for the admin exports.

The re-auth step itself is a client concern: `reauthenticateWithPopup` (Google)
or `reauthenticateWithCredential` (password) from the Firebase SDK, then
`getIdToken(true)` to mint a token carrying the new `auth_time`, then retry.

### 3.6 UI: `app/account/page.tsx`

New page, linked from the avatar dropdown in `components/ui/header.tsx` (which
today only offers sign-out — `:131-132`). `"use client"`, like every other page.
Two cards.

**Card 1 — Export your data.** One paragraph saying what is in the file
(everything: profile, every invoice including deleted ones, feedback, activity).
Two buttons, JSON and CSV. Copy should carry the trust argument the market
research says is worth more than the feature — *"Your data is yours. This is
everything we hold, in a file you can read."* Show the last export time if there
is one.

**Card 2 — Delete your account.** Visually separated, destructive styling, at the
bottom. Not behind a hidden "danger zone" accordion — hiding an irreversible
action is not the same as protecting against it.

The dialog uses the existing `components/ui/modal.tsx` (`prod-readiness.md` §4.4
calls it "a complete, correct dialog"). **Four gates, all required, in order:**

1. **Show the damage, with live counts** fetched at dialog open: *"This will
   permanently delete 47 invoices (3 in the recycle bin), 2 pieces of feedback,
   and your account. This cannot be undone."* Real numbers, not a generic
   warning — a specific number is what makes someone stop.
2. **Export gate.** A primary "Download my data first" button. Below it, a
   checkbox: *"I have my data, or I don't want it."* The checkbox stays disabled
   until the export has been downloaded **or** the user clicks a plain-text
   "skip this" link. Next to it, the sentence that matters: *"If you're
   registered under GST, you're required to keep your invoice records for 72
   months. Invoicey isn't your books of account — take the file."*
3. **Type the email.** Free-text field; the destructive button stays disabled
   until it exactly matches the signed-in email. Not "type DELETE" — typing your
   own address makes you look at *which* account you are deleting.
4. **Re-authenticate.** Triggered by the final button. Google popup or password
   prompt, then retry with a fresh token.

Final button label: **"Permanently delete my account"**. Not "Confirm". After
success: sign out, redirect to `/`, and show a one-time confirmation. No
"Undo" — there is none, and offering one would be a lie.

**Anti-accident properties this gives:** a stolen session cannot do it (gate 4,
enforced server-side); a mis-click cannot do it (gates 1–3); a phishing page
cannot trigger it cross-origin (`DELETE` + Bearer + `frame-ancestors 'none'`);
and the user cannot leave without being told about their own retention duty
(gate 2).

### 3.7 Rate limiting

`lib/server/rate-limit.ts` already exists with the right honest docstring: the
in-memory limiter is **best-effort only** on Vercel, because the bucket map lives
in one lambda's heap. Use it where best-effort is enough, and use a durable count
where it is not.

| Route | Limit | Mechanism |
|---|---|---|
| `GET /api/account/export` | **3 per rolling 24h per uid — durable** | Count `account.export` entries in `LogEntry` for the uid where `at > now - 24h`. This is exactly the pattern `INVOICE_AI_DAILY_LIMIT` already uses against `ai.request` entries, and `LogEntry` retention (180 days for `info`+`admin`… note: `category: "admin"` is 365 days) far exceeds the window. Configurable via a new `ACCOUNT_EXPORT_DAILY_LIMIT` in `.env.sample`, default 3 |
| `GET /api/account/export` | 5 per 10 min per uid — burst | `consumeRateLimit({ namespace: "account-export", limit: 5, windowMs: 600_000 })` |
| `DELETE /api/account` | 5 per hour per uid — burst | `consumeRateLimit({ namespace: "account-delete", … })`. The real protection here is the 5-minute `auth_time` freshness window plus the typed email, not the counter |

Both return `429` with a `Retry-After` header built from `retryAfterSeconds`,
which `RateLimitVerdict` already provides.

The export is the expensive one: it reads an entire tenant unpaginated. Three per
day is generous for a human and ruinous for a loop.

### 3.8 Files for §3

**CODE**

| Path | New/change |
|---|---|
| `app/api/account/export/route.ts` | new |
| `app/api/account/route.ts` | new — `DELETE` |
| `app/api/cron/purge/route.ts` | new — 30-day recycle-bin purge |
| `app/account/page.tsx` | new |
| `components/AccountDangerZone.tsx` | new — the four-gate dialog, extracted so it is testable |
| `lib/api-client.ts` | change — add `accountApi` |
| `lib/account-export.ts` | new — the pure shape/redaction builder, so the route is thin and the redaction whitelist is unit-testable |
| `app/api/invoices/route.ts` | change — set `deletedAt` in the `soft_delete` branch |
| `models/Invoice.ts` | change — add `deletedAt?: Date`; consider an index on `{ is_deleted: 1, deletedAt: 1 }` for the purge |
| `components/ui/header.tsx` | change — link the account page from the avatar dropdown |
| `vercel.json` | change — add the purge cron |
| `.env.sample` | change — `ACCOUNT_EXPORT_DAILY_LIMIT` |
| `scripts/audit-orphan-firebase-users.ts` | new — reconciliation for a failed step 7 |
| `tests/account-export.test.ts` | new — the redaction whitelist, the deleted-invoice inclusion, CSV escaping via `toCsv` |
| `tests/account-delete.test.ts` | new — `auth_time` freshness, email mismatch, and that `deleteMany` carries no `is_deleted` filter |
| `PRODUCT.md` | **change — the §3.1 amendment. Owner must approve the wording** |

**OWNER ACTION**

- Approve the `PRODUCT.md` amendment in §3.1. Nothing else in item 2 can ship
  before this.
- Confirm the 30-day recycle-bin window is the intended promise (it goes in the
  published policy, so changing it later is a policy revision).

**Explicitly reused, not rebuilt:** `toCsv` (`lib/server/admin-export.ts`),
`downloadBlobObject` (`lib/download.ts`), `authedFetch` (`lib/api-client.ts`),
`consumeRateLimit` (`lib/server/rate-limit.ts`), `requireUser` /
`verifyRequestToken` / `authErrorResponse` (`lib/server/auth.ts`),
`logEvent` / `logRouteError` (`lib/server/log.ts`), `components/ui/modal.tsx`.
`lib/invoice-export.ts` is **not** reusable here — `createInvoiceHtml` and
`createInvoiceCsv` are both single-invoice and client-side; the bulk path needs
neither.

---

## 4. Nightly backup to Cloudflare R2, and the Atlas allowlist

### 4.1 Why not Vercel Cron

`vercel.json` already has the pattern — one `crons` entry pointing at
`/api/cron/keep-alive`, and that route shows the guard idiom: read `CRON_SECRET`,
compare against `Authorization: Bearer <secret>`, 401 on mismatch
(`app/api/cron/keep-alive/route.ts:22-28`). The §3.3 purge cron should follow it
exactly.

**The backup should not.** Three reasons, all disqualifying on their own:

1. `mongodump` is a binary. It does not exist in the Vercel function runtime and
   cannot be installed there.
2. A full dump does not fit in a function's execution budget or memory as the
   database grows, and a dump that fails at 90% is worse than no dump because it
   looks like it worked.
3. The backup credential must **not** live next to the app. If the app is
   compromised, the thing that recovers you should not be reachable from it.

So the backup runs in **GitHub Actions**, on a schedule, in a separate trust
domain. That also matches `prod-readiness.md` §5.1's recommendation.

### 4.2 The workflow

New file: `.github/workflows/backup.yml`. Runs `0 20 * * *` UTC (01:30 IST,
deliberately offset from the 06:00 UTC keep-alive cron so the two are not
competing for an M0's tiny op budget).

Steps, in order:

1. **Open the door.** `POST` the runner's public IP to the Atlas Admin API
   (`/api/atlas/v2/groups/{PROJECT_ID}/accessList`) with a `deleteAfterDate` about
   an hour out. Atlas supports temporary access-list entries natively — the
   `deleteAfterDate` is the belt to the explicit-removal braces in step 7. Digest
   auth with an Atlas API public/private key pair held as GitHub secrets.
2. **Dump.** `mongodump --uri="$MONGODB_URI" --archive --gzip > dump.gz`, using a
   **dedicated read-only Atlas database user** — not the app's user, and not an
   admin user.
3. **Encrypt.** `age --encrypt --recipient "$AGE_PUBLIC_KEY" dump.gz > dump.gz.age`.
   This matters: R2 encrypts at rest, but a leaked R2 token would otherwise yield
   plaintext containing every user's clients' names, addresses and bank details.
   With `age`, the GitHub secrets grant the ability to *write* backups, never to
   *read* them. **The private key is held by the owner offline and is never in
   GitHub, never in Vercel, never in the repo.**
4. **Upload.** `aws s3 cp` against R2's S3-compatible endpoint, to
   `s3://invoicey-backups/daily/<YYYY-MM-DD>/dump.gz.age`. On the 1st of the
   month, copy the same object to `monthly/<YYYY-MM>/`.
5. **Smoke-test the artifact** — see §4.4.
6. **Fail loudly.** On failure, the workflow must page a human. A silently failing
   backup is indistinguishable from no backup, which is today's state. Route the
   failure to the same place as Sentry alerts (§5).
7. **Close the door**, in an `if: always()` step: `DELETE` the access-list entry.

### 4.3 Credentials, and where each one lives

| Secret | Held in | Grants |
|---|---|---|
| `MONGODB_URI_BACKUP` | GitHub Actions secret | Read-only Atlas user, this database only |
| `ATLAS_API_PUBLIC_KEY` / `ATLAS_API_PRIVATE_KEY` | GitHub Actions secret | Project IP access-list edit only — scope the API key to the narrowest Atlas role that permits it |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | GitHub Actions secret | **Write-only** R2 token, scoped to the one bucket. No delete, no list, no read |
| `AGE_PUBLIC_KEY` | GitHub Actions secret (not sensitive; a secret only for tidiness) | Encrypt to the owner |
| **`AGE_PRIVATE_KEY`** | **Offline, owner-held. Password manager plus one printed/offline copy** | Decrypt. Losing it means losing every backup — this is the single point of failure and the owner must treat it as such |

Retention: an R2 **lifecycle rule** expiring `daily/` after **30 days** and
`monthly/` after **12 months**. The 30 days is the number published in the
privacy policy (§2.6), so it must match.

### 4.4 How a restore is actually tested

An untested backup is a hypothesis. Two layers, both automated, because a manual
quarterly checklist is a quarterly checklist nobody runs.

**Every night, in the same workflow (cheap):**

- Assert `dump.gz.age` is larger than a floor (e.g. 10 KB) and larger than 50% of
  yesterday's — a dump that silently produced an empty archive is the classic
  failure and a size floor catches it.
- Decrypt and `mongorestore --archive --gzip --dryRun` to prove the archive parses
  and the BSON is intact.

**Every month, a separate workflow (`.github/workflows/restore-drill.yml`) that
actually restores:**

1. Pull the most recent object from R2.
2. Decrypt with an `AGE_PRIVATE_KEY` held **only** as a secret on this one
   workflow — this is the one place the private key must exist online, and it is
   the reason the drill is a separate workflow with its own environment
   protection rules rather than a step in the nightly job.
3. `services: mongo:7` container; `mongorestore` the archive into it.
4. Run `bun scripts/verify-backup.ts` against the restored instance
   (**CODE**, new): asserts every expected collection exists; that
   `Invoice`, `User`, `Feedback`, `LogEntry` document counts are non-zero and
   within a sane delta of the previous drill; that every index in
   `models/*.ts` is present after restore (a dump/restore that loses the
   `expireAt` TTL index would silently turn log retention off); and that one
   sampled invoice round-trips through `resolveRecordAmounts` to the stored
   `total`. That last check is the difference between "the bytes came back" and
   "the data is usable".
5. Fail the workflow loudly on any assertion.
6. **Write the drill result somewhere the owner sees it** — a dated line in
   `docs/runbooks/restore.md`, or a GitHub issue on failure. "When was the last
   successful restore?" must have an answer with a date on it.

**CODE:** `docs/runbooks/restore.md` — the human procedure for a real incident,
written now while nobody is panicking: where the bucket is, how to get the age
key, the exact `mongorestore` command with `--nsInclude` for a single-collection
recovery, and how to restore into a *new* cluster rather than over the live one.
This runbook doubles as the DPDP Rule 7 breach-response starting point.

### 4.5 The Atlas IP allowlist — and an uncomfortable finding

The launch plan says "verify the Atlas IP allowlist isn't `0.0.0.0/0`". It is
almost certainly `0.0.0.0/0`, and **for a Vercel-hosted app that is currently the
only configuration that works**, which is a materially different conclusion from
the one the plan implies. Verified in August 2026:

- Vercel serverless functions have **dynamic egress IPs**. MongoDB's own Vercel
  integration documentation states the Atlas access list must allow `0.0.0.0/0`,
  and **Atlas adds that entry on your behalf** as part of the integration
  workflow.
- Vercel now sells **Static IPs** — GA in early 2026, **$100/month per project**,
  Pro or Enterprise only. That is the supported way to get a pinnable egress
  range, and at ~$32/month total infra for 100 users it **triples the bill**.
- The third path is a third-party egress proxy (QuotaGuard and similar), which
  adds a vendor, a hop, and a place for the connection string to be observed.

**Honest recommendation, stated as a decision for the owner rather than a task:**

- **Do not spend $100/month for this at launch.** It buys IP-based access control
  on a database whose real protection is the connection string plus SCRAM auth.
- **Instead, treat the URI as the only control and harden accordingly** —
  separate least-privilege Atlas users for the app, the backup job, and the
  migration scripts (`scripts/migrate-*.ts` currently run from a laptop with
  production credentials, per `prod-readiness.md` §5.1); rotate on any suspicion;
  never put the URI in a client bundle; and make sure Phase 0's
  `User.accessToken` / `refreshToken` purge has landed, because that is what
  turns a leaked URI from "a data breach" into "a total account takeover".
- **Do pin `0.0.0.0/0` down where you can:** the GitHub Actions backup job does
  *not* need it (§4.2 opens and closes a single-IP window), and neither do the
  migration scripts — those should use their own user and a temporary
  allowlist entry, not the blanket rule.
- **Revisit when Atlas moves off M0.** At M10+, Atlas Private Endpoint / VPC
  peering becomes available and is a better answer than static egress IPs.

**OWNER ACTION — how to check the current state.** Both are console/API actions;
an agent cannot do either.

1. Atlas UI → the project → **Network Access** → **IP Access List**. Look for an
   entry `0.0.0.0/0` with comment text mentioning the Vercel integration.
2. Or via the Admin API, from the owner's machine:
   `curl --user "<PUBLIC>:<PRIVATE>" --digest "https://cloud.mongodb.com/api/atlas/v2/groups/<PROJECT_ID>/accessList"`
   and read the `cidrBlock` values.
3. Also in Atlas → **Database Access**: confirm how many database users exist and
   what roles they hold. The expected end state is three, each least-privilege:
   app (`readWrite` on the one database), backup (`read`), migrations (`readWrite`,
   normally disabled).

### 4.6 Files for §4

**CODE:** `.github/workflows/backup.yml`, `.github/workflows/restore-drill.yml`,
`scripts/verify-backup.ts`, `docs/runbooks/restore.md`,
`app/api/cron/purge/route.ts` + the `vercel.json` cron entry (from §3.3).

**OWNER ACTION:** create the Cloudflare R2 bucket and its write-only token; set
the lifecycle rules; check whether R2 **bucket lock** is available and enable it
on `daily/` so a compromised write token cannot overwrite history with garbage;
generate the `age` keypair and store the private key offline; create the Atlas
API key and the two additional least-privilege database users; add all secrets to
GitHub; run the allowlist check in §4.5; and decide the Static IPs question.

---

## 5. Sentry + an uptime check on `/api/health`

### 5.1 `GET /api/health` — what it checks

New file: `app/api/health/route.ts`. `export const dynamic = "force-dynamic"` —
a cached health check is a lie.

**Unauthenticated**, deliberately: an uptime probe cannot hold a Firebase token,
and requiring a secret would mean the probe cannot detect the failures that a
public user experiences. That makes the response body a public document, which
governs everything in §5.2.

Checks:

1. **Mongo reachable.** `mongoose.connection.db.admin().command({ ping: 1 })`
   with a **2-second** timeout, raced against a `Promise.race` deadline so a
   30-second server-selection stall cannot hold the function open — the exact
   failure `prod-readiness.md` §3.1c describes. Note this deliberately does *not*
   use `Invoice.estimatedDocumentCount()` the way `keep-alive` does; a ping is
   cheaper and this route is hit every 3 minutes forever.
2. **Firebase Admin initialisable.** Call `ensureFirebaseAdmin()` inside a
   try/catch. A missing or malformed `FIREBASE_ADMIN_CREDENTIALS` takes down every
   authenticated route while the app still serves HTML, so uptime that only
   checks "does the page load" would miss a total outage.
3. **Required env present.** Boolean presence only, for `MONGODB_URI`,
   `FIREBASE_ADMIN_CREDENTIALS`, `GEMINI_API_KEY`. Names and booleans only.
   Never values, never lengths, never prefixes.

**Not checked:** Gemini. It is a third party with its own latency, the assistant
is non-essential by design (`prod-readiness.md` §4.3), and a Gemini blip must not
page anyone at 3am or trip the status page.

Status: **200** when Mongo and Firebase are both fine, **503** otherwise. The
uptime monitor keys off the status code, not the body.

### 5.2 What it must NOT leak

This is the part that turns a health check into a disclosure. The endpoint is
public and permanently discoverable, so treat the body as published.

**Forbidden in the response, always:**

- Any connection string, host, cluster name, or database name.
- Version numbers of anything — Node, Next, Mongo server, the app. Version
  disclosure is how an attacker maps you to a CVE list. (Related: `next.config.ts`
  should set `poweredByHeader: false`, per `prod-readiness.md` §7.2.)
- The deployment region, the Vercel deployment id or git SHA.
- Any exception text or stack. The Mongo error must be caught and collapsed to a
  boolean — the same discipline as the `details: err.message` removal in Phase 0.
- Counts of anything — user counts, invoice counts, error counts. `keep-alive`
  currently returns `invoiceCount`; that is fine because it is cron-secret-gated,
  but it must **not** be copied into the public route. (This is worth writing as
  a comment in the new file, because `keep-alive` is the obvious template and
  copying it is the obvious mistake.)
- Env var **values**, or anything derived from them.
- Latency figures precise enough to be a timing oracle. Round to a coarse bucket
  or omit.

**The entire permitted response:**

```json
{ "status": "ok", "checks": { "database": "ok", "auth": "ok", "config": "ok" } }
```

and on failure the same shape with `"status": "degraded"` and the failing check
set to `"fail"`. Three keys, three enum values, no free text. If someone later
wants a richer body for debugging, that belongs behind `CRON_SECRET` on a
separate `/api/health/detail` route — not bolted onto this one.

Also: rate-limit it (`consumeRateLimit`, namespace `health`, generous — 60/min
per IP) and set `Cache-Control: no-store`. It is unauthenticated and it touches
the database.

**OWNER ACTION:** create the monitor — BetterStack Uptime or UptimeRobot, free
tier, probing `https://<domain>/api/health` every 3 minutes **from an India
region**, alerting to the owner's phone, with the free hosted status page turned
on. The status page URL then goes in the footer and the terms.

### 5.3 Sentry — wiring

`@sentry/nextjs`, current setup convention:

| File | Purpose |
|---|---|
| `instrumentation.ts` | `register()` dispatching to the server/edge config by runtime; `export const onRequestError = Sentry.captureRequestError` |
| `sentry.server.config.ts` | Node runtime init |
| `sentry.edge.config.ts` | Edge runtime init |
| `instrumentation-client.ts` | Browser init (this replaced the older `sentry.client.config.ts`) |
| `next.config.ts` | wrap the export in `withSentryConfig` — **carefully**: the file already carries the hand-written CSP and `headers()` block from Phase 0, and that must survive the wrap |
| `app/global-error.tsx`, `app/dashboard/error.tsx`, `app/admin/error.tsx` | change — add `Sentry.captureException(error)` beside the existing `console.error`, so the `digest` shown to the user (`global-error.tsx:141`) becomes searchable |
| `app/create-invoice/error.tsx` | **new** — the highest-value screen in the app has no boundary today (`prod-readiness.md` §4.4) |

`lib/server/log.ts` stays exactly as it is. It is a good audit/analytics log and
a bad outage detector; Sentry is the outage detector. Do not merge them. One
optional bridge: `logRouteError` may additionally call `Sentry.captureException`,
so a route error lands in both — but **only after** the scrubbing in §5.4 is in
place, because `logRouteError` passes a full stack.

### 5.4 Sentry PII scrubbing — the requirement, not an afterthought

Invoice contents and client details **must not** reach Sentry. Sentry is a
processor in the US or EU; shipping `billToEmail` into it would make the §2.2
table wrong and the policy false.

Config, all of it non-negotiable:

- **`sendDefaultPii: false`.** This is the master switch; it is what stops IPs,
  cookies and request bodies being attached by default. Set it explicitly rather
  than relying on the default, and comment why.
- **`beforeSend`** on both runtimes, doing three things:
  1. **Drop request bodies entirely** — `delete event.request.data`. A `POST
     /api/invoices` body *is* the invoice.
  2. **Strip query strings and rewrite dynamic path segments** —
     `/create-invoice/68f0…` becomes `/create-invoice/[id]`. An invoice id is not
     personal data by itself, but it is a join key, and the URL is what
     `Referrer-Policy` exists to protect (`prod-readiness.md` §1.9).
  3. **Key-based redaction over `extra`/`contexts`/`tags`**, reusing the same
     regex idea already proven in `lib/server/log.ts:44-46`, extended with the
     invoice field names: `billTo`, `billToEmail`, `billToAddress`,
     `companyEmail`, `companyPhone`, `companyAddress`, `paymentInfo`, `notes`,
     `terms`, `items`.
- **`beforeBreadcrumb`** — drop `fetch`/`xhr` breadcrumbs' request and response
  bodies. Breadcrumbs are the sneaky path: nobody remembers they capture the
  failing request.
- **User context: uid only.** `Sentry.setUser({ id: uid })`. **Never** `email`,
  never `username`. The uid is the join key into an export or a support ticket
  and is sufficient.
- **Session Replay: off.** It records the DOM, and the DOM here is an invoice.
- `tracesSampleRate` low (0.1) and `replaysSessionSampleRate: 0`.
- **`tests/sentry-scrub.test.ts` (CODE)** — extract `beforeSend` into
  `lib/observability/scrub.ts` as a pure function and characterization-test it,
  in the same spirit as `lib/numeric-input.ts`. Feed it a synthetic event
  containing a full invoice payload and assert nothing recognisable survives.
  A scrubber nobody tests is a scrubber that silently stops working.

**OWNER ACTION:** create the Sentry org/project (free tier: 5k errors/month, one
user), **choose the data region deliberately and record it — it goes in the
privacy policy table**, add `SENTRY_DSN` / `SENTRY_AUTH_TOKEN` to Vercel env and
`.env.sample`, and turn on Sentry's own server-side data-scrubbing settings as a
second line of defence behind `beforeSend`.

### 5.5 Files for §5

**CODE:** `app/api/health/route.ts`, `instrumentation.ts`,
`instrumentation-client.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`,
`lib/observability/scrub.ts`, `tests/sentry-scrub.test.ts`,
`app/create-invoice/error.tsx`; changes to `next.config.ts`, the three existing
`error.tsx` boundaries, `package.json`, `.env.sample`.

**OWNER ACTION:** Sentry project + region + DSN; uptime monitor + status page;
Google Cloud budget alert, Atlas alerts on connections and storage, and Vercel
spend management (each is a checkbox, and each is the thing that protects the
wallet rather than the data).

---

## 6. A real support email on `/contact`

### 6.1 What the page has today

`app/contact/page.tsx` is 78 lines and renders exactly one thing: a
`contactLinks` array of **three personal social profiles** —
`twitter.com/faaaaraaaan`, `github.com/faranheit15`,
`linkedin.com/in/faran-mohammad` — as three cards, under the heading *"Reach out
and follow the product journey"* and the line *"The fastest way to connect is
through the channels below."*

There is **no email address, no postal address, no phone number, and no support
channel** on the page. `components/ui/footer.tsx` is 10 lines with **no links at
all**, so there is no route to a contact channel from anywhere else either.

Three observations that make this a launch blocker rather than a polish item:

- **It is not a support channel.** A public Twitter mention and a LinkedIn DM are
  not places a stranger reports a billing-data problem, and a GitHub profile is
  not an issue tracker.
- **It is not a legal contact.** SPDI Rule 5(9) requires the Grievance Officer's
  contact details to be published on the website; DPDP Rule 14 requires a
  published business contact for questions about processing. A social handle
  satisfies neither.
- **It is personal, not organisational.** Every channel is the maintainer's
  personal identity. That is a privacy exposure for the maintainer and it reads
  to a user as "there is no company here" — which is true, but there are better
  ways to be honest about it than making the only support channel a personal DM.

### 6.2 What it needs — CODE

Restructure the page around channels, not profiles:

1. **Support — `support@<domain>`.** Primary, at the top, an actual `mailto:`.
   Say what it is for and what the realistic response time is. `PRODUCT.md`'s
   voice forbids inventing an SLA, so say the true thing: *"One person reads
   this. Usually within a couple of days."*
2. **Privacy and grievances — `privacy@<domain>`**, with the Grievance Officer's
   name beside it and the **30-day** commitment from §2.4. This block is the
   legal one and should be visually distinct enough that someone looking for it
   finds it.
3. **Security — `security@<domain>`**, matching `public/.well-known/security.txt`.
4. **Postal address** — the entity's registered address. Required by the same
   rules that require the grievance contact.
5. **The social links stay**, demoted, honestly relabelled: "Follow along" for
   product updates. They are genuinely useful for that; they were only wrong as
   *the* contact channel.

All four addresses come from `lib/legal.ts` (§2.3) so the contact page, the
privacy policy, the terms, the footer and `security.txt` cannot drift.

Also change `components/ui/footer.tsx` to link Privacy / Terms / Contact — the
policy is only "published" if it is reachable.

**Do not add a contact form.** It would need a mail provider, which the app does
not have (`prod-readiness.md` §6 — the app sends no email at all today), and a
form that silently fails is worse than a `mailto:`. `mailto:` also gives the user
a copy of what they sent, which for a grievance is the right property.

### 6.3 OWNER ACTION for §6

**Provisioning the mailbox is entirely an owner action.** An agent can write the
page; it cannot create an inbox.

1. **Own the domain** and configure DNS.
2. **Provision the mailboxes** — `support@`, `privacy@`, `security@`. Cheapest
   workable options: Cloudflare Email Routing (free; forwards to a personal inbox,
   receive-only) or Zoho Mail / Google Workspace (paid; can send *as* the address,
   which matters when replying to a grievance — a reply from a personal Gmail
   undoes the point). Aliases pointing at one inbox are fine; three separate
   inboxes are not required.
3. **Set SPF, DKIM and DMARC** on the domain even though the app sends no mail —
   an unprotected domain is spoofable, and invoicing is a phishing-attractive
   context.
4. **Decide the grievance officer's name** (realistically the maintainer) and the
   **postal address**, and accept that both are published.
5. **Actually monitor the inboxes.** The 30-day SPDI clock starts on receipt, not
   on the day the maintainer next checks. Set up forwarding to a phone.

---

## 7. Consolidated OWNER ACTION checklist

Nothing on this list can be delegated to an agent. Several of them block CODE
work, so they are worth doing first.

**Blocks the privacy policy and terms (§2):**

- [ ] Decide the legal entity (sole proprietorship vs registered company) and its name
- [ ] Provide a postal address
- [ ] Confirm the MongoDB Atlas cluster's cloud region
- [ ] Own and configure the custom domain
- [ ] Verify the domain in Google Search Console (required for OAuth brand verification)
- [ ] Provision `support@`, `privacy@`, `security@`; set SPF/DKIM/DMARC
- [ ] Move Gemini to a **paid** key (also Phase 0) — without this the AI paragraph in the policy has to use the FREE-KEY ALTERNATIVE text
- [ ] Have a lawyer review both drafts, especially limitation of liability, governing law, and the controller/processor framing of clients' data
- [ ] Approve the `PRODUCT.md` amendment in §3.1 — **this blocks all of item 2**

**Google (§1.5):**

- [ ] Publish the OAuth consent screen (audience: In production)
- [ ] Submit **brand verification** with homepage + privacy policy URLs on the verified domain

**Backups (§4):**

- [ ] Create the Cloudflare R2 bucket + a **write-only** scoped token
- [ ] Set lifecycle rules: `daily/` 30 days, `monthly/` 12 months
- [ ] Check whether bucket lock is available and enable it on `daily/`
- [ ] Generate the `age` keypair; store the private key **offline**
- [ ] Create an Atlas API key scoped to access-list management
- [ ] Create two additional least-privilege Atlas database users (backup: read; migrations: readWrite, normally disabled)
- [ ] Add all secrets to GitHub Actions
- [ ] **Check the current Atlas IP access list** (§4.5) and record what it is
- [ ] Decide the Vercel Static IPs question ($100/mo, Pro+) — recommendation: no, not at launch

**Observability (§5):**

- [ ] Create the Sentry project; **choose and record the data region**; add the DSN to Vercel env
- [ ] Turn on Sentry's own server-side scrubbing as defence in depth
- [ ] Create the uptime monitor on `/api/health` from an India region; enable the free status page
- [ ] Google Cloud budget alert on the Generative Language API
- [ ] Atlas alerts on connection count and storage
- [ ] Vercel spend management limits

**Ongoing:**

- [ ] Monitor the three inboxes (the 30-day grievance clock runs from receipt)
- [ ] Read the monthly restore-drill result

---

## 8. Sequencing, and what this design leaves open

### 8.1 Suggested order

The dependencies are real and mostly run through the owner actions.

1. **Owner: entity, domain, mailboxes, Atlas region, paid Gemini key.** Nothing
   legal can be written truthfully until these exist. Start here.
2. **Owner: approve the `PRODUCT.md` amendment (§3.1).** Item 2 is blocked on it.
3. **CODE: `/api/health` + Sentry + the uptime monitor.** No dependencies, and
   they are what tells you whether the rest of Phase 1 broke anything.
4. **CODE: backup workflow + restore drill.** Independent of everything else, and
   the current state (M0, no backups, no restore path) is the single largest
   unbounded risk in the project.
5. **CODE: account export.** Ships before deletion, deliberately — the export is
   the thing that makes deletion safe, and it is independently valuable.
6. **CODE: account deletion + the 30-day purge cron.**
7. **CODE: `lib/legal.ts`, `/privacy`, `/terms`, footer links, `/contact`,
   `security.txt`.** Last, because the policy describes the behaviour of 5 and 6
   — writing it first guarantees it describes something that does not exist.
8. **Owner: OAuth brand verification**, which needs 7 to be live at a real URL.

### 8.2 Open questions and things I could not determine

1. **The legal entity does not exist yet, as far as the repo shows.** "Body
   corporate" under IT Act s.43A and "Data Fiduciary" under DPDP both presuppose
   someone to be. Every draft has `[ENTITY NAME]` in it for that reason. This is
   the input everything else waits on.
2. **The Atlas cluster's region is not discoverable from the repo** — the URI is
   an env var and is not in the tree. It has to be in the privacy policy.
3. **The current Atlas IP access-list state is not discoverable from the repo
   either.** §4.5 gives the two ways to check; both are console/API actions from
   the owner's credentials. The strong prior is `0.0.0.0/0`, added automatically
   by MongoDB's Vercel integration.
4. **Whether the deployment is already on a paid Gemini key is not knowable from
   the code** — `GEMINI_API_KEY` is opaque. The privacy policy draft assumes paid
   and carries the free-tier alternative paragraph; the owner must pick.
5. **Whether Vercel is on Hobby or Pro is not in the repo.** `prod-readiness.md`
   notes Hobby forbids commercial use, so Pro is required from day one; the cron
   count and function limits in §3.3 and §4 assume Pro.
6. **`app/pricing/page.tsx` says the product is "currently free while we polish
   the platform".** That is in tension with `PRODUCT.md`'s "$0, indefinite, no
   paid tier" and with the terms drafted in §2.7. One of the two has to change,
   and which one is a product decision — it is arguably the same open question as
   the launch plan's open decision #2 (the cost ceiling behind "$0 indefinite").
   Flagged, not resolved.
7. **`PRODUCT.md` says "No team, workspace, or multi-user account model exists."**
   The terms draft assumes that. If Phase 4's anonymous-first-invoice bet ships,
   both documents need a pass — an anonymous user creating an invoice locally is
   a different (and much smaller) processing story, and the launch plan is right
   that it *shrinks* DPDP surface.
8. **The Data Protection Board's actual complaint intake process** is referenced
   in the policy draft in general terms because the Board was constituted in
   November 2025 and its practical procedures are still bedding in. If the
   Board publishes a specific complaint URL before launch, put it in the policy.
9. **`prod-readiness.md` §8.3 lists an incident runbook and a breach-notification
   plan as HIGH.** They are not in the launch plan's Phase 1 list and so are not
   designed here — but `docs/runbooks/restore.md` (§4.4) is the natural place for
   the breach runbook to live, DPDP Rule 7's clock (**intimate affected users
   without delay; detailed report to the Board within 72 hours**) is now verified
   and recorded above, and one open item is genuinely missing infrastructure:
   **there is no query that enumerates affected users**, which is the first thing
   a breach response needs. Worth an hour in Phase 1 rather than a scramble later.
