import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { RegisterWalkInFlow } from "./register-walk-in-flow"

export default async function RegisterWalkInPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (session.user.role === "HOLDING_ADMIN") {
    return (
      <div>
        <h1 className="text-2xl font-heading font-semibold">Register walk-in</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          A holding admin isn&apos;t scoped to one clinic — walk-in registration happens at a specific
          clinic&apos;s front desk.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-heading font-semibold">Register walk-in</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Search by name or mobile number first, so a returning patient keeps the record they already have.
      </p>
      <div className="mt-4">
        <RegisterWalkInFlow />
      </div>
    </div>
  )
}
