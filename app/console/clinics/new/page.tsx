import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { NewClinicForm } from "./new-clinic-form"

export default async function NewClinicPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (session.user.role !== "HOLDING_ADMIN") {
    redirect("/console/clinics")
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-heading font-semibold">Add clinic</h1>
      <div className="mt-4">
        <NewClinicForm />
      </div>
    </div>
  )
}
