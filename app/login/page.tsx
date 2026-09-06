import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { getAppName } from "@/lib/branding"
import { LoginForm } from "./login-form"
import { firstParam, type SearchParam } from "@/lib/utils/search-params"

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: SearchParam; passwordChanged?: SearchParam }>
}) {
  const params = await searchParams
  const next = firstParam(params.next)
  const passwordChanged = firstParam(params.passwordChanged)
  const appName = await getAppName()

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">{appName}</CardTitle>
          <CardDescription>Staff and doctor sign-in.</CardDescription>
        </CardHeader>
        <CardContent>
          {passwordChanged && (
            <p className="mb-4 rounded-md border border-border bg-muted px-3 py-2 text-sm">
              Password changed. Sign in with your new password.
            </p>
          )}
          <LoginForm next={next ?? "/"} />
        </CardContent>
      </Card>
    </main>
  )
}
