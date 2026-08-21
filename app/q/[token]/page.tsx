import { notFound } from "next/navigation"
import { getPatientStatusByToken } from "@/lib/queries/public-queue"
import { StatusScreen } from "./status-screen"

export default async function PatientStatusPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const status = await getPatientStatusByToken(token)
  if (!status) notFound()

  return <StatusScreen initialStatus={status} />
}
