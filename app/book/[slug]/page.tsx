import { notFound } from "next/navigation"
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
    <main className="mx-auto max-w-md p-4">
      <h1 className="text-2xl font-heading font-semibold">{clinic.name}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{clinic.address}</p>
      <p className="mt-3 text-sm text-muted-foreground">
        Book a same-day or next-day visit. We&apos;ll give you a queue number and a link to check your status.
      </p>
      <div className="mt-4">
        <BookingForm slug={slug} />
      </div>
    </main>
  )
}
