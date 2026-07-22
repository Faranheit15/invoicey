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

const connectDB = async () => {
  try {
    if (mongoose.connection.readyState >= 1) {
      return;
    }
    await mongoose.connect(MONGODB_URI, {
      dbName: "invoicey",
    });
    console.log("MongoDB connected");
  } catch (error) {
    // Do NOT process.exit here: this runs inside request handlers, and exiting
    // would drop every concurrent in-flight request on a single transient blip.
    // Re-throw so the individual request fails with a 500 and the process survives.
    console.error("MongoDB connection error:", error);
    throw error;
  }
};

export default connectDB;