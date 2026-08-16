# Runbook — backup, restore, and the Atlas allowlist

Written while nobody is panicking, so it is readable while somebody is. Covers
the nightly database backup, how to restore it, how to prove the restore worked,
and the database network-access decision that goes with it.

Related code:

- `scripts/backup-to-r2.ts` — dump → encrypt → upload
- `scripts/verify-backup.ts` — asserts a *restored* database is usable
- `app/api/health/route.ts` — the uptime probe (see the appendix)

---

## 0. The one-line answers

| Question | Answer |
|---|---|
| Where does the backup run? | **GitHub Actions**, nightly at `0 20 * * *` UTC (01:30 IST). Not Vercel Cron. |
| Where does it land? | Cloudflare R2, `s3://invoicey-backups/daily/<YYYY-MM-DD>/dump.gz.age` |
| Is it encrypted? | Yes — `age`, to a key the owner holds **offline**. R2 holds ciphertext only. |
| How long is it kept? | `daily/` 30 days, `monthly/` 12 months — R2 lifecycle rules. |

> **Before you enable the workflow, update the privacy policy.** It currently
> states that there are no automated off-site backups, which is true only while
> this stays switched off. Turning it on makes Cloudflare a processor holding a
> full copy of every user's personal data, and the processor table on `/privacy`
> claims to be complete. Add Cloudflare R2, add the retention period, and keep
> the number here and the number there in step.

| Who can decrypt? | Only whoever holds `AGE_PRIVATE_KEY`. CI can write backups and can never read them. |
| When was the last verified restore? | See §6. If that table is empty, **you do not have backups, you have hopes.** |

---

## 1. Why the backup does not run on Vercel Cron

`vercel.json` already has the cron pattern (`/api/cron/keep-alive`, guarded by
`CRON_SECRET`). The backup deliberately does not use it:

1. `mongodump` is a binary and does not exist in the Vercel function runtime.
2. A growing dump does not fit a function's execution/memory budget, and a dump
   that dies at 90% looks exactly like one that succeeded.
3. **The credential that recovers you must not live next to the thing it
   recovers.** If the Vercel project is compromised, the backup job and its
   Atlas user should still be out of reach.

So it lives in GitHub Actions: a separate trust domain, with a different set of
secrets.

---

## 2. Owner actions — do these once, in this order

Nothing in this list can be done from inside the repository. An agent can write
the script; only a human with the consoles can make it run.

### 2.1 Cloudflare R2

1. Create bucket `invoicey-backups` (choose the jurisdiction deliberately — it
   stores personal data and belongs in the privacy policy's processor table).
2. Create an **API token scoped to that one bucket** with *Object Write* only —
   **no read, no list, no delete**. A compromised runner must be able to add
   history and never to rewrite or erase it.
3. Lifecycle rules: expire `daily/` after **30 days**, `monthly/` after
   **12 months**.
4. Check whether **bucket lock / object retention** is available on the account
   and enable it on `daily/`. This is what stops a compromised write token
   overwriting yesterday's backup with garbage.
5. Note the endpoint: `https://<account-id>.r2.cloudflarestorage.com`.

### 2.2 The age keypair

```bash
age-keygen -o invoicey-backup.key      # prints the PUBLIC key to stderr
```

- The **public** key goes into GitHub secrets as `AGE_PUBLIC_KEY`.
- The **private** key goes into a password manager **and** one offline copy
  (printed, or on a USB key in a drawer). It must not be in the repo, in Vercel,
  or in the nightly workflow.
- **Losing it means losing every backup.** This is the single point of failure
  and there is no recovery path. Treat it accordingly.

### 2.3 Atlas database users

Three users, each least-privilege — not one shared admin:

| User | Role | Used by |
|---|---|---|
| app | `readWrite` on `invoicey` | Vercel (`MONGODB_URI`) |
| backup | `read` on `invoicey` | GitHub Actions (`MONGODB_URI_BACKUP`) |
| migrations | `readWrite` on `invoicey`, normally **disabled** | `scripts/migrate-*.ts`, enabled only for the minutes a migration runs |

### 2.4 GitHub Actions secrets

`MONGODB_URI_BACKUP`, `AGE_PUBLIC_KEY`, `R2_BUCKET`, `R2_ENDPOINT`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.

Plus, **on the restore-drill workflow's environment only** (see §5):
`AGE_PRIVATE_KEY`.

### 2.5 Add the workflows

The workflow files are **not** in this repository — the change that added this
runbook was scoped to `app/`, `scripts/`, `docs/` and config, and could not
create `.github/workflows/`. Create them by hand from the two blocks below.
Until they exist, **there is no nightly backup**; running `bun run backup:db`
from a laptop is a manual stopgap, not a backup strategy.

`.github/workflows/backup.yml`:

```yaml
name: nightly-backup
on:
  schedule:
    # 01:30 IST. Offset from the 06:00 UTC keep-alive cron so the two are not
    # competing for an M0 cluster's tiny op budget.
    - cron: "0 20 * * *"
  workflow_dispatch:

jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - name: Install mongodump and age
        run: |
          sudo apt-get update
          sudo apt-get install -y age
          wget -q https://fastdl.mongodb.org/tools/db/mongodb-database-tools-ubuntu2204-x86_64-100.10.0.deb
          sudo dpkg -i mongodb-database-tools-*.deb

      # Open a single-IP, self-expiring hole in the Atlas access list. Even with
      # 0.0.0.0/0 on the project today (see section 7), this job should not rely
      # on it — and it is what lets the blanket rule be removed later.
      - name: Open Atlas access list
        env:
          ATLAS_API_PUBLIC_KEY: ${{ secrets.ATLAS_API_PUBLIC_KEY }}
          ATLAS_API_PRIVATE_KEY: ${{ secrets.ATLAS_API_PRIVATE_KEY }}
          ATLAS_PROJECT_ID: ${{ secrets.ATLAS_PROJECT_ID }}
        run: |
          IP=$(curl -s https://api.ipify.org)
          echo "RUNNER_IP=$IP" >> "$GITHUB_ENV"
          curl -sf --digest -u "$ATLAS_API_PUBLIC_KEY:$ATLAS_API_PRIVATE_KEY" \
            -H 'Content-Type: application/json' \
            -H 'Accept: application/vnd.atlas.2023-01-01+json' \
            -X POST "https://cloud.mongodb.com/api/atlas/v2/groups/$ATLAS_PROJECT_ID/accessList" \
            -d "[{\"ipAddress\":\"$IP\",\"comment\":\"gha-backup\",\"deleteAfterDate\":\"$(date -u -d '+1 hour' +%Y-%m-%dT%H:%M:%SZ)\"}]"

      - run: bun install --frozen-lockfile
      - name: Dump, encrypt, upload
        env:
          MONGODB_URI_BACKUP: ${{ secrets.MONGODB_URI_BACKUP }}
          AGE_PUBLIC_KEY: ${{ secrets.AGE_PUBLIC_KEY }}
          R2_BUCKET: ${{ secrets.R2_BUCKET }}
          R2_ENDPOINT: ${{ secrets.R2_ENDPOINT }}
          R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
          # Carried forward from the previous run so a halved dump fails loudly.
          BACKUP_PREVIOUS_BYTES: ${{ vars.BACKUP_PREVIOUS_BYTES }}
        run: bun run backup:db

      # Belt to the deleteAfterDate braces.
      - name: Close Atlas access list
        if: always()
        env:
          ATLAS_API_PUBLIC_KEY: ${{ secrets.ATLAS_API_PUBLIC_KEY }}
          ATLAS_API_PRIVATE_KEY: ${{ secrets.ATLAS_API_PRIVATE_KEY }}
          ATLAS_PROJECT_ID: ${{ secrets.ATLAS_PROJECT_ID }}
        run: |
          curl -s --digest -u "$ATLAS_API_PUBLIC_KEY:$ATLAS_API_PRIVATE_KEY" \
            -H 'Accept: application/vnd.atlas.2023-01-01+json' \
            -X DELETE "https://cloud.mongodb.com/api/atlas/v2/groups/$ATLAS_PROJECT_ID/accessList/$RUNNER_IP" || true

      # A silently failing backup is indistinguishable from no backup, which is
      # the state this whole exercise exists to end. Route this somewhere that
      # reaches a phone.
      - name: Alert on failure
        if: failure()
        run: echo "::error::Nightly backup FAILED — see the job log."
```

`.github/workflows/restore-drill.yml` — monthly, and **the only place the age
private key exists online**, which is why it is a separate workflow with its own
protected environment rather than a step in the nightly job:

```yaml
name: restore-drill
on:
  schedule:
    - cron: "0 21 1 * *"   # 1st of the month
  workflow_dispatch:

jobs:
  drill:
    runs-on: ubuntu-latest
    environment: restore-drill      # protect this environment in repo settings
    services:
      mongo:
        image: mongo:7
        ports: ["27017:27017"]
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: |
          sudo apt-get update && sudo apt-get install -y age
          wget -q https://fastdl.mongodb.org/tools/db/mongodb-database-tools-ubuntu2204-x86_64-100.10.0.deb
          sudo dpkg -i mongodb-database-tools-*.deb
      - name: Fetch the most recent backup
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.R2_READ_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.R2_READ_SECRET_ACCESS_KEY }}
          AWS_DEFAULT_REGION: auto
        run: |
          KEY=$(aws s3 ls "s3://${{ secrets.R2_BUCKET }}/daily/" --endpoint-url "${{ secrets.R2_ENDPOINT }}" --recursive | sort | tail -1 | awk '{print $4}')
          aws s3 cp "s3://${{ secrets.R2_BUCKET }}/$KEY" dump.gz.age --endpoint-url "${{ secrets.R2_ENDPOINT }}"
      - name: Decrypt and restore
        run: |
          printf '%s' "${{ secrets.AGE_PRIVATE_KEY }}" > key.txt
          age --decrypt --identity key.txt --output dump.gz dump.gz.age
          shred -u key.txt
          mongorestore --uri="mongodb://127.0.0.1:27017" --archive=dump.gz --gzip
      - run: bun install --frozen-lockfile
      - name: Verify the restore is USABLE, not merely present
        env:
          VERIFY_MONGODB_URI: mongodb://127.0.0.1:27017/invoicey
        run: bun run backup:verify
```

Note the drill needs a **separate read-capable R2 token**
(`R2_READ_ACCESS_KEY_ID`/`R2_READ_SECRET_ACCESS_KEY`); the nightly job's token
is write-only on purpose.

---

## 3. Running a backup by hand

```bash
mongodump --version && age --version && aws --version   # prerequisites

export MONGODB_URI_BACKUP='mongodb+srv://backup:...@cluster/invoicey'
export AGE_PUBLIC_KEY='age1...'
export R2_BUCKET=invoicey-backups
export R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
export R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=...

bun run backup:db
```

Dry run — dump and encrypt locally, upload nothing, leave the `.age` file behind
so you can practise a restore against it:

```bash
bun run backup:db -- --skip-upload
```

The script fails loudly and exits non-zero if the archive is under 10 KB, or
under half of `BACKUP_PREVIOUS_BYTES`. Both floors exist because a dump that
silently produced an empty archive is the classic failure and it looks like
success from every angle except size.

---

## 4. Restoring — the real incident procedure

**Restore into a NEW cluster or a local mongod first. Never `mongorestore`
straight over the live database.** The most common way to turn a bad day into an
unrecoverable one is to overwrite good-but-partial live data with an older
backup before anyone has looked at either.

```bash
# 1. Get the object. Newest daily:
aws s3 ls s3://invoicey-backups/daily/ --recursive --endpoint-url "$R2_ENDPOINT" | sort | tail
aws s3 cp s3://invoicey-backups/daily/<YYYY-MM-DD>/dump.gz.age . --endpoint-url "$R2_ENDPOINT"

# 2. Decrypt with the OFFLINE private key (password manager / paper copy).
age --decrypt --identity backup.key --output dump.gz dump.gz.age

# 3a. Full restore into a throwaway local instance:
docker run -d -p 27017:27017 --name invoicey-restore mongo:7
mongorestore --uri="mongodb://127.0.0.1:27017" --archive=dump.gz --gzip

# 3b. Or ONE collection only — the usual case, e.g. an accidental mass update:
mongorestore --uri="mongodb://127.0.0.1:27017" --archive=dump.gz --gzip \
  --nsInclude='invoicey.invoices'

# 3c. Restoring into a fresh Atlas cluster instead:
mongorestore --uri="mongodb+srv://<user>:<pw>@<new-cluster>/" --archive=dump.gz --gzip
```

Then **compare before you promote**. Recover the specific documents you need out
of the restored instance and write them into production deliberately; do not
swap connection strings on a hunch.

Remember `is_deleted`: nothing in this app is ever hard-deleted, so a "lost"
invoice is far more often a soft delete to reverse than a restore to run. Check
that first — it is five seconds and it is usually the answer.

---

## 5. Proving the restore actually worked

An untested backup is a hypothesis. Two layers:

**Nightly (cheap, in the backup job):** the size floor and the previous-run
delta check in `scripts/backup-to-r2.ts`.

**Monthly (real, in the drill workflow):** restore into a throwaway `mongo:7`
and run

```bash
VERIFY_MONGODB_URI="mongodb://127.0.0.1:27017/invoicey" bun run backup:verify
```

`scripts/verify-backup.ts` asserts, and fails the workflow on any one of them:

- every expected collection exists (`invoices`, `users`, `feedbacks`, `logentries`);
- `Invoice` and `User` counts are non-zero, and at or above the floors passed in
  as `BACKUP_MIN_INVOICES` / `BACKUP_MIN_USERS`;
- **every index declared in `models/*.ts` survived the restore** — in particular
  `LogEntry`'s `expireAt` TTL index, whose loss would break no query at all and
  would silently switch log retention off forever;
- one sampled invoice **recomputes** through `resolveRecordAmounts` to the total
  stored with it. This is the check that separates "the bytes came back" from
  "the data is usable".

It refuses to run if `VERIFY_MONGODB_URI` equals `MONGODB_URI`.

---

## 6. Restore drill log

"When was the last successful restore?" must have an answer with a date on it.
Add a line here after every drill, green or red.

| Date (UTC) | Backup restored | Result | Notes |
|---|---|---|---|
| _(none yet)_ | — | — | Workflows not yet created; see §2.5. |

---

## 7. The Atlas IP allowlist — the honest recommendation

The launch plan says "verify the Atlas IP access list isn't `0.0.0.0/0`". It
almost certainly is, and **for a Vercel-hosted app that is currently the only
configuration that works.** This is a decision for the owner, not a task an
agent can complete, and pretending otherwise in code would be worse than saying
so here.

- Vercel serverless functions have **dynamic egress IPs**. MongoDB's own Vercel
  integration documentation requires `0.0.0.0/0`, and Atlas adds that entry on
  your behalf as part of the integration.
- Vercel sells **Static IPs** (~$100/month per project, Pro/Enterprise). At
  roughly $32/month of total infrastructure, that triples the bill to buy
  IP-based access control on a database whose real protection is the connection
  string plus SCRAM auth.
- A third-party egress proxy adds a vendor, a hop, and another place the
  connection string can be observed.

**Recommendation: do not buy static IPs at launch. Harden the URI and the
credentials instead** — that is where the actual control is:

1. Three least-privilege Atlas users (§2.3), not one shared admin.
2. The migration scripts (`scripts/migrate-*.ts`) run from a laptop with
   production credentials today. Give them their own user, keep it **disabled**
   between migrations, and add a temporary access-list entry for the laptop
   rather than leaning on the blanket rule.
3. The backup job does **not** need `0.0.0.0/0` — the workflow in §2.5 opens and
   closes a single-IP, self-expiring window.
4. Rotate the app's password on any suspicion, and never put the URI anywhere a
   client bundle can reach.
5. Confirm the Phase 0 `User.accessToken` / `refreshToken` purge has landed in
   production. That is what turns a leaked URI from "a data breach" into
   something short of "a permanent account-takeover kit".
6. Revisit at M10+, where Atlas Private Endpoint / VPC peering becomes available
   and is a strictly better answer than static egress IPs.

**How to check the current state** (console/API only — an agent cannot):

- Atlas → project → **Network Access** → **IP Access List**. Look for
  `0.0.0.0/0`, usually commented as belonging to the Vercel integration.
- Or: `curl --user "<PUBLIC>:<PRIVATE>" --digest -H 'Accept: application/vnd.atlas.2023-01-01+json' "https://cloud.mongodb.com/api/atlas/v2/groups/<PROJECT_ID>/accessList"`
- Atlas → **Database Access**: confirm the three users above and their roles.

---

## 8. What this repository cannot do for you

Stated plainly, because the gap between "the script exists" and "backups happen"
is where this normally fails:

- **Create the workflow files** — out of scope for the change that added this
  runbook (§2.5). No workflow, no backup.
- **Create the R2 bucket, the tokens, or the lifecycle rules.**
- **Generate or hold the age keypair.** The private key must never be in a repo.
- **Change the Atlas access list, create database users, or buy static IPs.**
- **Prove a restore worked.** `scripts/verify-backup.ts` can assert it; only a
  human can schedule the drill and read the result.
- **Page anyone.** Failure routing is a notification channel someone must set up.

---

## Appendix — observability owner actions

Code landed alongside this runbook: `app/api/health/route.ts`,
`instrumentation.ts`, `instrumentation-client.ts`, `lib/observability/scrub.ts`.

**Uptime monitor.** Point BetterStack Uptime or UptimeRobot (free tier) at
`https://<domain>/api/health` every 3 minutes, **from an India region**, alerting
to a phone. Turn on the hosted status page and put its URL in the footer and the
terms. The monitor keys off the **status code**: `200` healthy, `503` when Mongo
or Firebase Admin is unreachable. The body is deliberately three keys and three
enum values and carries no version, host, count, env value or error text —
please keep it that way; a richer body belongs on a separate `CRON_SECRET`-gated
route.

**Sentry.** Create the org/project, **choose the data region deliberately and
record it — it goes in the privacy policy's processor table**, then set
`SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` in Vercel. With no DSN the SDK is
never initialised and nothing is sent, so this is safe to defer. Also turn on
Sentry's own server-side data-scrubbing settings as a second line of defence
behind `beforeSend`.

Source-map upload is **off** (`sourcemaps: { disable: true }` in
`next.config.ts`): it needs `SENTRY_AUTH_TOKEN` plus the `@sentry/cli` binary,
whose postinstall is blocked in this repo. To enable it: `bun pm trust @sentry/cli`,
set `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT`, and flip that flag.
Leave it off until you have confirmed a build succeeds with it on.

**Also worth the five minutes each**, since they protect the wallet rather than
the data: a Google Cloud budget alert on the Gemini key, Atlas alerts on
connections and storage, and Vercel spend management.
