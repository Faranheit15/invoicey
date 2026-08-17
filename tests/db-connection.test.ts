import { describe, it, expect } from "bun:test";

// The probe runs the real lib/mongodb.ts in a clean process; see the file header.
const probePath = new URL(
  "./fixtures/mongo-connection-probe.ts",
  import.meta.url
).pathname;

const proc = Bun.spawnSync(["bun", "run", probePath], {
  cwd: new URL("../", import.meta.url).pathname,
});
const stdout = proc.stdout.toString();
const line = stdout.split("\n").find((l) => l.startsWith("PROBE_RESULT "));
if (!line) {
  throw new Error(
    `probe produced no result:\n${stdout}\n${proc.stderr.toString()}`
  );
}
const result = JSON.parse(line.slice("PROBE_RESULT ".length)) as {
  firstAttemptRejected: boolean;
  callsAfterFailure: number;
  retryRecovered: boolean;
  callsAfterRetry: number;
  callsAfterConcurrentBurst: number;
  reconnectedWhenWarm: boolean;
  options: Record<string, unknown> | null;
};

describe("connectDB — pooling and caching", () => {
  it("still rejects (rather than exiting) when the connection fails", () => {
    expect(result.firstAttemptRejected).toBe(true);
    expect(result.callsAfterFailure).toBe(1);
  });

  it("does not cache the rejection — the next request retries", () => {
    expect(result.retryRecovered).toBe(true);
    expect(result.callsAfterRetry).toBe(2);
  });

  it("collapses a concurrent cold start into a single connect", () => {
    expect(result.callsAfterConcurrentBurst).toBe(1);
  });

  it("reuses the cached connection once it is established", () => {
    expect(result.reconnectedWhenWarm).toBe(false);
  });

  it("caps the pool so lambda instances cannot exhaust the Atlas cluster", () => {
    expect(result.options?.maxPoolSize).toBe(5);
  });

  it("bounds selection and socket waits inside a lambda's execution ceiling", () => {
    expect(result.options?.serverSelectionTimeoutMS).toBe(5000);
    expect(result.options?.socketTimeoutMS).toBe(20000);
  });

  it("never builds indexes itself — that is the owner's off-hours job", () => {
    // Mongoose defaults this to true, which would have the first request after
    // a cold start foreground-build the FULL unique invoice-number index on a
    // collection that may still hold the duplicates the migration is meant to
    // report. The failure is swallowed, so it would fail invisibly too.
    expect(result.options?.autoIndex).toBe(false);
  });
});
