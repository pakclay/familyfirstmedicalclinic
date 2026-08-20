import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"

import { prisma } from "@/lib/db/prisma"
import type { Role } from "@/lib/permissions/ability"

const IDLE_TIMEOUT_SECONDS = 8 * 60 * 60 // §11: 8-hour idle timeout

export const { handlers, signIn, signOut, auth } = NextAuth({
  // Auth.js requires JWT sessions for the Credentials provider — database
  // sessions aren't supported there. "Owner can revoke a session
  // immediately" (§11) is instead enforced by re-checking isActive/deletedAt
  // against Postgres inside the jwt callback on every request, so a
  // deactivation takes effect on that user's very next navigation.
  session: {
    strategy: "jwt",
    maxAge: IDLE_TIMEOUT_SECONDS,
    updateAge: 30 * 60, // slide the expiry forward on activity, at most every 30 min
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const email = credentials?.email
        const password = credentials?.password
        if (typeof email !== "string" || typeof password !== "string") {
          return null
        }

        const user = await prisma.user.findUnique({
          where: { email: email.toLowerCase() },
        })
        if (!user || !user.isActive || user.deletedAt) return null

        const valid = await bcrypt.compare(password, user.passwordHash)
        if (!valid) return null

        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        })

        return {
          id: user.id,
          email: user.email,
          name: user.name,
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token }) {
      if (!token.sub) return token

      const dbUser = await prisma.user.findUnique({ where: { id: token.sub } })
      if (!dbUser || !dbUser.isActive || dbUser.deletedAt) {
        token.isActive = false
        return token
      }

      token.role = dbUser.role as Role
      token.homeBranchId = dbUser.homeBranchId
      token.mustChangePassword = dbUser.mustChangePassword
      token.isActive = true
      return token
    },
    async session({ session, token }) {
      session.user.id = token.sub!
      session.user.role = token.role as Role
      session.user.homeBranchId = token.homeBranchId as string | null
      session.user.mustChangePassword = token.mustChangePassword as boolean
      session.user.isActive = token.isActive as boolean
      return session
    },
  },
})
