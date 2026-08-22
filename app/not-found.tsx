import Link from "next/link"
import { Button } from "@/components/ui/button"

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-heading font-semibold">404 — Page not found</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        The page you&apos;re looking for doesn&apos;t exist, or the link may be out of date.
      </p>
      <Button asChild className="h-11">
        <Link href="/">Go home</Link>
      </Button>
    </main>
  )
}
