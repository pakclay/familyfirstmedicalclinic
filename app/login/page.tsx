import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { LoginForm } from "./login-form"

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Family First Medical Clinic</CardTitle>
          <CardDescription>Staff and doctor sign-in.</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm next={next ?? "/"} />
        </CardContent>
      </Card>
    </main>
  )
}
