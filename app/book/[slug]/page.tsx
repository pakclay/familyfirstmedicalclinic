import { notFound } from "next/navigation"
import { CalendarCheck } from "lucide-react"
import { prisma } from "@/lib/db/prisma"
import { BookingForm } from "./booking-form"

export default async function BookPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const clinic = await prisma.clinic.findUnique({
    where: { slug, isActive: true },
    select: { name: true, address: true },
  })
  if (!clinic) notFound()

  return (
    <main className="min-h-screen bg-muted">
      <div className="border-b border-border bg-sidebar text-sidebar-foreground">
        <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 pt-10 pb-8 text-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-brand text-primary-foreground">
            <CalendarCheck className="size-5" aria-hidden />
          </span>
          <div>
            <p className="text-xs font-medium tracking-wide text-sidebar-foreground/60 uppercase">Family First</p>
            <h1 className="mt-1 font-heading text-xl font-semibold">{clinic.name}</h1>
            <p className="mt-1 text-sm text-sidebar-foreground/70">{clinic.address}</p>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-md p-4">
        <p className="mt-2 text-center text-sm text-muted-foreground">
          Book a same-day or next-day visit. We&apos;ll give you a queue number and a link to check your status.
        </p>
        <div className="mt-4 pb-8">
          <BookingForm slug={slug} />
        </div>
      </div>
    </main>
  )
}
