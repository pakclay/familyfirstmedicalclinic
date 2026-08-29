import type { Clinic } from "@prisma/client"

/**
 * Clinic is purely organizational after the branch-hierarchy migration —
 * see DECISIONS.md. Explicit field allowlist — no raw Prisma row ever
 * reaches a component. Deliberately excludes holdingCompanyId (an internal
 * FK the UI has no use for; there's exactly one holding company in this
 * app's data model) and updatedAt.
 */
export type ClinicDTO = {
  id: string
  name: string
  createdAt: Date
}

export function toClinicDTO(clinic: Clinic): ClinicDTO {
  return {
    id: clinic.id,
    name: clinic.name,
    createdAt: clinic.createdAt,
  }
}
