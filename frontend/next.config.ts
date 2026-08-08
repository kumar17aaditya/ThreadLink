import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js's dev server validates the origin of incoming requests to
  // guard against DNS-rebinding attacks. Loopback access via
  // "127.0.0.1" (as opposed to "localhost") isn't allow-listed by
  // default, which otherwise 403s a handful of dynamically-imported
  // dev chunks and silently prevents client-side hydration. This is
  // a dev-only allowance (see Next.js docs on `allowedDevOrigins`),
  // not a production security setting.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
