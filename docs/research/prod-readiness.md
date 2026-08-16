# Invoicey — Production / Launch Readiness Audit

Scope: `/home/faran/projects/invoicey` @ `develop` (bd0f249). Target: public launch, thousands of Indian SMB users, Next.js 16 + MongoDB Atlas M0 + Firebase Auth on Vercel.
Method: read-only source audit against `CLAUDE.md`. Vendor pricing researched last and marked UNVERIFIED where not confirmed.

Severity: **BLOCKER** = do not open signups until fixed. **HIGH** = fix in the first two weeks. **MEDIUM** = fix in the first quarter. **LOW** = backlog.
Size: S = < half a day, M = 1-3 days, L = > 3 days.

---

## 0. Cannot launch until these are fixed

| # | Finding | Sev | Size | Section |
|---|---|---|---|---|
| B1 | No rate limiting on any authenticated route; the two in-memory limiters that exist are per-lambda and therefore ineffective on Vercel | BLOCKER | M | 2.1 |
| B2 | `/api/ai/invoice-assistant` is an uncapped, un-metered Gemini spend faucet — any verified account can loop it | BLOCKER | S-M | 2.2 |
| B3 | `connectDB()` has no cached connection promise → connection storm against an M0's 500-connection cap under serverless concurrency | BLOCKER | S | 3.1 |
| B4 | Firebase **refresh tokens and ID tokens are persisted in MongoDB** (`User.accessToken`, `User.refreshToken`) and mirrored into JS-readable cookies — a DB dump is a total takeover of every account | BLOCKER | S | 1.6 |
| B5 | Atlas M0 has **no backups** (no snapshots, no PITR). There is no restore path for a bad migration, a dropped collection, or a ransomed cluster | BLOCKER | S | 5.1 |
| B6 | No privacy policy, no terms, no cookie/consent notice — while Vercel Analytics + Speed Insights already run on every page and the DPDP Act 2023 applies | BLOCKER | M | 8.1 |
| B7 | No way for a user to delete their account or export their own data (DPDP s.12 / GDPR art. 15+17). Verified absent: there is no such route or UI | BLOCKER | M | 5.3 |
| B8 | No security headers at all — no CSP, HSTS, X-Frame-Options, Referrer-Policy (`next.config.ts` has no `headers()`, there is no `middleware.ts`) | BLOCKER | S | 1.9 |
| B9 | 500 responses on `/api/invoices` leak raw exception text to the client (`details: err.message`) | BLOCKER | S | 1.7 |
| B10 | No error monitoring of any kind — the only "observability" is a Mongo-backed log collection read through the app's own admin panel, which is useless precisely when Mongo is the thing that is down | BLOCKER | S | 4.4 |
| B11 | If the deployment uses a **free** Gemini API key, Google's own pricing page states free-tier prompts are used to improve their products — and every prompt contains your users' clients' names, emails, addresses and amounts | BLOCKER | S | 9 |

Everything else in this report is HIGH or below and can ship after launch.

---
## 1. Security

### 1.1 Tenant isolation — verified sound

Every user-facing read and write is scoped by the verified Firebase uid, and the uid is never taken from the request body.

- `requireUser` returns `decodedToken.uid` from `admin.auth().verifyIdToken(token, true)` — `lib/server/auth.ts:78`, `lib/server/auth.ts:97`. `checkRevoked: true` means an admin suspension takes effect on the next request without a DB read.
- Single read: `Invoice.findOne({ _id, userId: userUid, is_deleted: { $ne: true } })` — `app/api/invoices/route.ts:183`.
- List: `Invoice.find({ userId: userUid, is_deleted: { $ne: true } })` — `app/api/invoices/route.ts:194`.
- Update: ownership is proven by a scoped `findOne` before `Object.assign` — `app/api/invoices/route.ts:295`.
- PATCH writes carry the tenant predicate on the write itself (`ownedFilter`) — `app/api/invoices/route.ts:380`, `:383`, `:393`, `:408`.
- Feedback is scoped: `Feedback.find({ userId: userUid })` — `app/api/feedback/route.ts:113`.

**IDOR: none found.** Passing another user's `?id=` returns 404, not the record. There is a characterization test for this (`tests/invoices-isolation.test.ts`).

**Mass assignment: none found.** `normalizePayload` (`app/api/invoices/route.ts:112-159`) returns an explicit whitelist — no `userId`, no `is_deleted`, no `_id`. POST sets `userId`/`is_deleted` *before* the spread (`:237-241`), so a body field cannot override them; PUT assigns only the normalized object (`:311`). Status is allowlisted (`:130-132`, `:407`).

**NoSQL injection: none found.** Every `_id` reaching a query is a `string`: from `searchParams.get()` or through `cleanString()`, which returns `""` for non-strings (`app/api/invoices/route.ts:92`). So `{"id": {"$ne": null}}` collapses to `""` → CastError → 400 (`:161-164`). Admin filters are equally string-typed (`app/api/admin/logs/route.ts:50-52`) and free-text search is regex-escaped (`lib/server/pagination.ts:34`).

### 1.2 The admin gate — sound, with two gaps

`requireAdmin` (`lib/server/admin.ts:29-46`) re-verifies the token, reads role/status **fresh from Mongo**, applies `?? "user"` / `?? "active"` because `.lean()` skips schema defaults, and fails closed when no row exists. `assertNotSelf` and `assertNotLastActiveAdmin` (`:49`, `:63`) prevent self-lockout. Suspension is enforced at the token layer too — `firebaseAdmin.auth().updateUser(uid, { disabled: true })` + `revokeRefreshTokens` (`app/api/admin/users/[uid]/route.ts:124-125`). This is good work.

Gaps:

- **MEDIUM — `promote` has no `assertNotSelf`/no second-person check** (`app/api/admin/users/[uid]/route.ts:104-108`). One compromised admin session silently mints unlimited admins. Fix (S): require the promotion to be logged with a distinct `admin.promote` event *and* consider a two-admin or env-pinned approval for promote.
- **MEDIUM — `ADMIN_EMAILS` bootstrap promotes on every verified login** (`lib/auth-user-sync.ts:98-100`). The trust root is "controls a verified mailbox on the list", which is defensible, but: the promotion is silent (only a generic `login` activity is recorded, `:168`), and a stale/typo'd/lapsed-domain address stays a live backdoor forever. Fix (S): log an explicit `admin.bootstrap` event when `rolePatch` is non-empty; empty `ADMIN_EMAILS` in production once the first admin exists.

### 1.3 The HS256 session token — remove it

`signSessionToken` mints a 7-day HS256 JWT (`lib/server/session-token.ts:29-37`) that is returned to the client and stored in a cookie (`modules/UserSessionManager.ts:52-60`). **Nothing verifies it** — grep confirms `signSessionToken` has no `verify` counterpart anywhere; `requireUser` reads only the Firebase Bearer token.

Real risk assessment: **LOW as an auth bypass** (there is no verifier to trick), but it is not harmless:
1. `JWT_SECRET` is a **hard runtime dependency of every login** — `getJwtSecret()` throws when unset (`lib/server/session-token.ts:16-22`), the throw lands in the route's catch, and both `/api/auth/session` and `/api/auth/google` return a bare 500. A missing env var takes down all sign-in with no diagnostic. See 7.4.
2. It trains the next engineer to think there is a session layer, which is exactly how a "just verify the session token instead, it's cheaper" refactor becomes a real bypass.

**Fix (S, HIGH): delete `lib/server/session-token.ts`, the `sessionToken` field in both auth responses (`app/api/auth/session/route.ts:46`, `app/api/auth/google/route.ts:31`), the cookie in `UserSessionManager`, and `JWT_SECRET` from `.env.sample`.** If a response-shape guarantee is needed, return `sessionToken: null` for one release.

### 1.4 XSS in `lib/invoice-export.ts` — every interpolation audited

The exported HTML is opened as a **blob URL**, and a blob URL inherits the creating document's origin (`components/InvoiceModal.tsx:73-76`). So a single escaping miss here is not "XSS in a downloaded file" — it is script execution on the app origin, with read access to the auth cookies described in 1.6. The escaping deserves the scrutiny; it currently holds.

Interpolation-by-interpolation (`lib/invoice-export.ts`):

| Line | Value | Wrapper | Verdict |
|---|---|---|---|
| 72 | `index + 1` | none | safe (number) |
| 74 | `toSafeValue(item.name)` | escaped | safe |
| 75 | `item.quantity` | **none** | schema-typed `Number` (`models/Invoice.ts:66`), Mongoose casts on write → safe **in practice**; see LOW below |
| 76, 77 | `formatCurrency(...)` | escaped | safe |
| 88, 339 | `invoiceNumber` | `toSafeValue` | safe |
| 323 | `logoUrl` in `src="…"` | `toSafeImageUrl` (protocol allowlist + `escapeHtml`, `:36-52`) | attribute quotes are escaped → safe |
| 329, 352 | `companyName` | `toSafeValue` | safe |
| 330, 353 | `companyAddress` | `toLineBreaks` (escapes first, then injects `<br />`, `:22-24`) | safe — order is correct |
| 331, 332, 354 | `companyEmail`, `companyPhone` | `toSafeValue` | safe |
| 341, 343, 420 | formatted dates | escaped | safe |
| 344 | `status` (`getInvoiceStatus`) | **none** | value comes from the schema enum (`models/Invoice.ts:77-81`) and the API allowlist → safe in practice; see LOW below |
| 360-362 | `billTo`, `billToAddress`, `billToEmail` | `toSafeValue` / `toLineBreaks` | safe |
| 390 | `row.label` | **none** | six hardcoded literals in `lib/invoice-domain.ts:112-119` → safe |
| 391 | amount | escaped | safe |
| 404, 409, 414 | `terms`, `paymentInfo`, `notes` | `toLineBreaks` | safe |

**Conclusion: no exploitable XSS today.** Findings:

- **LOW — three unescaped interpolations rely on invariants held elsewhere** (`:75` quantity, `:344` status, `:390` label). They are correct only because Mongoose enum/Number casting holds. A raw `updateOne`, an import script, or a schema relaxation breaks them silently. Fix (S): wrap them — `${escapeHtml(String(item.quantity))}`, `${escapeHtml(status)}`, `${escapeHtml(row.label)}`. Zero behavior change, removes the invariant dependency.
- **MEDIUM — `toSafeImageUrl` allows `data:`** (`lib/invoice-export.ts:44`). `data:` in `<img src>` cannot execute script (SVG loaded via `<img>` is unscripted), so this is not XSS, but it lets an arbitrary-size blob be stored inside an invoice document (see 3.5) and rendered. Fix (S): drop `data:` from the allowlist, or additionally require `data:image/(png|jpeg|gif|webp);base64,` and cap the length.
- **LOW — mixed content**: `http:` is allowed (`:44`), so an https-served invoice can load an http logo, which browsers block and which downgrades the print output. Fix (S): allow `https:` only.

### 1.5 CSV injection — correct in both exporters

`neutralizeCsvValue` prefixes `= + - @ \t \r` with `'` and every cell is quoted with doubled internal quotes — `lib/invoice-export.ts:29-33`, `:466-476`, and the mirrored implementation for admin bulk exports at `lib/server/admin-export.ts:9-25`. Covered by `tests/invoice-export.test.ts`. No finding beyond duplication (LOW, cosmetic).

### 1.6 Secrets handling — the worst finding in the file

**BLOCKER (B4) — long-lived Firebase credentials are persisted in MongoDB.**
`updatePayload` writes `accessToken: idToken` and `refreshToken: nextRefreshToken` into the `User` document on every login — `lib/auth-user-sync.ts:142-143`, backed by schema fields `models/User.ts:28-29`. A Firebase **refresh token does not expire**; it can be exchanged for ID tokens indefinitely until explicitly revoked. So an Atlas breach, a leaked connection string, a misconfigured IP allowlist, or a rogue `mongodump` is a **complete, silent, permanent takeover of every user account** — not merely a data disclosure.

Nothing in the app reads these fields back (grep: they are only written, and projected *out* of every admin read — `app/api/admin/users/route.ts:59`, `.../[uid]/route.ts:38`, `export/users/route.ts:30`). They are pure liability.

Fix (S): delete both fields from `models/User.ts`, stop writing them in `lib/auth-user-sync.ts:142-143`, stop returning them from the auth routes, and run a one-off `$unset` over the existing collection. **Do this before opening signups.**

**HIGH — the same tokens are also written into JS-readable cookies.** `UserSessionManager` sets `access-token`, `refresh-token`, `session-token` via `js-cookie` (`modules/UserSessionManager.ts:35`, `:46`, `:57`). `js-cookie` cannot set `httpOnly`, so any XSS reads them. `secure` + `sameSite: Strict` are set, which is good but orthogonal. The Firebase SDK already persists its own session in IndexedDB; these cookies are redundant. Fix (S): stop storing `access-token`/`refresh-token` client-side, read the current token from `auth.currentUser.getIdToken()` (which `lib/api-client.ts` already does).

**Positive:** the Gemini API key is passed in the request query string (`lib/ai/invoice-assistant/provider.ts:110`) — necessary for the REST endpoint — and the telemetry path deliberately never carries the request URL (`:150-151`), with a second-line `key=` scrubber in the log writer (`lib/server/log.ts:62-66`). Sensitive keys are redacted by regex before any log write (`lib/server/log.ts:45-46`, `:79-82`). That is careful, correct work.

### 1.7 Error responses leak internals

**BLOCKER (B9)** — `/api/invoices` returns the raw exception message to the client on every 500: `{ error: "Internal Server Error", details: err.message }` at `app/api/invoices/route.ts:212`, `:267`, `:339`, `:437`. Mongo errors carry collection names, index names, validation internals, and occasionally fragments of the connection topology. Every other route in the app already returns a bare `{ error: "Internal Server Error" }` (e.g. `app/api/feedback/route.ts:99`), so this is an outlier, not a convention. Fix (S): delete the `details` field; the error is already captured by `logRouteError`.

**LOW** — the AI route classifies provider failures into user-facing copy that names server-side configuration ("Check Gemini quota/billing", "Verify `GEMINI_API_KEY`, API enablement, and billing") — `app/api/ai/invoice-assistant/route.ts:33`, `:47`, `:73`. It tells an attacker exactly which vendor and which failure mode. Fix (S): keep the status codes, make the copy user-facing ("The assistant is unavailable right now").

### 1.8 Input validation

Reasonable and centralized: `validateInvoice` is shared by client and server (`lib/invoice-domain.ts:137`), money is clamped at three layers (`clampToLimit`, `MAX_ITEM_*`), and the server recomputes every total rather than trusting the client (`app/api/invoices/route.ts:116-128`). AI model output is hard-validated separately (`lib/ai/invoice-assistant/normalization.ts`). Findings:

- **MEDIUM — no length caps on invoice free-text fields.** `cleanString` only trims (`app/api/invoices/route.ts:92`). `notes`, `terms`, `paymentInfo`, `companyAddress`, item `name`, and `companyLogo` accept anything up to Mongo's 16 MB document limit, and there is **no cap on the number of line items** (`normalizeItems`, `:96-110`). One request can write a ~16 MB document; a loop of them fills a 512 MB M0 in ~30 requests. Fix (S): cap each string (e.g. 2 000 chars, 200 for `invoiceNumber`, 500 for URLs) and cap `items.length` at ~200, in `normalizePayload`.
- **MEDIUM — no body size limit on any route.** Only `/api/events` checks `content-length` (`app/api/events/route.ts:63`). Fix (S): check `content-length` in `normalizePayload`'s callers, or add the check to a shared helper.
- **LOW — no email-format validation** on `companyEmail`/`billToEmail`/`billTo`; harmless today but becomes a delivery-failure and header-injection surface the moment email sending exists (section 6).

### 1.9 Headers / CORS / CSP

**BLOCKER (B8)** — `next.config.ts` (whole file, 22 lines) defines only `serverExternalPackages` and `images.remotePatterns`. There is no `async headers()`, and there is **no `middleware.ts` anywhere in the repo**. Therefore the app ships with:

- no `Content-Security-Policy` (the one control that would contain a future escaping miss in 1.4)
- no `Strict-Transport-Security` (Vercel serves HSTS on `*.vercel.app`, but not necessarily on a custom apex domain — verify after DNS cutover)
- no `X-Frame-Options` / `frame-ancestors` → the app is **clickjackable**; an attacker can iframe `/create-invoice` or the admin panel
- no `X-Content-Type-Options: nosniff`
- no `Referrer-Policy` → full URLs (including `/create-invoice/<invoiceId>`) leak to any third-party host the page touches, including a user-supplied `companyLogo` host
- no `Permissions-Policy`

CORS: no `Access-Control-Allow-Origin` is set anywhere, so the browser default (same-origin only) applies — that part is fine, and there is no wildcard to remove.

Fix (S): add `async headers()` to `next.config.ts` returning, for `/(.*)`: `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`, and a CSP. The CSP needs care: `THEME_INIT_SCRIPT` is an inline `beforeInteractive` script (`app/layout.tsx:38-40`) so it needs a nonce or hash, and `img-src` must allow `https:` (or `blob: data:` if 1.4's `data:` allowance is kept) for user logos. Start in `Content-Security-Policy-Report-Only` for a week.

### 1.10 SSRF / `companyLogo` abuse

There is **no SSRF**: the server never fetches `companyLogo`. It is stored as a string (`app/api/invoices/route.ts:139`) and rendered by the browser — with the protocol allowlist in the export (`lib/invoice-export.ts:36-52`) but with **no filtering at all in the two in-app previews**, which use a raw `<img src={invoice.companyLogo}>` (`components/InvoiceEditor.tsx:1069`, `components/InvoiceModal.tsx:219`). Neither goes through `next/image`, so the `remotePatterns` allowlist in `next.config.ts:8-19` does not apply here.

- **MEDIUM — tracking / IP-disclosure vector.** An invoice shared with a client (or opened by an admin in the admin panel) fetches an attacker-chosen URL, disclosing the viewer's IP, UA, and — absent `Referrer-Policy` — the invoice URL. Fix (S): route both previews through `toSafeImageUrl` (already written and tested), add `referrerPolicy="no-referrer"` and `crossOrigin="anonymous"` on the `<img>`, and pin `img-src` in the CSP.
- **LOW — no size/type validation** on the logo URL; a 40 MB "logo" hangs the print view. Section 6.3 recommends replacing URL-entry with real uploads to object storage, which resolves this class entirely.

### 1.11 Auth-mint routes

`/api/auth/session` and `/api/auth/google` correctly gate unverified password accounts before touching the DB (`app/api/auth/session/route.ts:29-37`) and the account-linking rule is genuinely well-built: linking by email happens **only** when `email_verified` (`lib/auth-user-sync.ts:91`, `:102-104`), which closes the `Invoice.updateMany` reassignment (`:150-153`) as a takeover path. It has a regression test (`tests/auth-user-sync.test.ts`). Good.

- **MEDIUM — both mint routes call `verifyIdToken(idToken)` without `checkRevoked`** (`app/api/auth/session/route.ts:24`, `app/api/auth/google/route.ts:17`), unlike the data path (`lib/server/auth.ts:78`). A suspended/disabled user can therefore still hit these routes and rewrite their own `User` row (`lastLoginAt`, `providerIds`, tokens) until their ID token expires (≤1 h). They cannot read data and cannot un-suspend themselves (`status` is deliberately kept out of `updatePayload`), so impact is low — but it is an inconsistency in exactly the place inconsistencies get exploited. Fix (S): pass `true`.
- **HIGH — these are the only unauthenticated-reachable routes and they are unthrottled.** Each does a `connectDB()` + a Firebase token verification + a Mongo write. See 2.1.

---

## 2. Abuse and cost control

### 2.1 Rate limiting — your belief is correct, with a nuance

Grep across `app/ lib/ components/ models/ modules/ next.config.ts vercel.json` finds exactly **two** limiters, both in-memory `Map` buckets:

- `app/api/events/route.ts:19-33` — 30/min per uid
- `app/api/feedback/route.ts:12-25` — 10 per 10 min per uid

**These do not work on Vercel.** Each serverless invocation gets its own module instance; the `Map` lives in one lambda's heap. With N warm instances the effective limit is N × the constant, and a burst that triggers scale-out is effectively unlimited. They are also an **unbounded memory leak**: nothing ever evicts expired buckets from `buckets` (neither file has a sweep), so a long-lived instance grows one entry per distinct uid forever.

Everything else has **no limiting whatsoever**:

| Route | Auth | Limit | Cost of one abusive loop |
|---|---|---|---|
| `POST /api/ai/invoice-assistant` | verified user | **none** | Gemini spend, unbounded (2.2) |
| `POST /api/invoices` | verified user | **none** | Mongo writes + storage (2.3) |
| `GET /api/invoices` | verified user | **none** | full unpaginated table scan-out (2.4) |
| `PUT/PATCH /api/invoices` | verified user | **none** | Mongo writes |
| `POST /api/auth/session`, `/api/auth/google` | **unauthenticated** | **none** | Firebase Admin verify + Mongo write per request |
| `GET /api/admin/export/*` | admin | **none** | 50 000-doc dump per call |
| `GET /api/cron/keep-alive` | `CRON_SECRET` if set, else **open** | **none** | one `estimatedDocumentCount` |

**BLOCKER (B1). Fix (M):** a single shared limiter helper, checked before `connectDB()` in every route, keyed by uid for authed routes and by `x-forwarded-for` for the auth-mint routes. Suggested budgets: AI 20/hour and 100/day per uid; invoice writes 60/hour; invoice reads 300/hour; auth-mint 20/hour per IP.

Concrete options for Vercel serverless (pricing in section 9):
1. **Upstash Redis + `@upstash/ratelimit`** — the standard answer. Sliding-window, works from any region, ~5-15 ms added latency from `bom1`/`sin1` if the Redis is in Mumbai/Singapore. Free tier covers a launch comfortably. **Recommended.**
2. **Vercel KV** — now Upstash-backed and resold by Vercel; same engine, simpler billing, slightly worse price. Fine if you want one vendor.
3. **Firebase App Check** (attestation, not rate limiting) — orthogonal and worth adding *as well*: it stops non-browser clients from calling your API at all, which removes the cheapest abuse path. Free. Enforce it on `/api/ai/*` first.
4. **Vercel WAF / Firewall rate rules** — path-level request-per-IP rules configured in the dashboard, no code. Weak (IP-keyed, not uid-keyed) but a good outer layer and free on all plans for basic rules. **Do this on day one as a stopgap** while the Redis limiter is built.

Also add: a `maxDuration` and a `runtime` declaration per route, and set `export const dynamic = "force-dynamic"` consistently (only `keep-alive` does today, `app/api/cron/keep-alive/route.ts:7`).

### 2.2 The Gemini endpoint is the sharpest cost edge

**The caps in `service.ts` are per-request, not per-user, and they miss the biggest field.**

`validateAssistantRequest` (`lib/ai/invoice-assistant/service.ts:20-48`) caps:
- `message` at 4 000 chars (`:13`, `:17`)
- `conversation` at 12 entries, each ≤ 4 000 chars (`:14`, `:32-41`)

But `draft` is accepted with **only** `typeof payload.draft === "object"` (`:28-30`) and then cast (`:46`). It is serialized wholesale into the prompt — `JSON.stringify({ ...draft, ... }, null, 2)` at `lib/ai/invoice-assistant/prompt.ts:83-93`. There is **no size cap, no field whitelist, and no item-count cap on `draft`.**

Consequence: a single authenticated request can carry a multi-megabyte `draft` and have it billed as input tokens against your Gemini key. Gemini 2.5 Flash accepts ~1 M input tokens, so the ceiling per request is roughly a full context window, and requests can be issued concurrently. There is **no per-user counter, no daily budget, no circuit breaker** anywhere — `generateInvoiceAssistantResponse` (`:55-62`) calls the provider unconditionally.

The only protections that exist are a 20 s client timeout (`lib/ai/invoice-assistant/provider.ts:12`) and `maxOutputTokens: 2048` (`:128`) — both cap *latency and output*, neither caps *input* or *volume*.

**BLOCKER (B2). Fix (S for the cap, M for the quota):**
1. In `validateAssistantRequest`, whitelist `draft` to the known `InvoiceFormState` keys, cap each string at ~2 000 chars, cap `items` at ~50, and reject if `JSON.stringify(draft).length > 20_000`. (S)
2. Add a per-uid daily counter (the same Redis from 2.1) — e.g. 30 AI calls/day free — returning 429 with copy the UI already knows how to render.
3. Add a **global kill switch + daily budget** env var (`AI_DAILY_CALL_BUDGET`) checked before the provider call, so a novel abuse path costs a bounded amount.
4. Set a hard spend cap on the Google Cloud billing account for the Generative Language API, and a budget alert at 50 %/90 %. This is the only control that is enforced by someone other than you.

Also: **every AI request writes a log document of up to 32 KB** (see 2.5) — the assistant is simultaneously your biggest external-spend and biggest storage-growth vector.

### 2.3 Unbounded invoice creation

`POST /api/invoices` has no per-user invoice cap and no rate limit. Combined with the missing string-length caps (1.8), one account can write documents approaching Mongo's 16 MB limit. On a 512 MB M0 that is roughly **30 requests to exhaust the cluster's storage**, at which point *all* writes fail for *all* users. Even with modest documents, an unattended loop fills M0 in minutes.

**HIGH. Fix (S):** field-length caps + item-count cap (1.8), a per-user invoice count ceiling on the free plan (e.g. 500), and the write rate limit from 2.1.

### 2.4 The unpaginated user-facing list

`GET /api/invoices` returns **every** non-deleted invoice for the user, full documents, no `limit`, no projection, no cursor — `app/api/invoices/route.ts:194-198`. The compound index `{ userId, is_deleted, createdAt }` (`models/Invoice.ts:90`) makes the *lookup* efficient, but the response size is O(user's lifetime invoices) and every document carries full `items`, `notes`, `terms`, and a possibly-`data:`-URI `companyLogo`.

A power user with 5 000 invoices pulls a multi-MB JSON payload on every dashboard load. That is Vercel egress, Atlas egress, lambda memory, and client parse time, all per page view.

**HIGH. Fix (M):** paginate with a `createdAt`/`_id` cursor (the existing index serves it), add a projection for the list view (`invoiceNumber, billTo, total, currency, status, invoiceDate, dueDate, createdAt`), and fetch the full document only on open. The admin side already has `parsePagination` (`lib/server/pagination.ts:11`) and `lib/hooks/use-server-table.ts` — reuse both.

### 2.5 Log growth — TTL exists, volume does not

**Good news:** `models/LogEntry.ts:43` has a real per-document TTL index (`{ expireAt: 1 }, { expireAfterSeconds: 0 }`) with a sensible retention map in `lib/server/log.ts:33-43` (errors/admin 365 d, warn 90 d, ai/client 30 d, auth/invoice info 180 d). This is better than most projects this size. Writes are fire-and-forget through `after()` and can never fail a request (`lib/server/log.ts:127-141`) — also good, and tested (`tests/log-swallow.test.ts`).

**Bad news — the volume is the problem, not the retention:**

- **Two log documents per AI call** (`app/api/ai/invoice-assistant/route.ts:97-122`), and the first embeds `fullPrompt: telemetry.userPrompt` — the entire prompt including the user's whole draft. Capped at 16 000 chars per string and 32 768 bytes per `meta` (`lib/server/log.ts:47-48`, `:96-101`), so the ceiling is **~32 KB per AI request**. **~16 000 AI requests fills a 512 MB M0**, and the ai-category TTL is 30 days — comfortably longer than an attacker needs. This is a denial-of-service on your entire database via a feature that has no rate limit.
- Error logs store full stack traces (`lib/server/log.ts:214`) with 365-day retention. A crash loop under a real incident is exactly when you least want unbounded log writes into the same cluster that is failing.
- Log writes go to **the same M0 cluster as the business data**, so they consume the same 512 MB, the same connection pool, and the same IOPS.

**HIGH. Fixes:**
- (S) Stop persisting `fullPrompt`, or truncate it to ~500 chars, or store only a hash + length. It is a per-request 16 KB write of user-typed business data, kept 30 days — also a privacy question under DPDP (section 8).
- (S) Drop `stack` to the first ~2 000 chars.
- (M) Move logs off the primary cluster once you leave the free tier, or off Mongo entirely (section 4.5).
- (S) Add an `expireAt` sanity monitor — a TTL index only runs every 60 s and silently does nothing if the field is ever missing; `expireAt` is `required` (`models/LogEntry.ts:38`) which protects this today, but any direct insert bypassing the writer would leak.

### 2.6 `/api/cron/keep-alive`

`app/api/cron/keep-alive/route.ts:21-48`. Correct in shape: it checks `CRON_SECRET` when set (`:22-28`) and does one O(1) `estimatedDocumentCount` (`:34`). Two findings:

- **MEDIUM — it is open when `CRON_SECRET` is unset**, and `.env.sample:34` marks the variable "Optional but recommended". An open endpoint that opens a DB connection is a free amplification primitive: each hit costs you a connection from the M0 pool (see 3.1). Fix (S): make it required — fail closed with 401 when the env var is missing, rather than open.
- **LOW — once a day is fragile for its stated purpose.** `vercel.json:6` schedules `0 6 * * *`. Atlas pauses M0 clusters after ~60 days of *no connections*, so daily is more than enough for that; but the schedule is also the only thing keeping a warm connection, and it does nothing for the connection-storm problem in 3.1. Note also that Vercel's Hobby plan permits cron jobs only at daily granularity — if you need finer, that is a Pro-plan requirement.

### 2.7 `/api/events`

`app/api/events/route.ts` is genuinely well-built for a low-trust beacon: uid from the token not the body (`:58`), event allowlist (`:79-82`), per-event meta whitelist with an ObjectId regex (`:35-53`), body size check (`:63`), silent 204 for probes. The only flaw is that its rate limiter is the ineffective in-memory kind (2.1) — which matters because **each accepted event is a Mongo write**, so it is an unmetered write amplifier: 1 HTTP request → 1 log document. Fix (S): move to the shared Redis limiter.

### 2.8 Firebase Auth abuse

Not code, but in scope: signup is open, `/api/auth/session` is unauthenticated, and there is no App Check, no bot protection, and no CAPTCHA on the auth page. Firebase's own per-project quotas will absorb a lot, but a signup flood creates junk `User` rows in your M0 forever (there is no cleanup path for unverified accounts). **MEDIUM. Fix (S):** enable Firebase App Check + reCAPTCHA Enterprise on sign-up (free tier available), and add a scheduled job that deletes `User` rows whose Firebase account is still unverified after 30 days.

---

## 3. Scale and the data layer

### 3.1 `lib/mongodb.ts` — the connection handling

```
const connectDB = async () => {
  if (mongoose.connection.readyState >= 1) return;      // lib/mongodb.ts:26
  await mongoose.connect(MONGODB_URI, { dbName: "invoicey" });  // :29
}
```

Three distinct problems, in ascending order of severity:

**(a) No cached connection promise (the documented deferral).** `readyState >= 1` covers `connected(1)`, `connecting(2)` and `disconnecting(3)`. Two concurrent requests inside the *same* lambda during a cold start both see `2` and both return immediately without awaiting; their queries then rely on Mongoose's command buffering (`bufferTimeoutMS` default 10 s) to survive. This mostly works — until a connect attempt is slow, at which point every buffered query in that instance fails together with an opaque `MongooseError: Operation buffered timed out after 10000ms`, which the routes surface as a 500 with the raw message (1.7). During `disconnecting(3)` the guard is outright wrong: it returns "connected" for a connection that is going away.

**(b) `maxPoolSize` is not set — this is the real M0 killer.** The Node driver's default `maxPoolSize` is **100 per `MongoClient`**, and each warm Vercel lambda instance holds its own Mongoose singleton, hence its own pool. Atlas M0 allows **500 connections total** (UNVERIFIED — confirm on the Atlas cluster limits page). So the arithmetic is: **five simultaneously-busy lambda instances can legally open 500 connections and lock every other request out of the database**, including the admin panel you would use to diagnose it. In practice pools grow on demand so you will not see this at 100 users — you will see it the first time a burst (a marketing post, a crawler, a retry storm) fans out.

**(c) No `serverSelectionTimeoutMS` / `connectTimeoutMS` / `socketTimeoutMS`.** Defaults are 30 s server-selection, which is longer than most Vercel function limits — so when Atlas is unreachable the function times out at the platform level instead of returning a clean 503, and you burn full-duration GB-seconds on every failed request.

**BLOCKER (B3). Fix (S)** — a ~15-line change:

```ts
// module-scope, survives warm invocations
let cached: Promise<typeof mongoose> | null = null;
const connectDB = async () => {
  if (mongoose.connection.readyState === 1) return;
  if (!cached) {
    cached = mongoose.connect(MONGODB_URI, {
      dbName: "invoicey",
      maxPoolSize: 5,             // per lambda instance
      minPoolSize: 0,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 20000,
      maxIdleTimeMS: 60000,       // let idle sockets die with the instance
    }).catch((err) => { cached = null; throw err; });   // do not cache a failure
  }
  await cached;
};
```

`maxPoolSize: 5` with 500 M0 connections gives headroom for ~100 concurrent instances. Also set `retryWrites=true` in the URI (default in modern drivers, but verify it is present).

### 3.2 Index coverage — per query

Checked every query in `app/api/**` against `models/*.ts`.

**Covered (good):**

| Query | Index |
|---|---|
| `Invoice.find({userId, is_deleted}).sort({createdAt:-1})` (`app/api/invoices/route.ts:194`) | `{userId,is_deleted,createdAt}` `models/Invoice.ts:90` |
| `Invoice.findOne({_id, userId, is_deleted})` (`:183`, `:295`, `:367`) | `_id` |
| `Invoice.aggregate` invoices-over-time (`app/api/admin/overview/route.ts:86`) | `{is_deleted,createdAt}` `models/Invoice.ts:95` |
| status breakdown / revenue-by-currency (`overview:96`, `:65`) | `{is_deleted,status,currency}` `models/Invoice.ts:96` |
| `invoiceRollupForUsers` `$in` on userId (`lib/server/admin-data.ts:60`) | `{userId,is_deleted,…}` |
| `User.findOne({uid})` (`lib/server/admin.ts:33`) | unique `uid` |
| `User.countDocuments({role,status})` (`lib/server/admin.ts:77`) | `{role,status}` `models/User.ts:41` |
| `User.aggregate` signups-over-time (`overview:76`) | `{createdAt}` `models/User.ts:45` |
| all `LogEntry` filtered reads (`admin/logs`, `admin/activity`, `overview`) | `{at}`, `{userId,at}`, `{category,at}`, `{level,at}`, `{event,at}` `models/LogEntry.ts:45-49` |
| `Feedback` by status / by user (`admin/feedback`, `api/feedback:113`) | `models/Feedback.ts:33-35` |

**Not covered — five findings:**

1. **HIGH — `Invoice.find({}).sort({createdAt:-1}).limit(50001)`** in the admin invoice export (`app/api/admin/export/invoices/route.ts:29-32`). With an empty predicate, `{is_deleted:1, createdAt:-1}` cannot supply the sort order (a compound index only orders by its second key *within* an equality on the first). So this is a collection scan plus a blocking in-memory sort, and **MongoDB's sort memory limit is 32 MB without `allowDiskUse`**. At ~1 KB/invoice the export starts failing outright somewhere around 30 000-50 000 invoices — i.e. it is designed to break exactly at the cap it was written to honour. Fix (S): add `.sort({ _id: -1 })` (uses the `_id` index, is monotonic with insertion time), or add a standalone `{createdAt: -1}` index, or stream with a cursor.
2. **MEDIUM — `Invoice.countDocuments({ is_deleted: { $ne: true } })`** (`app/api/admin/overview/route.ts:61`). `$ne` is non-selective; this is a full index scan on every admin dashboard load. At 1 M invoices it is seconds. Fix (S): store `is_deleted: false` explicitly on every document (the schema already defaults it, `models/Invoice.ts:82`) and query `{is_deleted: false}`, or accept `estimatedDocumentCount` for the headline number.
3. **MEDIUM — admin user search is a collection scan.** `filter.$or = [{email: rx}, {name: rx}]` with an unanchored case-insensitive regex (`app/api/admin/users/route.ts:41-42`). The `email` unique index cannot serve a non-anchored `/x/i`, and there is **no index on `name` at all**. Fine at 10 k users, painful at 1 M. Fix (S): add a text index or an `{name: 1}` index and anchor the regex (`^`), which lets the index be used.
4. **MEDIUM — `distinctActiveUsers` scans every log document in the window, three times per admin dashboard load** (`app/api/admin/overview/route.ts:22-29`, called for 1 d/7 d/30 d at `:62-64`). `$addToSet` into a single `$group` bucket has a 100 MB in-memory limit without `allowDiskUse`. The set itself stays small (one entry per uid), but the *scan* is every log doc in 30 days — which, given 2.5's AI-log volume, is the single most expensive query in the app. Fix (M): precompute DAU/WAU/MAU into a small daily rollup collection via the existing cron, and read the rollup.
5. **LOW — the admin overview fires 12 aggregations in one `Promise.all`** (`app/api/admin/overview/route.ts:46-115`), i.e. 12 simultaneous connections from one request. On an M0 that is a meaningful fraction of the (shared, throttled) capacity, triggered by a page load. Fix (S): sequence them in two or three batches, and cache the response for 60 s.

### 3.3 What breaks first — at 100 / 1 000 / 10 000 active users

Model used: an active Indian SMB user creates ~20 invoices/month, loads the dashboard ~30×/month, uses the AI assistant on ~30 % of invoices. Invoice document ≈ 3-5 KB. AI log document ≈ up to 32 KB (2.5), realistically ~8-16 KB.

**100 active users**

| Metric | Value |
|---|---|
| Invoices/mo | 2 000 |
| Invoice storage/mo | ~8 MB |
| AI calls/mo | ~600 |
| Log storage/mo | ~15 MB (AI prompt logs dominate) |
| Peak req/s | < 2 |
| Total DB growth | ~25 MB/mo → M0's 512 MB lasts ~18 months |

Nothing technical breaks. **What breaks first is non-technical**: the missing privacy policy/terms (8.1), the absence of any account-deletion path (5.3), no backups (5.1), and — verify this — **Vercel's Hobby plan forbids commercial use**, so a paid-or-not public product must be on Pro from day one.

**1 000 active users**

| Metric | Value |
|---|---|
| Invoices/mo | 20 000 |
| Invoice storage/mo | ~80 MB |
| AI calls/mo | ~6 000 → 12 000 log docs |
| Log storage/mo | ~100 MB |
| Total DB growth | **~180 MB/mo** |

**First failure: M0 storage, in roughly 10-12 weeks** — and the AI prompt logs are more than half of it (2.5). Storage exhaustion on Atlas is not graceful; writes start failing and the app has no user-visible handling for it (a 500 with a raw Mongo message, 1.7).

Second failure, close behind: **the unpaginated list** (2.4). A one-year-old account has ~240 invoices ≈ 1 MB of JSON on every dashboard load; 30 000 loads/month ≈ 30 GB of egress from both Vercel and Atlas (Atlas shared tiers have a monthly data-transfer allowance — UNVERIFIED, but 10 GB/period is the commonly cited M0 figure, so you would exceed it).

Third: **connection spikes**. 1 000 users is enough concurrency for Vercel to hold 10-30 warm instances; without `maxPoolSize` (3.1b) a burst can approach the 500-connection ceiling.

**10 000 active users**

| Metric | Value |
|---|---|
| Invoices/mo | 200 000 |
| Invoices/yr | 2.4 M |
| DB growth | ~1.8 GB/mo → **M10 (10 GB) is a 6-month cluster; plan M20/M30** |
| Peak req/s | ~100-200 |
| Concurrent lambda instances | 50-200 |

Failures, in the order they arrive:
1. **Connection exhaustion.** 100 instances × default pool 100 = 10 000 connections against an M10's ~1 500 limit (UNVERIFIED). Hard wall. Fixed only by 3.1b.
2. **Egress and response size** from the unpaginated list — hundreds of GB/month, and the client-side JSON parse becomes the dashboard's slowest step.
3. **The admin panel becomes unusable**: 12 aggregations over millions of log docs per page load (3.2 #4/#5), and the invoice export hits the 32 MB sort limit (3.2 #1).
4. **AI spend** becomes a real line item — and is still uncapped per user (2.2).
5. `countDocuments({$ne})` on 2.4 M documents (3.2 #2) makes the admin dashboard take seconds.

**The sequencing that matters:** every one of these is a *known* deferral with a small fix. The dangerous one is 3.1b, because it fails suddenly and globally rather than degrading.

---

## 4. Reliability and observability

### 4.1 Route-handler error handling

Consistent and mostly good. Every route wraps its body in try/catch, returns a JSON error with a deliberate status, and calls `logRouteError` (which by contract cannot throw). Cast errors are translated to 400 rather than 500 (`app/api/invoices/route.ts:161-164`, `:200-202`). The AI route has a genuinely thoughtful provider-error classifier mapping quota→429, bad key→503, timeout→504, bad JSON→502 (`app/api/ai/invoice-assistant/route.ts:21-78`).

Findings:

- **HIGH — `await connectDB()` sits *outside* the try/catch in five handlers.** `app/api/invoices/route.ts:176`, `:226`, `:281`, `:353`, and `app/api/feedback/route.ts:35`, `:111`. When Mongo is unreachable, `connectDB` rethrows (`lib/mongodb.ts:38`) and the throw escapes the handler entirely — Next returns its own opaque 500, **`logRouteError` never runs, so the outage is not recorded in the very system built to record it**, and the client gets an HTML error page rather than the `{error}` JSON its parser expects (`lib/api-client.ts:171`). Fix (S): move `connectDB()` inside the try and return a 503 with retry copy.
- **MEDIUM — no timeouts or retries around Mongo operations.** Combined with 3.1c (30 s default server selection), a partial Atlas outage means every request burns the full function duration before dying. Fix (S): the driver options in 3.1.

### 4.2 Behaviour when Mongo is down

Blast radius: everything. `connectDB()` is called by every data route, **and by the log writer itself** (`lib/server/log.ts:110`). So during a Mongo outage:
- data routes 500 (with a raw driver message leaked to the client, 1.7),
- login fails (`/api/auth/session` calls `connectDB()` first, `app/api/auth/session/route.ts:15`),
- **logging fails silently** — `logEvent` swallows the write error to `console.error` (`lib/server/log.ts:129-131`), which on Vercel goes to runtime logs that are retained ~1 day on Hobby / ~3 days on Pro (UNVERIFIED) and are not alerted on,
- the admin panel, which is your only dashboard, is also down.

**BLOCKER (B10) restated:** *the observability system's storage is the thing most likely to fail.* Fix in 4.5.

The one bright spot: `connectDB` no longer calls `process.exit(1)` (`lib/mongodb.ts:33-39`), so one blip does not kill in-flight requests. Good call.

### 4.3 Behaviour when Gemini is down

Well handled. 20 s `AbortController` timeout (`lib/ai/invoice-assistant/provider.ts:104-105`, `:162-164`), errors classified into distinct statuses (`app/api/ai/invoice-assistant/route.ts:21-78`), and the assistant is non-essential — the editor works without it, and the panel only renders in create mode. No retry/backoff, which is correct here (a retry on a 20 s timeout would exceed the function budget). The only issue is the copy leaking configuration detail (1.7 LOW).

### 4.4 Error boundaries

Present: `app/global-error.tsx` (self-contained, inlines its own critical CSS with a `prefers-color-scheme` fallback so a CSS-load failure does not black-screen the user — genuinely well done), `app/dashboard/error.tsx`, `app/admin/error.tsx`. `app/admin/loading.tsx` exists.

Findings:
- **MEDIUM — all three boundaries only `console.error`** (`app/global-error.tsx:115`, `app/dashboard/error.tsx:14`, `app/admin/error.tsx:11`). Nothing is reported anywhere. A user hitting a render crash produces zero server-side signal — the `digest` shown to them (`global-error.tsx:141`) cannot be looked up because nothing indexes it.
- **MEDIUM — no boundary on the invoice editor.** `/create-invoice` and `/create-invoice/[id]` are the app's highest-value screens and are covered only by the root boundary, which replaces the whole document and loses unsaved work. Fix (S): add `app/create-invoice/error.tsx` with copy that preserves the user's draft (or at least warns).
- **LOW — no `app/not-found.tsx`.** A mistyped URL gets the default Next 404 with no header/footer/branding.

### 4.5 The logging system

`lib/server/log.ts` + `lib/logs.ts` is a **DB-backed** logger: `writeLog` → `connectDB()` → `LogEntry.create()` (`lib/server/log.ts:109-125`), scheduled through Next's `after()` so it survives the response on serverless (`:137`), with a fallback to a detached write outside a request lifecycle (`:138-140`). Meta is redacted by key regex and size-capped (`:45-48`, `:88-107`). Retention is per-document TTL (2.5). Failure mode: **swallowed to `console.error`** (`:129-131`).

For an internal analytics/audit trail this is a good design. As *production observability* it has three disqualifying properties:

1. It cannot observe its own storage failing (4.2).
2. It has no alerting — nothing pages anyone. `errors24h` is a number on a dashboard a human has to visit (`app/api/admin/overview/route.ts:100`).
3. It is read only through the admin panel, which requires the app and the database to both be up.

**There is no external monitoring of any kind.** Grep found no Sentry, no Datadog, no Logtail/Axiom/BetterStack, no uptime check, no `/api/health` endpoint (the closest is `/api/cron/keep-alive`, which is cron-authenticated and not a health probe), and no status page. `@vercel/analytics` and `@vercel/speed-insights` are installed (`app/layout.tsx:46-47`) but those are product analytics and RUM, not error monitoring.

**Recommended minimal, cheap observability stack (BLOCKER-clearing, size S, ~₹0-1 700/mo):**

| Layer | Tool | Cost | Why |
|---|---|---|---|
| Error tracking (server + client) | **Sentry** free tier (5 k errors/mo, 1 user) | ₹0 | The one non-negotiable. `@sentry/nextjs` wires both runtimes and the `error.tsx` boundaries in one install; it also captures the `digest` so a user-reported reference is searchable. Paid Team tier ≈ $26/mo (UNVERIFIED) when you outgrow it. |
| Uptime + status page | **BetterStack Uptime** free tier / **UptimeRobot** free | ₹0 | Ping a new public `/api/health` (which should check Mongo with a 2 s timeout) every 3-5 min from an India region. Both include a hosted status page on the free tier. |
| Log drain | **Vercel log drain → Axiom or BetterStack** free tier | ₹0-$25 | Vercel runtime logs are ephemeral; a drain makes `console.error` (i.e. every swallowed log-write failure) actually searchable. |
| Spend alarms | Google Cloud budget alert on the Generative Language API; Atlas alerts on connections/storage; Vercel spend management | ₹0 | These are the alerts that protect the wallet, and each is a checkbox. |

Also add (S): a `requestId` per request (the `LogInput` already has the field, `lib/server/log.ts:26`, and nothing ever populates it) propagated into every log line and returned in an `x-request-id` response header, so a user-reported failure is traceable.

---

## 5. Backups and data safety

### 5.1 Atlas free-tier backup reality

**M0 free clusters have no backups.** No continuous cloud backup, no scheduled snapshots, no point-in-time restore — those start at M10 (and PITR is an M10+ paid feature). This is a property of the tier, not a configuration you have missed. (Atlas tier feature matrix — figures UNVERIFIED, confirm on the Atlas pricing page, but the "no backup on shared tiers" rule is long-standing.)

So today, the following are unrecoverable:
- a bad migration (and you have two migration scripts that run manually against `MONGODB_URI` — `scripts/migrate-provider-ids.ts`, `scripts/migrate-tax-to-gst.ts`, both invoked with production credentials from a laptop),
- a dropped collection,
- a `updateMany` with a wrong filter — and note `lib/auth-user-sync.ts:150-153` contains an `Invoice.updateMany` that rewrites `userId` in bulk,
- credential compromise followed by deletion.

**BLOCKER (B5). Fix, cheapest first:**
1. (S, ₹0) A nightly `mongodump` from a GitHub Actions scheduled workflow to a private R2/S3 bucket with object-lock and 30-day lifecycle. ~20 lines of YAML. This is the minimum acceptable state and can ship today.
2. (S, ~$9/mo) Move to **M10** (or M2/M5 if still offered) to get managed snapshots. At 1 000 users you need M10 for storage anyway (3.3), so this is not extra spend, just earlier spend.
3. (S) Restrict the Atlas IP allowlist to Vercel's egress ranges (Pro/Enterprise static IPs) rather than `0.0.0.0/0`, and create a separate least-privilege DB user for the migration scripts. **Verify the current allowlist — a `0.0.0.0/0` entry plus a leaked URI is game over, and there is nothing in-repo to tell me which it is.**
4. (S) Test the restore. An untested backup is a hypothesis.

### 5.2 The soft-delete-only model

Confirmed: there is **no `DELETE` handler anywhere in `app/api/`** (grep returns nothing). Deletion is `PATCH { action: "soft_delete" }` → `$set: { is_deleted: true }` (`app/api/invoices/route.ts:382-383`), and every read filters `is_deleted: { $ne: true }`.

This is a good default for accidental deletion and for an audit trail. It creates three problems at launch scale:

- **HIGH (regulatory) — "delete" does not delete.** A user who deletes an invoice containing their client's name, email, address and payment details is told it is deleted; the data remains indefinitely, visible to admins (`includeDeleted=true` at `app/api/admin/users/[uid]/route.ts:49`) and included in admin exports (`app/api/admin/export/invoices/route.ts:29` queries `{}` and emits an `is_deleted` column). Under DPDP that is retention beyond purpose. Fix (M): keep the soft delete as a 30-day recycle bin, disclose it in the privacy policy, and add a scheduled hard-purge of `is_deleted: true` documents older than 30 days.
- **MEDIUM — storage cost.** Deleted invoices count against the 512 MB forever.
- **LOW — no restore UI.** The data is recoverable but only by an operator with a Mongo shell, which means it is not really a recycle bin, it is just retention.

### 5.3 Data portability and account deletion — verified absent

I checked for both explicitly.

**Account deletion: does not exist.** There is no `DELETE` route, no `/api/account`, no `firebaseAdmin.auth().deleteUser` call anywhere (the only Firebase Admin user mutations are `updateUser({disabled})` and `revokeRefreshTokens` in the *admin* suspend flow, `app/api/admin/users/[uid]/route.ts:124-125`). The only user-initiated identity action in the whole UI is `signOut` (`components/ui/header.tsx:131-132`). **A user who signs up cannot leave.** An admin cannot delete them either — only suspend.

**Data export: partial and manual only.** A user can export **one invoice at a time** as PDF/HTML/CSV/JSON from the invoice modal (`components/InvoiceModal.tsx:71-115`). There is no "export everything" — no bulk endpoint, no profile/activity export. The full-dump endpoints (`/api/admin/export/*`) are admin-only and cross-tenant, so they cannot be reused.

**BLOCKER (B7). Fix (M):**
1. `POST /api/account/export` → a single JSON containing the user's profile, all invoices (including soft-deleted, flagged), and their feedback. Reuse `authedFetch` + `downloadBlobObject` (`lib/download.ts:19`), which already exists for the admin exports. Rate-limit it to ~1/day.
2. `DELETE /api/account` → hard-delete `Invoice`, `Feedback`, and the `User` row for the uid, anonymise `LogEntry.userId` to `null` (keeping the aggregate analytics, dropping the identifier), then `firebaseAdmin.auth().deleteUser(uid)`. Require re-authentication, and confirm by typing the email. Log the deletion as an `admin`-category event **without** the uid.
3. Surface both in an account-settings page and describe them in the privacy policy (8.1).

### 5.4 Other data-safety notes

- **MEDIUM — no schema versioning or `updatedAt` on `Invoice`.** `models/Invoice.ts` has a manual `createdAt` (`:83`) and no `updatedAt`, so you cannot tell when an invoice was last modified, cannot build incremental backups, and cannot answer "what changed" in a dispute. Fix (S): add `updatedAt` set in the PUT path.
- **LOW — two legacy field shapes coexist by design** (`tax` → `cgst`/`sgst`, `providerId` → `providerIds`; `CLAUDE.md` line 24). Correct and deliberate, with `?? tax` fallbacks (`lib/invoice-domain.ts:87`) and tests. Just make sure the fallbacks outlive the last legacy document — there is no query in-repo that tells you how many remain. Fix (S): add a count to `scripts/audit-orphan-invoices.ts`.
- **LOW — `scripts/audit-orphan-invoices.ts` implies orphan (tenant-less) invoices have existed.** The schema validator now prevents new ones (`models/Invoice.ts:38-47`). Run the audit once before launch and confirm zero.

---

## 7. Deployment and configuration

### 7.1 `vercel.json`

Eight lines (`vercel.json:1-9`): a schema reference and one daily cron. Missing everything that a production Vercel project usually pins:

- **no `regions`** — set `["bom1"]` (Mumbai). For an India-facing product with an Atlas cluster that should also be in Mumbai, this is the single largest latency win available, and it is one line. Currently functions run in Vercel's default region (`iad1`, Washington DC), so every Mongo round-trip crosses the Atlantic *and* the Pacific: a request doing 3-4 sequential Mongo ops pays ~250 ms × 4 in avoidable RTT. **HIGH, size S.**
- **no `functions` config** — no `maxDuration`, no `memory`. The AI route can take 20 s (`lib/ai/invoice-assistant/provider.ts:12`) plus token verification plus two log writes, which is uncomfortably close to the default limit (Hobby's default max duration is short — UNVERIFIED, confirm current values). Fix (S): `"functions": { "app/api/ai/**": { "maxDuration": 30 } }`.
- **no `headers`** — the security headers of 1.9 could live here instead of `next.config.ts`; either is fine, but neither exists.
- **LOW** — the cron runs `0 6 * * *` UTC = 11:30 IST. Harmless, but if you later add a reminders cron, pin `APP_TZ` reasoning explicitly.

### 7.2 `next.config.ts`

22 lines. `serverExternalPackages: ["firebase-admin"]` is correct and load-bearing. Findings beyond the missing `headers()` (1.9):

- **MEDIUM — `images.remotePatterns` allows `via.placeholder.com`** (`next.config.ts:15-17`), a third-party host that has no business in a production invoicing app's trust boundary. It is dead weight now that logos render through raw `<img>` (1.10) — remove it.
- **MEDIUM — no `output: "standalone"`**, which the Dockerfile would benefit from (7.3), and no `poweredByHeader: false` (the `X-Powered-By: Next.js` header is version disclosure).
- **LOW — no `eslint`/`typescript` build gates configured.** Defaults are fine (both fail the build), just confirm nobody has set `ignoreBuildErrors` in CI.

### 7.3 The Dockerfile and the Turbopack/webpack divergence

`Dockerfile:15` builds with `bunx next build --webpack`; `package.json:6` runs dev with `next dev --turbopack`; `package.json:7` runs `next build` (Turbopack in Next 16) for local/Vercel builds. So **three different bundler paths exist and Vercel uses a fourth combination** (`bun run build` → Turbopack, on Vercel's builder).

Risk, concretely: the Docker image is built by a *different bundler* than the artifact Vercel serves. Turbopack and webpack differ in tree-shaking, module resolution for CJS/ESM interop, and in how `serverExternalPackages` is honoured — and this codebase already has one CJS-interop landmine documented at length (the `firebase-admin` → `SlowBuffer` chain, `CLAUDE.md` line 28, `lib/server/node-compat.ts`). A bug that reproduces in one bundler and not the other is the worst class of production bug.

**MEDIUM. Fix (S): pick one.** If Vercel is the deployment target, the Dockerfile is a local/parity convenience — either delete it or align it to `bunx next build` so it exercises the same path. If Docker is a real deployment target (self-host, a customer's VPC), then make it the source of truth and add it to CI so a webpack-only breakage is caught before release, not after.

Additional Dockerfile findings:
- **HIGH (if Docker is used for real) — `NEXT_PUBLIC_*` variables are inlined at build time and the Dockerfile passes none.** There are no `ARG`/`ENV` lines for `NEXT_PUBLIC_FIREBASE_*` (`Dockerfile:11-15`), so an image built without those in the build environment ships with an **empty Firebase client config** (`lib/firebase.ts:4-11` reads them at module scope) — the app builds fine and then fails at runtime in the browser with an unhelpful Firebase error. Fix (S): declare `ARG`s and fail the build if they are empty.
- **MEDIUM — the runner re-runs `bun install --frozen-lockfile --production`** (`Dockerfile:22`) instead of using `output: "standalone"`, producing a much larger image and a second network-dependent step. Fix (S): `output: "standalone"` + copy `.next/standalone`.
- **LOW — no `HEALTHCHECK`**, no pinned `NODE_ENV` at build time, and `bun run start` invokes `next start`, which does not serve `.next/standalone`.

### 7.4 Missing environment variables at runtime — behaviour per variable

Traced each one:

| Variable | If missing | Verdict |
|---|---|---|
| `MONGODB_URI` | **Throws at module scope** — `lib/mongodb.ts:6-8` runs on import, so every route that imports `connectDB` (i.e. nearly all of them) fails to load. Next returns an opaque 500; the app is entirely dead with a message only in the runtime log. | **HIGH** — worst failure mode of the set. Move the check into `connectDB()` and return a clean 503, or better, validate all env at boot (below). |
| `FIREBASE_ADMIN_CREDENTIALS` | Handled well: `ensureFirebaseAdmin` throws → `AuthError("AuthConfigurationError", 500)` (`lib/server/auth.ts:62-67`) → "Server authentication is misconfigured". | Good. |
| `JWT_SECRET` | `signSessionToken` throws (`lib/server/session-token.ts:19`) inside the auth route's try → generic `{error:"Internal Server Error"}` 500. **All sign-in breaks with no diagnostic**, for a token nothing verifies. | **HIGH** — and it disappears entirely if you take the fix in 1.3. |
| `GEMINI_API_KEY` | Clean 503 with actionable copy (`app/api/ai/invoice-assistant/route.ts:139-147`). | Good. |
| `NEXT_PUBLIC_FIREBASE_*` | `initializeApp({apiKey: undefined, …})` (`lib/firebase.ts:4-14`) — no validation. Client-side auth fails with a raw Firebase error. On Vercel these are present at build; in Docker they are not (7.3). | **MEDIUM** |
| `CRON_SECRET` | Endpoint becomes **open** (`app/api/cron/keep-alive/route.ts:22-28`). | MEDIUM (2.6) |
| `ADMIN_EMAILS` | No bootstrap admin. If it is unset *and* no admin row exists, the admin panel is unreachable by anyone — recoverable only via a direct DB write. | LOW, but document the recovery. |
| `APP_TZ` | Defaults to UTC (`app/api/admin/activity/route.ts:23`); heatmap is skewed by 5.5 h. | LOW |
| `DNS_SERVERS` | Correctly a no-op when unset (`lib/mongodb.ts:16-22`). | Good |

**MEDIUM. Fix (S): add `lib/server/env.ts`** — a single module that reads and validates every required variable once, throws a listing every missing name, and is imported at the top of `app/layout.tsx` (or an `instrumentation.ts`) so the failure is loud, immediate, and complete rather than discovered one route at a time. `.env.sample` is accurate and well-commented (`.env.sample:1-45`), which is a good starting inventory.

### 7.5 Dependency and toolchain hygiene

- **MEDIUM — `eslint-config-next` is pinned to `15.1.7` while Next is `^16.1.6`** (`package.json:41`, `:57`). A major-version-behind lint config silently stops enforcing the rules that matter for the new version (including some of Next 16's own correctness rules). Fix (S): bump.
- **MEDIUM — `shadcn-ui@^0.9.4` is a runtime dependency** (`package.json:46`). It is a CLI scaffolding tool; it belongs in devDependencies at most, and probably nowhere. It inflates the production install and the attack surface.
- **LOW — `lucide-react` and `@radix-ui/react-icons` are both installed** and `components.json` declares lucide while the code uses Radix (`CLAUDE.md` gotchas). Dead weight.
- **LOW — duplicate configs**: `tailwind.config.js` vs `.ts`, `postcss.config.js` vs `.mjs`. Documented as intentional-but-dead; delete the shadowed files before someone edits the wrong one during an incident.
- **MEDIUM — no CI.** No `.github/workflows` in the repo. `bun test`, `bun run typecheck`, and `bun run lint` all exist and pass locally, but nothing enforces them on push, and `.gitignore` ignoring `CLAUDE.md`/`AGENTS.md` means the agent guidance is not shared either. Fix (S): a 20-line GitHub Actions workflow running all three plus `next build`.
- **LOW — no `Dependabot`/`npm audit` gate**; `firebase-admin`'s known-stale transitive chain (`buffer-equal-constant-time`) is already documented, which is exactly the kind of thing an automated advisory feed surfaces.

---

## 8. Legal and operations required to launch publicly (India)

### 8.1 What exists today

Checked every marketing surface:

| Page | State |
|---|---|
| `app/about/page.tsx` (72 lines) | Marketing copy only. No company identity, no registered entity, no jurisdiction. |
| `app/pricing/page.tsx` (68 lines) | "Free plan. Full workflow… currently free while we polish the platform" (`:24-27`). No pricing terms, no refund policy, no statement of what happens to data if the free plan ends. |
| `app/contact/page.tsx` (78 lines) | Three **personal** social links only — Twitter, GitHub, LinkedIn (`:15`, `:21`, `:27`). **No email address, no support address, no postal address, no phone.** |
| `components/ui/footer.tsx` (10 lines) | A copyright line and a tagline. **No links at all.** |
| Header nav (`components/ui/header.tsx:42-46`) | About / Pricing / Contact. |
| Privacy policy | **Does not exist** — grep for "privacy" across `app/` and `components/` returns nothing. |
| Terms of service | **Does not exist.** |
| Cookie / consent notice | **Does not exist** — while `@vercel/analytics` and `@vercel/speed-insights` load on every page (`app/layout.tsx:46-47`) and the app writes three cookies of its own (`modules/UserSessionManager.ts:20-28`). |
| Status page / incident comms | **Does not exist.** |
| Security contact / `security.txt` | **Does not exist.** |

### 8.2 DPDP Act 2023 — what this app actually triggers

Invoicey is a **Data Fiduciary** under India's Digital Personal Data Protection Act, 2023, and the personal data it processes is not only its users' but **their clients'** (`billTo`, `billToEmail`, `billToAddress` — third parties who never consented to anything and have no account). That materially raises the obligations. (The DPDP Rules were notified in 2025 with phased compliance timelines — **UNVERIFIED**, confirm current enforcement dates with counsel before relying on any grace period.)

Concrete gaps, each a launch item:

1. **BLOCKER (B6) — no notice / no consent record.** DPDP requires an itemised notice at or before collection, in English plus the Eighth Schedule languages on request, stating what is collected, why, and how to withdraw consent and complain. Nothing exists. Size M.
2. **BLOCKER (B7) — no right of access, correction, or erasure.** Section 5.3 documents that neither export nor deletion exists in any form. Size M.
3. **HIGH — no named Data Protection Officer / grievance officer and no contact channel.** DPDP requires a published grievance-redressal mechanism with a response timeline. The contact page offers a personal Twitter handle. Size S — publish a `support@` / `privacy@` address and an SLA.
4. **HIGH — no breach-notification plan.** DPDP requires notifying the Data Protection Board and affected users of a personal-data breach. There is no incident runbook, no way to enumerate affected users (no query exists), and no external monitoring to detect a breach in the first place (4.5). Size M — write a one-page runbook.
5. **HIGH — retention is indefinite and undisclosed.** Soft-deleted invoices persist forever (5.2), AI prompts containing customer data persist 30 days (2.5), auth logs 180 days, error logs with stack traces 365 days. DPDP requires erasure when the purpose is served. Size M.
6. **MEDIUM — third-party processors are undisclosed.** Personal data reaches Google (Firebase Auth + **Gemini, which receives the full invoice draft including client names, addresses and emails**), MongoDB Atlas, and Vercel. Each is a processor that a privacy policy must name, with the country of processing. **The Gemini disclosure is the sharpest one** — users will not expect their clients' details to be sent to a third-party LLM. Also confirm Google's data-use terms for the Generative Language API key you are using (the free/AI-Studio tier and the paid tier differ in whether prompts may be used to improve models — **UNVERIFIED and important**; if you are on a free key, prompts may be human-reviewed, which would be a serious disclosure gap for invoice data).
7. **MEDIUM — cookie/analytics consent.** Vercel Analytics is cookieless by default (UNVERIFIED for the current version), which helps, but the app's own three cookies are functional-but-not-strictly-necessary (the `session-token` one is provably unnecessary, 1.3). Disclose them; drop the unnecessary ones.
8. **LOW/MEDIUM — GST considerations.** The product generates CGST/SGST invoices for Indian businesses. You are not the taxpayer, but a terms page should disclaim tax-advice liability and state that the user is responsible for the correctness of GSTIN/HSN/tax treatment. Note the invoice model has **no GSTIN field**, which every real Indian B2B invoice needs — a product gap, not a compliance one, but it will be the first thing users ask for.

### 8.3 Minimum launch checklist for section 8

| Item | Sev | Size |
|---|---|---|
| Privacy policy page (naming Firebase, Gemini, Atlas, Vercel; retention periods; rights and how to exercise them) + footer link | BLOCKER | M |
| Terms of service (free-tier terms, no-warranty, limitation of liability, governing law/jurisdiction, acceptable use) + footer link | BLOCKER | M |
| Cookie/consent notice appropriate to what actually runs | BLOCKER | S |
| Account deletion + data export (5.3) | BLOCKER | M |
| A real support email on `/contact` and in the footer | HIGH | S |
| Published grievance officer + response SLA | HIGH | S |
| Incident runbook + a status page (BetterStack free, 4.5) | HIGH | M |
| `public/.well-known/security.txt` | LOW | S |
| Explicit in-product disclosure at the AI panel: "your draft is sent to Google Gemini" | HIGH | S |

---

## 6. Delivery infrastructure the product will need

Confirmed: **the app sends no email today.** No mail provider, no SMTP, no template — grep finds nothing. The only email that reaches a user is Firebase Auth's own verification/reset mail, sent from `noreply@<project>.firebaseapp.com` with Google branding.

### 6.1 Transactional email

You need it for four things, in priority order:
1. **Branded verification and password-reset mail.** You already *depend* on verification (three separate gates: `lib/auth-client.ts`, `lib/server/auth.ts:87-92`, `app/api/auth/session/route.ts:29-37`), so verification email deliverability is already on the critical path for signup conversion — and it currently goes out from a `firebaseapp.com` address that Indian SMB users will not recognise. Fix: configure a custom SMTP sender in the Firebase console pointing at your provider. **Do this first; it is the cheapest conversion win in the report.**
2. **Invoice delivery to the end client** — the obvious product gap. Today the only way to get an invoice to a client is to export it and attach it manually.
3. **Payment reminders** (overdue invoices) — the feature that makes an invoicing product sticky. Needs a cron and an `updatedAt`/reminder-state field the schema does not have (5.4).
4. **Account/compliance mail**: deletion confirmation, data-export ready, breach notice (8.2).

Provider comparison (prices verified Aug 2026 unless marked):

| | Resend | Amazon SES | Postmark |
|---|---|---|---|
| Free tier | 3 000 emails/mo | none (sandbox until approved) | 100/mo trial |
| Entry price | $20/mo → 50 000 emails | **$0.10 per 1 000** (~$0.0001/email) | $15/mo base + $1.80 per extra 1 000 |
| 30 000 emails/mo | $20 | ~$3 | ~$15-25 |
| 300 000 emails/mo | ~$90-100 | ~$30 | ~$500+ |
| DX | best-in-class; React Email, 5-minute setup | AWS IAM, SNS bounce handling, sandbox exit request | very good |
| Deliverability reputation | good | you own the reputation (shared IPs by default) | **best-in-class** |
| India specifics | no India region; sends fine | **`ap-south-1` (Mumbai) region available** — lowest latency and a data-residency story | US/EU only |

**Recommendation: Resend at launch, plan a migration to SES around 100 000-200 000 emails/month.** Rationale: at your launch volume the price difference is under $20/month and Resend removes a day of AWS plumbing; SES's advantage is real only at volume, and its Mumbai region matters more for a data-residency claim (8.2) than for latency.

**India deliverability is not really a provider choice — it is a domain-authentication choice.** Whatever you pick: send from a subdomain you control (`mail.invoicey.in`), publish SPF + DKIM + a DMARC record (start `p=none`, move to `p=quarantine`), warm the domain gradually, and honour list-unsubscribe on anything non-transactional. Gmail and Outlook — which is where essentially all your recipients are — enforce these; a provider with a perfect reputation cannot save an unauthenticated domain.

**One hard dependency nobody has costed: there is no PDF library** (`CLAUDE.md`: "PDF export" is `window.print()`). Emailing an invoice means emailing a *PDF attachment* — that is what an Indian SMB's client expects — which requires server-side rendering that does not exist. Options: a headless-Chrome service (`@sparticuz/chromium` on a Vercel function is fragile and heavy), a hosted HTML-to-PDF API (~$10-30/mo), or a real PDF library. `createInvoiceHtml` is a pure function in `lib/invoice-export.ts` so it is already importable server-side — that part is fine. **Size L, and it is the single largest piece of work implied by "send invoices by email".**

### 6.2 WhatsApp sharing — use `wa.me`, not the Cloud API

This is the clearest either/or in the report.

**Meta Cloud API (business-initiated):** requires a Meta Business Manager verification, a dedicated phone number, per-template approval (24-48 h per template, re-approval on any wording change), and a category assignment. An invoice delivery is a **utility** template. India rates as of July 2026: utility/authentication **₹0.1150 per message**, marketing ₹0.8631 — **plus 18 % GST**, plus a BSP platform fee and per-message markup (Indian BSPs typically add 10-30 %). Service messages become chargeable at the utility rate from 1 Oct 2026. So a realistic all-in utility message is ~₹0.15-0.20. At 1 000 users × 20 invoices/month that is ~₹3 000-4 000/month; at 10 000 users, ~₹30 000-40 000/month plus BSP minimums, which are typically ₹1 000-3 000/month on their own.

**`wa.me` deep link:** free, instant, no approvals, no per-message cost, no template governance, and — the part that actually matters commercially — the message goes out **from the business owner's own WhatsApp number**, which is exactly how Indian SMBs already send invoices and is far more likely to be read than a message from an unknown business account.

**Recommendation: ship `wa.me` only.** Add a "Share on WhatsApp" button that opens `https://wa.me/<client-number>?text=<pre-filled message + link>`. Size S — *with one prerequisite*: there is currently **no public invoice view**; every route requires auth, so there is no URL to put in the message. You need a signed, expiring, read-only public invoice page (`/i/<token>`) first. Size M. That link is independently valuable — it is also what an email would link to, and it lets a client view the invoice without an account.

Revisit the Cloud API only when you want *automated* overdue reminders at scale, where the per-message cost buys real recovered revenue. Until then it is approvals, compliance surface, and a BSP contract in exchange for nothing a deep link does not do.

### 6.3 File storage for logos and attachments

Today there is **no upload of any kind**. The company logo is a URL the user types into a text field (`components/InvoiceEditor.tsx:535-538`), stored as a raw string, and rendered unfiltered in both previews (1.10). That is simultaneously a product gap (users have a PNG on their desktop, not a URL) and the security/privacy vector in 1.10.

| | Cloudflare R2 | AWS S3 | Vercel Blob | Firebase Storage |
|---|---|---|---|---|
| Storage | **$0.015/GB-mo** | ~$0.023/GB-mo | $0.023/GB-mo | $0.026/GB-mo |
| Egress | **$0** | ~$0.09/GB | $0.05/GB | $0.15/GB |
| API | S3-compatible | native | Vercel SDK | Firebase SDK |
| Fit here | best cost, needs a Cloudflare account | most operational overhead | zero-config, most expensive at delivery | already in your stack, worst egress |

Volumes are trivial either way: 10 000 users × one ~50 KB logo = 500 MB stored. The variable is *egress* — a logo is fetched on every invoice view, print, and shared-link open. At 300 000 views/month that is ~15 GB/month: **$0 on R2, ~$0.75 on Vercel Blob, ~$2.25 on Firebase Storage.** Small in absolute terms, but the ratio holds as you add PDF attachments and shared-link traffic, where it stops being small.

**Recommendation: Cloudflare R2** with presigned direct uploads, a strict allowlist (`image/png|jpeg|webp/svg-excluded`), a 2 MB size cap, server-side re-encoding or at minimum content-type sniffing, and delivery through a Cloudflare-cached custom domain. Then pin the CSP's `img-src` to that domain (1.9) and replace the free-text URL field entirely — which closes 1.10, the `data:`-URI storage issue in 1.4, and the unbounded-document-size contribution in 1.8 in one change. **Size M, cost ≈ $0-1/month at all three scale points.**

---

## 9. Realistic monthly infrastructure cost

Assumptions: 20 invoices/user/month, AI on 30 % of them, 1.5 emails per invoice, ₹88 ≈ $1. Vercel **Pro is mandatory** — the Hobby plan forbids commercial use. Gemini must be on a **paid** key (see the note below the table).

| Line item | 100 users | 1 000 users | 10 000 users |
|---|---|---|---|
| Vercel Pro (1 seat, $20 incl. $20 credit, 1 TB transfer) | $20 | $40 | $300 |
| MongoDB Atlas | Flex ~$10 (capped $30) | **M10 ~$58** + backup ≈ $70 | M20-M30 **$150-450** |
| Firebase Auth (free to 50 k MAU) | $0 | $0 | $0 |
| Gemini 2.5 Flash ($0.30/M in, $2.50/M out) | ~$2 | ~$15 | ~$150 |
| Upstash Redis (rate limiting) | $0 (free 500 k cmd) | ~$2 | ~$20 |
| Sentry | $0 (free tier) | ~$26 | ~$26-80 |
| Transactional email (Resend) | $0 (free 3 k) | $20 | ~$90 (or ~$30 on SES) |
| Object storage (R2) | ~$0 | ~$1 | ~$5 |
| Uptime + status + log drain | $0 | $0 | ~$25 |
| **Total (USD/mo)** | **~$32** | **~$174** | **~$766-1 100** |
| **Total (INR/mo, approx.)** | **~₹2 800** | **~₹15 300** | **~₹67 000-97 000** |
| *WhatsApp Cloud API, if adopted (utility only)* | *~₹300* | *~₹3 000-4 000* | *~₹30 000-40 000 + BSP fees* |
| *PDF rendering service, if adopted* | *~$10* | *~$10-30* | *~$50-150* |

Notes and caveats:

- **The Gemini line is the volatile one.** It assumes the per-user caps from 2.2 exist. **Without them the cell is unbounded** — the current code will happily bill a ~1 M-token context per request with no daily ceiling. Budget alerts on the Google Cloud billing account are not optional.
- **You must move off a free Gemini key before launch, on privacy grounds as much as quota.** Google's pricing page states plainly that free-tier prompts **are** used to improve their products, while paid-tier prompts are not. Your prompts contain your users' clients' names, addresses, emails and amounts (`lib/ai/invoice-assistant/prompt.ts:104-107` serialises the entire draft). Shipping to the public on a free key would be a disclosure failure under 8.2 as well as a commercial one. **Treat as a BLOCKER-adjacent item.**
- **Atlas M0 is not viable past ~100 users**, and not for three reasons but four: 512 MB storage, **100 operations/second**, **10 GB in / 10 GB out per rolling 7 days**, and no backups. The ops/sec cap is the sleeper — a single admin-dashboard load fires 12 aggregations (3.2 #5), and the app writes a log document per business event, so your effective ops budget is roughly half what you would estimate from user actions alone.
- **Atlas M10/M20 rate-limit new connections to 15/second per node.** With serverless cold starts that is a real constraint and another reason the `maxPoolSize`/connection-caching fix in 3.1 is a blocker rather than an optimisation.
- Vercel's 10 M included edge requests and 1 TB transfer are generous; the line that will actually grow is **compute**, and the largest single lever on it is fixing the unpaginated list (2.4) and the 12-aggregation admin overview (3.2 #5).
- Costs exclude: domain (~₹1 000/yr), a business entity and accounting, and any paid support.

---

## 10. Suggested order of work

**Before opening signups (the B-list, ~2 weeks of focused work):**
1. Delete `User.accessToken` / `User.refreshToken` + `$unset` them from existing docs (B4). *S*
2. Cached connection promise + `maxPoolSize: 5` + timeouts in `lib/mongodb.ts` (B3). *S*
3. Rate limiting: Vercel WAF rules today, Upstash limiter this week; cap and whitelist the AI `draft`; per-user AI daily quota; Google Cloud budget alert; move to a paid Gemini key (B1, B2). *M*
4. Security headers + CSP report-only (B8); remove `details: err.message` (B9). *S*
5. Nightly `mongodump` to R2 + verify the Atlas IP allowlist is not `0.0.0.0/0` (B5). *S*
6. Sentry + an uptime check on a new `/api/health` (B10). *S*
7. Account deletion + full data export (B7). *M*
8. Privacy policy, terms, cookie notice, support email, footer links (B6). *M*

**First month after launch:** paginate the invoice list (2.4); field-length and item-count caps (1.8); `connectDB` inside try/catch (4.1); stop persisting `fullPrompt` (2.5); the invoice-editor error boundary (4.4); pin `regions: ["bom1"]` (7.1); CI running test/typecheck/lint (7.5).

**First quarter:** logo uploads to R2 replacing the URL field (6.3); signed public invoice links (6.2) and then `wa.me` sharing; branded transactional email via Resend (6.1); the DAU/WAU/MAU rollup (3.2 #4); hard-purge of soft-deleted rows (5.2); resolve the Turbopack/webpack divergence (7.3).

---

## Sources

- [Atlas Free Cluster Limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/)
- [Atlas Service Limits](https://www.mongodb.com/docs/atlas/reference/atlas-limits/)
- [MongoDB Pricing](https://www.mongodb.com/pricing) / [MongoDB Atlas pricing guide 2026](https://www.cloudzero.com/blog/mongodb-pricing/)
- [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Upstash pricing](https://upstash.com/pricing)
- [Vercel pricing 2026 breakdown](https://temps.sh/blog/vercel-pricing-2026-pro-plan-explained)
- [Resend vs SES vs Postmark 2026](https://www.buildmvpfast.com/blog/resend-vs-ses-vs-postmark-transactional-email-deliverability-saas-2026)
- [WhatsApp Business API pricing India 2026](https://whautomate.com/whatsapp-business-api-pricing-india)
- [Cloud storage pricing comparison 2026](https://www.buildmvpfast.com/api-costs/cloud-storage) / [Vercel Blob pricing](https://vercel.com/docs/vercel-blob/usage-and-pricing)
