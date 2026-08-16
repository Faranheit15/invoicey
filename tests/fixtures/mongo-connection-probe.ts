/**
 * Runs in its own `bun run` process (see tests/db-connection.test.ts).
 *
 * `lib/mongodb.ts` caches on globalThis and is mocked away by several other
 * suites — Bun's module mocks are process-wide and leak across files — so the
 * only way to exercise the real module is from a clean process.
 *
 * Prints one JSON line describing what the module did with a faked mongoose.
 */
import { mock } from "bun:test";

process.env.MONGODB_URI = "mongodb://probe.invalid:27017/invoicey";

let connectCalls = 0;
let shouldFail = true;
const optionsSeen: Record<string, unknown>[] = [];

const fakeMongoose = {
  connect: async (_uri: string, options: Record<string, unknown>) => {
    connectCalls += 1;
    optionsSeen.push(options);
    if (shouldFail) {
      throw new Error("connection refused");
    }
    return fakeMongoose;
  },
};

mock.module("mongoose", () => ({ default: fakeMongoose }));

const { default: connectDB } = await import("@/lib/mongodb");

const firstAttemptRejected = await connectDB().then(
  () => false,
  () => true
);
const callsAfterFailure = connectCalls;

shouldFail = false;
const retryRecovered = await connectDB().then(
  () => true,
  () => false
);
const callsAfterRetry = connectCalls;

// Reset to an unconnected cache to observe what concurrent cold-start requests
// do. The module holds a reference to this object, so it has to be mutated in
// place rather than replaced.
const cache = (globalThis as Record<string, unknown>)
  .__invoiceyMongoose as Record<string, unknown>;
cache.conn = null;
cache.promise = null;
await Promise.all([connectDB(), connectDB(), connectDB()]);
const callsAfterConcurrentBurst = connectCalls - callsAfterRetry;

await connectDB();
const callsAfterWarmCall = connectCalls;

console.log(
  `PROBE_RESULT ${JSON.stringify({
    firstAttemptRejected,
    callsAfterFailure,
    retryRecovered,
    callsAfterRetry,
    callsAfterConcurrentBurst,
    reconnectedWhenWarm: callsAfterWarmCall !== callsAfterRetry + 1,
    options: optionsSeen[0] ?? null,
  })}`
);
