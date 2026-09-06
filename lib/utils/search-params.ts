/**
 * `searchParams` values from the URL, as Next actually delivers them.
 *
 * A page declares `searchParams: Promise<{ q?: string }>` and the type-checker
 * believes it — but Next resolves a repeated key (`?q=a&q=b`) to `["a", "b"]`
 * (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/
 * page.md, "searchParams"). Every page here that then trimmed the value or
 * handed it to a Prisma `contains` threw inside the render, and the visitor
 * got the error boundary for what was, at worst, a hand-edited URL. The
 * pages found doing it: /console/users, /console/audit-log (seven of its
 * nine filters), /staff/patients, /staff/inventory, /console/users/new.
 *
 * So: type the prop with `SearchParam`, and pass each value through
 * `firstParam` at the page boundary — the one place untyped request data
 * enters — before it reaches a query function whose signature honestly says
 * `string`. Keeping the coercion at the boundary is deliberate: hardening
 * every query function against arrays instead would spread the same
 * defensive branch across the whole lib/queries layer to guard a case that
 * only the URL can produce.
 */
export type SearchParam = string | string[] | undefined

/**
 * The single value a page should act on. For a repeated key that is the
 * FIRST occurrence — the same choice `URLSearchParams.get` makes, and the
 * one a form re-submitting its own fields would have produced. An empty
 * array (not something Next emits, but cheap to be right about) is treated
 * as absent.
 */
export function firstParam(value: SearchParam): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}
