import { cache } from "react"
import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/db/prisma"
import { authConfig } from "@/auth.config"
import { isLockedOut, recordFailedLogin, recordSuccessfulLogin } from "@/lib/queries/users"

const {
  handlers,
  signIn,
  signOut,
  auth: uncachedAuth,
} = NextAuth({
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

        // Checked before the password compare so a locked-out account can't
        // be brute-forced by attempts that would otherwise still reach
        // bcrypt.compare — and before recording anything, so a lockout
        // doesn't get its own expiry pushed out by attempts made while
        // already locked.
        if (isLockedOut(user)) return null

        const valid = await bcrypt.compare(password, user.passwordHash)
        if (!valid) {
          // Deliberately doesn't distinguish "wrong password" from "now
          // locked out" in the response — same generic failure either way,
          // both to authorize() callers and to the login form (see
          // app/login/actions.ts). Revealing lockout state specifically
          // would tell an attacker their attempts are being counted at all.
          await recordFailedLogin(user.id, user.failedLoginAttempts)
          return null
        }
        await recordSuccessfulLogin(user.id)

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          branchId: user.branchId,
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
        token.branchId = user.branchId
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
      // callers (route handlers, server components) — proxy.ts uses
      // auth.config.ts's Prisma-free callbacks instead. See auth.config.ts.
      //
      // The whole re-check is wrapped so a *failed* query can't be mistaken
      // for a deactivated account. Auth.js turns any throw in this callback
      // into a null session — i.e. a silent sign-out — so without this catch
      // a transient database error (a connection-pool timeout, a pooler
      // dropping the connection after the preceding interactive transaction,
      // a cold database branch) logs the user out mid-session with nothing
      // in the logs to say why. On a query failure we keep the existing
      // token: it fails open for a single request, the re-check runs again
      // on the next navigation, and a genuinely deactivated user is still
      // caught then. Only a query that *succeeds* and comes back
      // missing/inactive signs the user out.
      try {
        const current = await prisma.user.findUnique({ where: { id: token.id } })
        if (!current) {
          console.error("[auth] signing out: no user row for token id", { userId: token.id })
          return null
        }
        if (!current.isActive) {
          console.error("[auth] signing out: user is deactivated", { userId: token.id })
          return null
        }
        token.role = current.role
        token.branchId = current.branchId
        token.holdingCompanyId = current.holdingCompanyId
        token.mustChangePassword = current.mustChangePassword
        return token
      } catch (error) {
        console.error("[auth] isActive re-check failed — keeping session for this request", {
          userId: token.id,
          error: error instanceof Error ? error.message : String(error),
        })
        return token
      }
    },
  },
})

export { handlers, signIn, signOut }

/**
 * Request-memoised `auth()`.
 *
 * The `jwt` callback above re-reads the user row on every invocation, and
 * `auth()` is called several times while rendering one page — the shell
 * header needs the session, and so does each page, independently. Measured
 * on `/console/users`, that was three identical
 * `SELECT ... FROM users WHERE id = $1` round trips for a single
 * navigation. Against a database in another region that is most of the
 * page's latency, and it is pure duplication: all three run within one
 * request and cannot disagree.
 *
 * React's `cache` collapses them to one *per request*, which leaves the
 * isActive re-check exactly as strong as it was — the guarantee is that a
 * deactivation takes effect on the user's next navigation, and the lookup
 * still happens once on every navigation. It is not a TTL and nothing is
 * shared between requests or between users.
 *
 * It also makes the fail-open path above resolve once rather than three
 * times: a transient query failure now yields one outcome for the whole
 * request, instead of the header and the page each rolling the dice
 * separately and potentially disagreeing.
 *
 * Every caller uses the no-argument form, so the wrapper only needs that
 * one; proxy.ts builds its own Prisma-free instance from auth.config.ts
 * and is unaffected.
 */
export const auth = cache(() => uncachedAuth())
