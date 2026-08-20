import { LoginForm } from "./login-form"

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <p className="font-heading text-xl font-bold tracking-tight">Stretch Lab PH</p>
          <p className="text-sm text-muted-foreground">Staff console sign-in</p>
        </div>
        <LoginForm searchParams={searchParams} />
      </div>
    </div>
  )
}
