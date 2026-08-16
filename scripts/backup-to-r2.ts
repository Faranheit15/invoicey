/**
 * Nightly encrypted database backup: mongodump -> age -> Cloudflare R2.
 *
 * WHERE THIS RUNS: GitHub Actions, on a schedule — NOT Vercel Cron, and not
 * from a laptop. Three things disqualify the Vercel Cron pattern that
 * app/api/cron/keep-alive/route.ts uses:
 *   1. `mongodump` is a binary. It does not exist in the Vercel function
 *      runtime and cannot be installed there.
 *   2. A growing dump does not fit a function's execution or memory budget, and
 *      a dump that dies at 90% is worse than no dump because it looks like it
 *      worked.
 *   3. The credential that recovers you must not live next to the thing it
 *      recovers. If the Vercel project is compromised, the backup job should
 *      still be out of reach.
 * The workflow YAML that invokes this script is in docs/runbooks/backup-and-restore.md.
 *
 * WHY THE ENCRYPTION IS NOT OPTIONAL: R2 encrypts at rest, but a leaked R2
 * token would otherwise hand over plaintext containing every user's clients'
 * names, addresses, phone numbers and payment details. With `age`, the CI
 * secrets grant the ability to WRITE backups and never to READ them — the
 * private key is held offline by the owner and exists in exactly one online
 * place, the monthly restore drill. So a missing AGE_PUBLIC_KEY is a hard
 * failure here, not a warning.
 *
 * RETENTION is an R2 lifecycle rule (daily/ 30 days, monthly/ 12 months), not
 * this script's job: the upload token deliberately has no delete permission, so
 * a compromised CI runner cannot erase history. The 30 days must match the
 * number published in the privacy policy.
 *
 * Usage:
 *   bun run backup:db                 # dump, encrypt, upload
 *   bun run backup:db -- --skip-upload   # dump + encrypt locally, for testing
 */

import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface RequiredEnv {
  /** A READ-ONLY Atlas user scoped to this one database. Never the app's user. */
  MONGODB_URI_BACKUP: string;
  /** age recipient public key. Not secret, but kept with the other secrets. */
  AGE_PUBLIC_KEY: string;
  R2_BUCKET: string;
  /** https://<accountid>.r2.cloudflarestorage.com */
  R2_ENDPOINT: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
}

const skipUpload = process.argv.includes("--skip-upload");

// A dump that silently produced an empty archive is the classic failure, and it
// is invisible until the day you need it. 10 KB is below any real dump and far
// above an empty one.
const MIN_ARCHIVE_BYTES = Number(process.env.BACKUP_MIN_BYTES || 10_240);

// Optional second floor: the workflow carries yesterday's byte count forward
// (the R2 token is write-only, so the script cannot look the previous archive
// up itself). A dump that halved overnight is a truncation, not a quiet month.
const previousBytes = Number(process.env.BACKUP_PREVIOUS_BYTES || 0);

const requireEnv = (): RequiredEnv => {
  const names: (keyof RequiredEnv)[] = [
    "MONGODB_URI_BACKUP",
    "AGE_PUBLIC_KEY",
    "R2_BUCKET",
    "R2_ENDPOINT",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
  ];
  const missing = names.filter(
    (name) => !process.env[name] && !(skipUpload && name.startsWith("R2_"))
  );
  if (missing.length) {
    throw new Error(`Missing required env: ${missing.join(", ")}`);
  }
  return Object.fromEntries(
    names.map((name) => [name, process.env[name] ?? ""])
  ) as unknown as RequiredEnv;
};

/**
 * Runs a command, streaming stderr through so a mongodump progress line is
 * visible in the CI log, and throws on a non-zero exit.
 *
 * `env` is passed explicitly rather than inherited wholesale for the two
 * credential-carrying calls, so a subprocess cannot pick up a secret it has no
 * business seeing. Nothing is ever interpolated into a shell string, so there
 * is no shell history or word-splitting exposure.
 *
 * What this does NOT protect against, stated plainly because it is easy to
 * assume otherwise: `mongodump` takes its connection string as `--uri` in argv,
 * and argv is precisely what `ps` shows to every other process on the host.
 * mongodump has no env-var or stdin equivalent. The mitigation is the runner,
 * not the code — this is meant to run on an ephemeral single-tenant GitHub
 * Actions VM with nothing else on it. Do not run it on a shared or long-lived
 * host, and use the read-only backup user rather than an admin credential so
 * that a leak is bounded. See docs/runbooks/backup-and-restore.md.
 */
const run = async (
  argv: string[],
  options: { env?: Record<string, string> } = {}
): Promise<void> => {
  const proc = Bun.spawn(argv, {
    stdout: "inherit",
    stderr: "inherit",
    env: options.env ?? process.env,
  });
  const code = await proc.exited;
  if (code !== 0) {
    // argv[0] only: the arguments may contain the connection string.
    throw new Error(`${argv[0]} exited with code ${code}`);
  }
};

const requireBinary = async (name: string): Promise<void> => {
  const proc = Bun.spawn(["which", name], { stdout: "ignore", stderr: "ignore" });
  if ((await proc.exited) !== 0) {
    throw new Error(
      `Required binary "${name}" not found on PATH. See docs/runbooks/backup-and-restore.md.`
    );
  }
};

const backup = async () => {
  const env = requireEnv();

  await requireBinary("mongodump");
  await requireBinary("age");
  if (!skipUpload) await requireBinary("aws");

  const now = new Date();
  const day = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const month = day.slice(0, 7); // YYYY-MM

  const workDir = await mkdtemp(join(tmpdir(), "invoicey-backup-"));
  const archive = join(workDir, "dump.gz");
  const encrypted = `${archive}.age`;

  try {
    console.log(`[1/5] mongodump -> ${archive}`);
    await run(
      [
        "mongodump",
        `--uri=${env.MONGODB_URI_BACKUP}`,
        `--archive=${archive}`,
        "--gzip",
      ],
      // mongodump gets the connection string and nothing else it does not need.
      // Note the --uri above is visible in `ps`; see the header comment.
      { env: { PATH: process.env.PATH ?? "" } }
    );

    console.log("[2/5] size check");
    const { size } = await stat(archive);
    if (size < MIN_ARCHIVE_BYTES) {
      throw new Error(
        `Archive is ${size} bytes, below the ${MIN_ARCHIVE_BYTES}-byte floor — treating as a failed dump.`
      );
    }
    if (previousBytes && size < previousBytes * 0.5) {
      throw new Error(
        `Archive is ${size} bytes, under half of the previous run's ${previousBytes} — treating as truncated.`
      );
    }
    console.log(`      ${size} bytes`);

    console.log("[3/5] age encrypt");
    await run([
      "age",
      "--encrypt",
      "--recipient",
      env.AGE_PUBLIC_KEY,
      "--output",
      encrypted,
      archive,
    ]);

    if (skipUpload) {
      console.log(`[4/5] --skip-upload: encrypted archive left at ${encrypted}`);
      console.log("[5/5] done (not uploaded)");
      // Deliberately NOT deleted in this mode: the point of --skip-upload is to
      // hand a human an artifact to try a restore against.
      return;
    }

    // The AWS CLI speaks R2's S3-compatible API. `region=auto` is R2's
    // requirement; the R2 token is scoped to this one bucket and has no delete
    // and no list, so this process can add history and never rewrite it.
    const awsEnv = {
      PATH: process.env.PATH ?? "",
      AWS_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID,
      AWS_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY,
      AWS_DEFAULT_REGION: "auto",
      AWS_REGION: "auto",
      // AWS CLI v2 started sending CRC32 trailers that R2 rejects on some
      // paths; "when_required" keeps the upload compatible.
      AWS_REQUEST_CHECKSUM_CALCULATION: "when_required",
    };

    const targets = [`daily/${day}/dump.gz.age`];
    // First of the month gets a second copy under a slower-expiring prefix, so
    // "restore to how it looked in March" survives the 30-day daily window.
    if (now.getUTCDate() === 1) targets.push(`monthly/${month}/dump.gz.age`);

    for (const [index, key] of targets.entries()) {
      console.log(`[4/5] upload ${index + 1}/${targets.length}: ${key}`);
      await run(
        [
          "aws",
          "s3",
          "cp",
          encrypted,
          `s3://${env.R2_BUCKET}/${key}`,
          "--endpoint-url",
          env.R2_ENDPOINT,
          "--only-show-errors",
        ],
        { env: awsEnv }
      );
    }

    console.log("[5/5] done");
    // Machine-readable last line so the workflow can carry the size forward into
    // tomorrow's BACKUP_PREVIOUS_BYTES.
    console.log(`BACKUP_BYTES=${size}`);
  } finally {
    if (!skipUpload) {
      // The plaintext archive must not outlive the run, even on failure.
      await rm(workDir, { recursive: true, force: true });
    } else {
      await rm(archive, { force: true });
    }
  }
};

backup().catch((error) => {
  // Loud and non-zero: a silently failing backup is indistinguishable from no
  // backup, which is the state this script exists to end. The workflow must
  // treat a non-zero exit as a page, not an email nobody reads.
  console.error("BACKUP FAILED:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
