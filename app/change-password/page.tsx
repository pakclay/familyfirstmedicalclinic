import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { ChangePasswordForm } from "./change-password-form"

export default async function ChangePasswordPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Change password</CardTitle>
          <CardDescription>
            {session.user.mustChangePassword
              ? "You must change your password before continuing."
              : "Update the password on your account."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>
    </main>
  )
}
