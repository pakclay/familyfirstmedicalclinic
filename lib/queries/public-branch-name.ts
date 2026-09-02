/**
 * The name a patient sees for a branch. Branch names carry only the
 * location ("Cebu City") because admin-facing UI already renders them
 * beside their clinic; a patient gets no such context, so every public
 * surface — booking page, display screen, status page, SMS — composes the
 * full "{clinic} – {branch}" identity instead. See DECISIONS.md.
 *
 * The other half of that contract: a clinic name must NOT carry the
 * location its branches already name. Seeding "Family First Medical Clinic
 * – Quezon City" above a branch called "Quezon City" is what produced
 * "… – Quezon City – Quezon City" on every public surface at once. This is
 * deliberately not defended against here — suppressing a clinic name that
 * looks redundant would also swallow a legitimate one ("Cebu Family Clinic"
 * with a "Cebu City" branch), and a name composer that silently drops parts
 * of the name an admin typed is worse than one that repeats it.
 */
export function publicBranchName(branch: { name: string; clinic: { name: string } }): string {
  return `${branch.clinic.name} – ${branch.name}`
}
