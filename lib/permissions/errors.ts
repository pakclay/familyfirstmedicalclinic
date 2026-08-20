/**
 * Thrown by the query layer when a role has no access at all to a
 * resource/action. Deliberately loud — §4.2 requires a forbidden read to
 * fail as a 403-equivalent, never silently degrade to an empty list, so a
 * broken check is impossible to miss in a test.
 */
export class ForbiddenError extends Error {
  status = 403 as const

  constructor(message = "Forbidden") {
    super(message)
    this.name = "ForbiddenError"
  }
}
