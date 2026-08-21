import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { SignOutButton } from "@/components/console/sign-out-button"

export default async function DoctorQueuePage() {
  const session = await auth()
  if (!session?.user) redirect("/login")

  return (
    <main className="flex min-h-full flex-col p-6">
      <div className="mb-6 flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          Dr. {session.user.name}
        </span>
        <SignOutButton />
      </div>
      <h1 className="text-2xl font-heading font-semibold">My queue</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Patients assigned to you land in M3; the consultation screen lands in M4.
      </p>
    </main>
  )
}
