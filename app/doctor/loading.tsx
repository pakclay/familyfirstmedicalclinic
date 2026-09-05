import { PageSkeleton } from "@/components/page-skeleton"

/**
 * Shown immediately on navigation into this shell, while the destination
 * segment renders on the server. See components/page-skeleton.tsx for why
 * every authenticated shell needs one.
 */
export default function Loading() {
  return <PageSkeleton />
}
