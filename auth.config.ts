import type { NextAuthConfig } from "next-auth"

/**
 * Prisma-free base config, shared by proxy.ts (route gating) and the full
 * config in auth.ts. Providers and any Prisma-touching callback live only
 * in auth.ts — putting the isActive re-check's `prisma.user.findUnique`
 * here would run a DB query on every request proxy.ts's matcher covers,
 * for a check that already happens at the real authorization boundary
 * (every query-layer call via auth.ts's auth()). Originally this split was
 * forced by middleware.ts always running on Next.js's Edge runtime, where
 * Prisma Client can't run without Accelerate or Driver Adapters; proxy.ts
 * (the Next 16 replacement) runs on the Node.js runtime instead, so that
 * constraint no longer applies — the split is kept anyway, now for the
 * performance/scope reason above. See proxy.ts.
 */
export const authConfig: NextAuthConfig = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    async session({ session, token }) {
      if (!token.id) {
        return { ...session, user: undefined as never }
      }
      session.user.id = token.id
      session.user.role = token.role
      session.user.clinicId = token.clinicId
      session.user.holdingCompanyId = token.holdingCompanyId
      session.user.mustChangePassword = token.mustChangePassword
      return session
    },
  },
}
