import Link from "next/link"
import { CompassIcon } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-8 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <CompassIcon className="size-5" aria-hidden />
      </span>
      <h1 className="text-2xl font-heading font-semibold">404 — Page not found</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        The page you&apos;re looking for doesn&apos;t exist, or the link may be out of date.
      </p>
      <Button asChild className="mt-1 h-11">
        <Link href="/">Go home</Link>
      </Button>
    </main>
  )
}
