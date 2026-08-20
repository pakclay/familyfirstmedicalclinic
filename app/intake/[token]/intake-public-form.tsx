"use client"

import { IntakeForm } from "@/components/patients/intake-form"
import { submitPublicIntake } from "@/lib/actions/intake"
import type { IntakeAnswers } from "@/lib/validation/patient"

export function IntakePublicForm({ branchCode }: { branchCode: string }) {
  return (
    <IntakeForm
      onSubmit={(values: IntakeAnswers) => submitPublicIntake(branchCode, values, "PUBLIC_LINK")}
      submitLabel="Submit intake form"
    />
  )
}
