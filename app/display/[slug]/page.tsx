import { notFound } from "next/navigation"
import { getPublicDisplayState } from "@/lib/queries/public-queue"
import { DisplayScreen } from "./display-screen"

export default async function DisplayPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const state = await getPublicDisplayState(slug)
  if (!state) notFound()

  return <DisplayScreen slug={slug} initialState={state} />
}
