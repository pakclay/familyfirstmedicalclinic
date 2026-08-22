import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { ReceiveStockForm } from "./receive-stock-form"

export default async function ReceiveStockPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (session.user.role === "HOLDING_ADMIN" || session.user.role === "DOCTOR") redirect("/staff/inventory")

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-heading font-semibold">Receive stock</h1>
      <p className="mt-1 text-sm text-muted-foreground">Record a delivery — this raises the medicine&apos;s stock.</p>
      <div className="mt-4">
        <ReceiveStockForm />
      </div>
    </div>
  )
}
