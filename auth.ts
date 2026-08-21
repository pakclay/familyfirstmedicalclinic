import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/db/prisma"
import { authConfig } from "@/auth.config"

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: {},
        password: {},
      },
      async authorize(credentials) {
        const email = credentials?.email
        const password = credentials?.password
        if (typeof email !== "string" || typeof password !== "string") return null

        const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } })
        if (!user || !user.isActive) return null

        const valid = await bcrypt.compare(password, user.passwordHash)
        if (!valid) return null

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          clinicId: user.clinicId,
          holdingCompanyId: user.holdingCompanyId,
          mustChangePassword: user.mustChangePassword,
        }
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user }) {
      if (user) {
        // authorize() above always returns a real id; NextAuth's base User
        // type just declares it optional for providers that don't.
        token.id = user.id!
        token.role = user.role
        token.clinicId = user.clinicId
        token.holdingCompanyId = user.holdingCompanyId
        token.mustChangePassword = user.mustChangePassword
        return token
      }

      // Re-check isActive on every request (not just at login) so a
      // deactivation takes effect on the user's next navigation. Auth.js's
      // Credentials provider only supports JWT sessions, not database
      // sessions, so this re-check inside the jwt callback is the closest
      // equivalent to "revoke a session immediately" available here — it
      // takes effect on the next request, not necessarily mid-request on
      // an already-open tab. Only reachable from auth.ts's Node.js-runtime
      // callers (route handlers, server components) — middleware uses
      // auth.config.ts's edge-safe callbacks instead, which never touch
      // Prisma.
      const current = await prisma.user.findUnique({ where: { id: token.id } })
      if (!current || !current.isActive) {
        return null
      }
      token.role = current.role
      token.clinicId = current.clinicId
      token.holdingCompanyId = current.holdingCompanyId
      token.mustChangePassword = current.mustChangePassword
      return token
    },
  },
})
