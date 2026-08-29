/**
 * The name a patient sees for a branch. Branch names carry only the
 * location ("Cebu City") because admin-facing UI already renders them
 * beside their clinic; a patient gets no such context, so every public
 * surface — booking page, display screen, status page, SMS — composes the
 * full "{clinic} – {branch}" identity instead. See DECISIONS.md.
 */
export function publicBranchName(branch: { name: string; clinic: { name: string } }): string {
  return `${branch.clinic.name} – ${branch.name}`
}
