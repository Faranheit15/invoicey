import mongoose from 'mongoose';
import dns from 'node:dns';

const MONGODB_URI = process.env.MONGODB_URI || '';

if (!MONGODB_URI) {
  throw new Error("MONGODB_URI is not defined in .env.local");
}

// Optional DNS override. `mongodb+srv://` requires an SRV lookup via Node's
// c-ares resolver, which on some dev machines is misconfigured (e.g. a dead
// 127.0.0.1 from a virtual adapter) and refuses the query. Set DNS_SERVERS in
// .env.local (comma-separated) to point the resolver at a working DNS, e.g.
//   DNS_SERVERS=1.1.1.1,8.8.8.8
// Unset in production (Docker/Bun has working DNS), so this is a no-op there.
const dnsServers = (process.env.DNS_SERVERS || '')
  .split(',')
  .map((server) => server.trim())
  .filter(Boolean);
if (dnsServers.length) {
  dns.setServers(dnsServers);
}

// Serverless keeps re-entering this module: every lambda instance is its own
// process, and dev HMR re-evaluates it on each edit. Cache the connection
// *promise* (not just the connection) on globalThis so concurrent cold-start
// requests share one dial-out instead of each opening their own pool.
interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

const globalWithMongoose = globalThis as typeof globalThis & {
  __invoiceyMongoose?: MongooseCache;
};

const cached: MongooseCache = (globalWithMongoose.__invoiceyMongoose ??= {
  conn: null,
  promise: null,
});

const connectDB = async () => {
  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    cached.promise = mongoose
      .connect(MONGODB_URI, {
        dbName: "invoicey",
        // Atlas M0 caps the cluster at 500 connections and the driver defaults
        // to 100 per process, so ~5 busy lambda instances would lock everyone
        // out. A small pool degrades (queued ops) instead of failing globally.
        maxPoolSize: 5,
        // Both timeouts sit well under a serverless execution ceiling: fail the
        // request with a 500 we can see rather than burning the whole invocation
        // budget waiting on an unreachable primary or a half-open socket.
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 20000,
        // INDEXES ARE THE OWNER'S TO BUILD, NOT THE APP'S.
        //
        // Mongoose defaults `autoIndex` to true, so the first request after a
        // cold start fires `createIndex` for every index declared on every
        // model it touches — including the FULL unique index
        // `uniq_user_fy_kind_invoice_number` on a collection that may still
        // contain the duplicates `bun run migrate:invoice-numbering` is
        // supposed to REPORT for a human to resolve. That build is a
        // foreground operation on the primary, its failure is swallowed
        // (Mongoose emits it on the connection, which nothing here listens
        // to), and it happens at whatever moment the first user hits the app.
        //
        // "Build it in the background, off-hours, after the migration" — which
        // is what models/Invoice.ts and the launch runbook both instruct — is
        // not a decision the owner can make while the app is racing them to
        // it. So: no automatic index management. EVERY index this app relies
        // on is now created by hand from the runbook (docs/LAUNCH-PROGRESS.md
        // and docs/runbooks/backup-and-restore.md list them) — including the
        // three query indexes, which are performance, not correctness, and a
        // missing one degrades rather than breaks.
        //
        // `scripts/verify-backup.ts` already passes this same option for the
        // same reason: with it on, the restore drill's index check rebuilt the
        // indexes it was verifying and could never fail. The migrations go
        // through this function too, so `migrate:invoice-numbering` no longer
        // trips the very unique build it exists to prepare for.
        autoIndex: false,
      })
      .then((connection) => {
        console.log("MongoDB connected");
        return connection;
      });
  }

  const pending = cached.promise;
  try {
    cached.conn = await pending;
    return cached.conn;
  } catch (error) {
    // Drop the rejected promise so the next request retries. A cached rejection
    // would be sticky: one transient blip at cold start would poison the module
    // for the lifetime of the instance. Only clear our own attempt, so a retry
    // that another concurrent caller already started is left alone.
    if (cached.promise === pending) {
      cached.promise = null;
    }
    // Do NOT process.exit here: this runs inside request handlers, and exiting
    // would drop every concurrent in-flight request on a single transient blip.
    // Re-throw so the individual request fails with a 500 and the process survives.
    console.error("MongoDB connection error:", error);
    throw error;
  }
};

export default connectDB;