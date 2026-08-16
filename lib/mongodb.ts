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