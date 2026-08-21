import type { QueuePriority } from "@prisma/client"

/**
 * §7.3's ordering rule: "all priority entries ahead of normal entries,
 * then by check-in time." Sorted explicitly rather than via Prisma
 * `orderBy` on the priority enum, which would sort alphabetically
 * (`NORMAL` < `PRIORITY`) — coincidentally correct today only because
 * "PRIORITY" happens to sort after "NORMAL", exactly the kind of
 * accidental correctness that silently breaks if the enum is ever
 * renamed. Pure and dependency-free (only a type import) so it's safe to
 * use from both the server query layer and client components that need to
 * re-sort the same list for display without re-fetching.
 */
export function compareQueueOrder(
  a: { priority: QueuePriority; checkedInAt: Date | null },
  b: { priority: QueuePriority; checkedInAt: Date | null }
): number {
  const aTier = a.priority === "PRIORITY" ? 0 : 1
  const bTier = b.priority === "PRIORITY" ? 0 : 1
  if (aTier !== bTier) return aTier - bTier
  return (a.checkedInAt?.getTime() ?? 0) - (b.checkedInAt?.getTime() ?? 0)
}
