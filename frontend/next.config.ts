import type { NextConfig } from "next";

// The browser only talks to this Next.js server (same origin, so session cookies work, see
// docs/adr/0001). Requests to /api/* are proxied to the FastAPI backend.
// Note: rewrites are resolved at build time, so BACKEND_INTERNAL_URL must be set when building.
const backendUrl = process.env.BACKEND_INTERNAL_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${backendUrl}/api/:path*` }];
  },
};

export default nextConfig;
