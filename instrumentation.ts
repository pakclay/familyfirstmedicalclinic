import type { Instrumentation } from "next"

/**
 * Server-side error reporting — the documented, guaranteed hook for it.
 *
 * This exists because a production fault on /console/admin was reported
 * twice and could not be read either time. The browser is told nothing
 * useful by design: `app/error.tsx` is deliberately generic, and React
 * replaces a Server Component's message before it reaches the client
 * anyway (error.md, "error.message": "Errors forwarded from Server
 * Components show a generic message with an identifier"). And `vercel logs`
 * showed no entry for the route — whether because the failing path did not
 * reach one of Next's own `logError` calls or because the window had simply
 * rolled by the time it was searched, which is exactly the ambiguity worth
 * removing.
 *
 * `onRequestError` is Next's supported way to see every server error,
 * whatever the path: the docs describe it as tracking "**server** errors to
 * any custom observability provider", and it fires wherever the server
 * captures one. Logging the digest here is the load-bearing part — it is
 * the same identifier `app/error.tsx` puts on screen, so a screenshot can
 * be matched to a stack trace instead of guessed at.
 *
 * DELIBERATELY DOES NOT LOG `request.headers`. They carry the session cookie,
 * and this app's own rule is that a log written for us must never become a
 * credential store (SECURITY.md; lib/db/errors.ts makes the mirror-image
 * point about messages written for the user). Path, method and route are
 * enough to find the code; the digest is what ties a user's screenshot to
 * the line in the log.
 */
export const onRequestError: Instrumentation.onRequestError = (err, request, context) => {
  const error = err instanceof Error ? err : undefined
  // React may replace the thrown instance during Server Component rendering,
  // so `digest` — not the class name — is what the client's error boundary
  // shows and therefore what a user can quote back.
  const digest =
    typeof err === "object" && err !== null && "digest" in err ? String((err as { digest: unknown }).digest) : undefined

  console.error(
    `[server-error] ${request.method} ${request.path} — ${context.routePath} (${context.routeType}/${context.renderSource})`,
    {
      name: error?.name ?? typeof err,
      message: error?.message ?? String(err),
      digest,
      // The stack names our own file and line, which is the whole point on a
      // platform where the browser is told nothing.
      stack: error?.stack,
      cause: error?.cause instanceof Error ? error.cause.message : undefined,
    }
  )
}
