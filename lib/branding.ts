import { cache } from "react"
import { prisma } from "@/lib/db/prisma"

/**
 * The app-wide product name — browser tab title, login card, the header on
 * every authenticated shell, and the kicker on the public booking page.
 *
 * It lives on `holding_companies.brand_name` rather than in a constant so a
 * holding admin can change it from /console/admin without a deploy. This
 * file is the read side; lib/queries/branding.ts is the write side.
 *
 * Deliberately *not* the same field as `HoldingCompany.name`: that is the
 * legal entity ("Family First Holdings"), shown as such on the admin
 * overview. Overloading one field would rename both at once, and they are
 * not the same thing to the people reading them.
 */
export const DEFAULT_APP_NAME = "Family First Medical Clinic"

/**
 * Single-tenant by design — the data model has exactly one holding company
 * per deployment (see lib/dto/clinic.ts), and the callers that need this
 * most (the root layout's title, the login card, the booking page) have no
 * session to scope by. `findFirst` with a stable order rather than a bare
 * `findFirst` so a second company row, if one ever existed, would at least
 * resolve to the same one on every request instead of flapping.
 *
 * Wrapped in `cache` so the several callers that can run in one render —
 * root layout metadata plus a nested layout, say — share a single query.
 */
export const getAppName = cache(async (): Promise<string> => {
  try {
    const company = await prisma.holdingCompany.findFirst({
      orderBy: { createdAt: "asc" },
      select: { brandName: true },
    })
    // Trim guards the case where the column holds whitespace from an older
    // write path; an empty result is "not set", not a blank page title.
    return company?.brandName?.trim() || DEFAULT_APP_NAME
  } catch {
    // A cosmetic string must never be what takes the app down. The login
    // page in particular used to render with no database access at all, and
    // making it hard-depend on a query would turn a database blip into
    // "nobody can even reach the sign-in form".
    return DEFAULT_APP_NAME
  }
})
