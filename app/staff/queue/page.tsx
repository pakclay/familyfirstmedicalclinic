import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { SignOutButton } from "@/components/console/sign-out-button"

export default async function StaffQueuePage() {
  const session = await auth()
  if (!session?.user) redirect("/login")

  return (
    <main className="flex min-h-full flex-col p-6">
      <div className="mb-6 flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {session.user.name} · Front desk
        </span>
        <SignOutButton />
      </div>
      <h1 className="text-2xl font-heading font-semibold">Queue board</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        The live queue board (Call Next, Recall, Assign Doctor, priority ordering) lands in M3.
      </p>
    </main>
  )
}
