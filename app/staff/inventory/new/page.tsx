import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { NewMedicineForm } from "./new-medicine-form"

export default async function NewMedicinePage() {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (session.user.role !== "CLINIC_ADMIN") redirect("/staff/inventory")

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-heading font-semibold">Add medicine</h1>
      <div className="mt-4">
        <NewMedicineForm />
      </div>
    </div>
  )
}
