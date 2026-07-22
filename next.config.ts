import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // firebase-admin is a Node-only package; keep it external so Next require()s it
  // at runtime rather than bundling it into the server output. (jsonwebtoken was
  // removed in favor of jose, which bundles cleanly.)
  serverExternalPackages: ["firebase-admin"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
      {
        protocol: "https",
        hostname: "via.placeholder.com",
      },
    ],
  },
};

export default nextConfig;
