"use server"

import { headers } from "next/headers"
import { AuthError } from "next-auth"
import { signIn } from "@/auth"
import { clientIpFromHeaders } from "@/lib/rate-limit/key"
import { blockedMessage, consumeRateLimit } from "@/lib/rate-limit/limiter"
import { LOGIN_RATE_LIMIT } from "@/lib/rate-limit/policy"

export type LoginState = { error: string | null }

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "")
  const password = String(formData.get("password") ?? "")
  const next = String(formData.get("next") ?? "/")

  // Per-SOURCE throttle, checked before the credential check — so a
  // blocked caller never reaches `signIn`, never touches the `users` table
  // and never spends a bcrypt compare. Deliberately enforced HERE rather
  // than in proxy.ts: that file is Prisma-free on purpose (see its header
  // comment), and its matcher covers nearly every route, so a
  // database-backed check there would put a query on every navigation in
  // the app to protect two actions.
  //
  // The per-ACCOUNT lockout in lib/queries/users.ts still runs afterwards,
  // inside auth.ts's authorize(), exactly as before — this is an
  // additional control, not a replacement.
  //
  // `headers()` is the way to reach the request here: `NextRequest.ip` was
  // removed in Next.js 15 and this app is on 16. See lib/rate-limit/key.ts
  // for which header is actually trustworthy and why.
  const ip = clientIpFromHeaders(await headers())
  const decision = await consumeRateLimit(LOGIN_RATE_LIMIT, ip)
  const blocked = blockedMessage(LOGIN_RATE_LIMIT, decision)
  // Returned as the form's normal error string, so LoginForm surfaces it
  // in place of the generic credential message. Being specific is safe
  // here and generic is *not* — the reasoning is on `rateLimitMessage` in
  // lib/rate-limit/policy.ts.
  if (blocked) return { error: blocked }

  // Note what is deliberately absent: nothing resets this counter on a
  // successful sign-in. The per-account lockout clears on success because
  // a correct password proves the actor owns that account; a shared source
  // address proves nothing of the sort, and resetting on success would let
  // anyone holding one valid credential (their own included) clear the
  // budget at will and spray indefinitely between resets.
  try {
    await signIn("credentials", { email, password, redirectTo: next })
    return { error: null }
  } catch (err) {
    if (err instanceof AuthError) {
      return { error: "Incorrect email or password." }
    }
    throw err
  }
}
