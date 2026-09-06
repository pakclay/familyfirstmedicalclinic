/**
 * The sentence the calling board (app/now-serving) speaks when a patient
 * is called. Configured per branch by its admin (/console/settings) and
 * stored on `branches.announcement_template`; NULL means "use the default".
 *
 * Two placeholders: `{number}` is the queue number and `{name}` the
 * patient, first name first (the board's spokenName). At least one is
 * required — without either, every call sounds identical. Anything else
 * in braces is refused at validation time, because a typo like `{nmae}`
 * would otherwise be read aloud, verbatim, to a waiting room on every
 * call until someone noticed.
 */

export const ANNOUNCEMENT_PLACEHOLDERS = ["{number}", "{name}"] as const

export const DEFAULT_ANNOUNCEMENT_TEMPLATE = "Now serving number {number}, {name}. Please come to the front desk."

/** Room for a sentence or two. Anything longer is a mistake, not a longer announcement. */
export const ANNOUNCEMENT_TEMPLATE_MAX_LENGTH = 200

/** Sample values for the settings form's preview and "hear it" button. */
export const ANNOUNCEMENT_SAMPLE = { number: 1, name: "Maria Santos" } as const

const PLACEHOLDER = /\{([^{}]*)\}/g

/**
 * Why a template can't be used, as a sentence for the admin, or null when
 * it can. Shared by the zod schema (lib/validation/branch.ts) and the
 * settings form, so the form can say what's wrong before a round trip and
 * the server refuses exactly the same things.
 */
export function announcementTemplateProblem(template: string): string | null {
  const trimmed = template.trim()
  if (trimmed.length === 0) return "Enter an announcement, or leave it blank to use the default."
  if (trimmed.length > ANNOUNCEMENT_TEMPLATE_MAX_LENGTH) {
    return `Keep the announcement under ${ANNOUNCEMENT_TEMPLATE_MAX_LENGTH} characters.`
  }
  const known = new Set<string>(ANNOUNCEMENT_PLACEHOLDERS)
  const found = trimmed.match(PLACEHOLDER) ?? []
  const unknown = found.find((p) => !known.has(p))
  if (unknown) return `${unknown} isn't a placeholder — use {number} and {name}.`
  if (found.length === 0) return "Include {number} or {name}, otherwise every call sounds the same."
  return null
}

export type AnnouncementValues = { number: number; name: string }

/**
 * Fills the template in. A null or blank template — a branch that never
 * set one, or cleared it — gets the default. Never throws, and leaves any
 * unknown placeholder in place: the board must say *something* even if a
 * bad template somehow reached the database.
 */
export function renderAnnouncement(template: string | null | undefined, values: AnnouncementValues): string {
  const source = template && template.trim().length > 0 ? template.trim() : DEFAULT_ANNOUNCEMENT_TEMPLATE
  return source.replace(PLACEHOLDER, (match, key: string) => {
    if (key === "number") return String(values.number)
    if (key === "name") return values.name
    return match
  })
}
