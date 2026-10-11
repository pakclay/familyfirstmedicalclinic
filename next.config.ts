import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cloud Run runs the container image built by ./Dockerfile, which ships
  // only .next/standalone (server.js plus the traced node_modules) rather
  // than the whole dependency tree. See DECISIONS.md 2026-10-11. Not on
  // Vercel: its build adapter expects the default output and fails on
  // standalone ("ENOENT … next-server.js.nft.json"), and it keeps building
  // every push until the cutover.
  output: process.env.VERCEL ? undefined : "standalone",
  // Vercel added HSTS at its edge (SECURITY.md, "TLS"); Cloud Run does not,
  // so the app sends the same policy itself. Browsers ignore it on plain
  // HTTP, so local `next start` is unaffected.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }],
      },
    ]
  },
  experimental: {
    // Enables next/navigation's forbidden()/unauthorized(), which render a
    // real HTTP 403/401 (via app/forbidden.tsx, app/unauthorized.tsx) —
    // used by the clinic-scoping check (§5) so a cross-clinic read is a
    // genuine 403, not just a typed error with no real status code.
    authInterrupts: true,
  },
};

export default nextConfig;
