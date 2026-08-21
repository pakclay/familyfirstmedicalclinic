import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Enables next/navigation's forbidden()/unauthorized(), which render a
    // real HTTP 403/401 (via app/forbidden.tsx, app/unauthorized.tsx) —
    // used by the clinic-scoping check (§5) so a cross-clinic read is a
    // genuine 403, not just a typed error with no real status code.
    authInterrupts: true,
  },
};

export default nextConfig;
