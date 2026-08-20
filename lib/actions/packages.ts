"use server"

import { requireSession } from "@/lib/auth/guards"
import { listActivePackagesFor, sellPackageFor, type SellPackageInput } from "@/lib/queries/packages"

export async function listActivePackages(patientId: string) {
  const user = await requireSession()
  return listActivePackagesFor(user, patientId)
}

export async function sellPackage(input: SellPackageInput) {
  const user = await requireSession()
  return sellPackageFor(user, input)
}
