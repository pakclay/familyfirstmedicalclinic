import Link from "next/link"
import { Button } from "@/components/ui/button"

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 bg-background px-4 text-center">
      <div>
        <p className="font-heading text-3xl font-bold tracking-tight text-foreground">Stretch Lab PH</p>
        <p className="mt-2 text-muted-foreground">Performance Recovery · Body Tune-Up · Pain Management</p>
      </div>
      <p className="max-w-md text-sm text-muted-foreground">
        The public booking site lands in Phase 7. For now, staff can sign in to the console.
      </p>
      <Button asChild>
        <Link href="/login">Staff sign-in</Link>
      </Button>
    </div>
  )
}
