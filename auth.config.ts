import type { NextAuthConfig } from "next-auth"

/**
 * Edge-safe base config, shared by middleware (which runs on Next.js's
 * Edge runtime, where Prisma Client can't run without Accelerate or
 * Driver Adapters) and the full config in auth.ts (Node.js runtime).
 * Providers and any Prisma-touching callback live only in auth.ts —
 * putting the isActive re-check's `prisma.user.findUnique` here breaks
 * middleware with a PrismaClientValidationError.
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
