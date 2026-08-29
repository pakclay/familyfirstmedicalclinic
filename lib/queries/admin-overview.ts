import { prisma } from "@/lib/db/prisma"
import { isHoldingAdmin, type AbilitySubject } from "@/lib/permissions/ability"
import { ForbiddenError } from "@/lib/permissions/errors"
import type { Role } from "@prisma/client"

/**
 * The holding admin's control surface over the organization: every clinic,
 * the branches under it, and the accounts attached to those branches, in one
 * read.
 *
 * This exists because the shape an owner administers is a *tree* and the
 * console only had flat slices of it — /console/clinics lists clinic names
 * with no indication of size or health, and /console/users lists every
 * account in the company with no indication of where it sits. Neither
 * answers "which branch has nobody working at it" or "who is locked out
 * this morning", which is what someone opening an admin page is usually
 * there to find out.
 *
 * Holding-admin only, and bounded to the caller's own company. `clinics`,
 * `branches` and `users` carry no RLS policy, so the predicates here are
 * the entire tenant boundary — see requireHoldingCompanyId.
 */

const NOT_A_HOLDING_ADMIN = "Only a holding admin sees the organization overview."

/** Kept small on purpose: an attention list is a prompt to go somewhere, not a place to work. */
export const ATTENTION_LIST_LIMIT = 8

export type OverviewBranch = {
  id: string
  name: string
  city: string
  slug: string
  isActive: boolean
  staffCount: number
}

export type OverviewClinic = {
  id: string
  name: string
  branches: OverviewBranch[]
  staffCount: number
}

export type OverviewAccount = {
  id: string
  name: string
  email: string
  role: Role
  branchName: string | null
}

export type AdminOverview = {
  company: { id: string; name: string } | null
  totals: {
    clinics: number
    branches: number
    inactiveBranches: number
    staff: number
    inactiveStaff: number
    lockedOut: number
    mustChangePassword: number
    strandedInClosedBranch: number
  }
  clinics: OverviewClinic[]
  /** Accounts with no branch — holding admins. Invisible on every clinic and branch page by construction. */
  holdingAccounts: OverviewAccount[]
  attention: {
    lockedOut: OverviewAccount[]
    mustChangePassword: OverviewAccount[]
    clinicsWithoutBranches: { id: string; name: string }[]
    branchesWithoutStaff: { id: string; name: string; clinicId: string; clinicName: string }[]
    /**
     * Active accounts still attached to a deactivated branch. Invisible from
     * every other screen by construction: the clinics pages never load users,
     * and UserDTO carries branchName but not the branch's isActive — so
     * nothing else in the app can express this join. These people can still
     * sign in but their branch is closed, which is the state most likely to
     * be an oversight after a closure.
     */
    strandedInClosedBranch: OverviewAccount[]
  }
}

export async function getAdminOverview(actor: AbilitySubject): Promise<AdminOverview> {
  if (!isHoldingAdmin(actor)) throw new ForbiddenError(NOT_A_HOLDING_ADMIN)
  // Deliberately ForbiddenError rather than requireHoldingCompanyId, whose
  // plain Error would surface as a 500. This backs a top-level nav
  // destination, and an account that isn't attached to a company is a data
  // state to refuse cleanly, not a crash. Same shape as
  // getHoldingConsolidatedReport's guard.
  if (!actor.holdingCompanyId) throw new ForbiddenError("This account isn't attached to a holding company.")
  const holdingCompanyId = actor.holdingCompanyId

  // Every account in the company, by either attachment route: through a
  // branch's clinic, or directly for the branchless holding admins.
  const companyUsers = {
    OR: [{ holdingCompanyId }, { branch: { clinic: { holdingCompanyId } } }],
  }
  const now = new Date()

  const lockedWhere = { ...companyUsers, lockedUntil: { gt: now } }
  const mustChangeWhere = { ...companyUsers, mustChangePassword: true, isActive: true }
  // Scoped through the branch relation directly rather than companyUsers:
  // a stranded account necessarily has a branch, so the branchless arm of
  // that OR cannot apply here.
  const strandedWhere = {
    isActive: true,
    branch: { isActive: false, clinic: { holdingCompanyId } },
  }

  // Independent reads, issued together. The clinic query nests branches with
  // a _count of their users, so per-branch staff numbers cost nothing extra
  // — the alternative (a listBranches call per clinic, or a user lookup per
  // branch) is the N+1 this shape exists to avoid.
  const [
    company,
    clinics,
    staffTotals,
    lockedOut,
    mustChangePassword,
    holdingAccounts,
    lockedOutTotal,
    mustChangeTotal,
    stranded,
    strandedTotal,
  ] = await Promise.all([
    prisma.holdingCompany.findUnique({
      where: { id: holdingCompanyId },
      select: { id: true, name: true },
    }),
    prisma.clinic.findMany({
      where: { holdingCompanyId },
      select: {
        id: true,
        name: true,
        branches: {
          select: {
            id: true,
            name: true,
            city: true,
            slug: true,
            isActive: true,
            _count: { select: { users: true } },
          },
          orderBy: { name: "asc" },
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.user.groupBy({
      by: ["isActive"],
      where: companyUsers,
      _count: { _all: true },
    }),
    prisma.user.findMany({
      where: lockedWhere,
      select: { id: true, name: true, email: true, role: true, branch: { select: { name: true } } },
      orderBy: { name: "asc" },
      take: ATTENTION_LIST_LIMIT,
    }),
    prisma.user.findMany({
      where: mustChangeWhere,
      select: { id: true, name: true, email: true, role: true, branch: { select: { name: true } } },
      orderBy: { name: "asc" },
      take: ATTENTION_LIST_LIMIT,
    }),
    prisma.user.findMany({
      where: { holdingCompanyId, branchId: null },
      select: { id: true, name: true, email: true, role: true, branch: { select: { name: true } } },
      orderBy: { name: "asc" },
    }),
    // Counted separately from the lists above, which are capped at
    // ATTENTION_LIST_LIMIT — so "8 shown" under a count of 20 is correct.
    prisma.user.count({ where: lockedWhere }),
    prisma.user.count({ where: mustChangeWhere }),
    prisma.user.findMany({
      where: strandedWhere,
      select: { id: true, name: true, email: true, role: true, branch: { select: { name: true } } },
      orderBy: { name: "asc" },
      take: ATTENTION_LIST_LIMIT,
    }),
    prisma.user.count({ where: strandedWhere }),
  ])

  // groupBy returns only the rows that exist, so an all-active company has
  // no `false` group at all — read each side defensively rather than
  // indexing into a shape the data may not produce.
  const activeCount = staffTotals.find((g) => g.isActive)?._count._all ?? 0
  const inactiveCount = staffTotals.find((g) => !g.isActive)?._count._all ?? 0

  const shaped: OverviewClinic[] = clinics.map((c) => ({
    id: c.id,
    name: c.name,
    staffCount: c.branches.reduce((sum, b) => sum + b._count.users, 0),
    branches: c.branches.map((b) => ({
      id: b.id,
      name: b.name,
      city: b.city,
      slug: b.slug,
      isActive: b.isActive,
      staffCount: b._count.users,
    })),
  }))

  const toAccount = (u: {
    id: string
    name: string
    email: string
    role: Role
    branch: { name: string } | null
  }): OverviewAccount => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    branchName: u.branch?.name ?? null,
  })

  return {
    company,
    totals: {
      clinics: shaped.length,
      branches: shaped.reduce((n, c) => n + c.branches.length, 0),
      inactiveBranches: shaped.reduce((n, c) => n + c.branches.filter((b) => !b.isActive).length, 0),
      staff: activeCount + inactiveCount,
      inactiveStaff: inactiveCount,
      lockedOut: lockedOutTotal,
      mustChangePassword: mustChangeTotal,
      strandedInClosedBranch: strandedTotal,
    },
    clinics: shaped,
    holdingAccounts: holdingAccounts.map(toAccount),
    attention: {
      lockedOut: lockedOut.map(toAccount),
      mustChangePassword: mustChangePassword.map(toAccount),
      clinicsWithoutBranches: shaped.filter((c) => c.branches.length === 0).map((c) => ({ id: c.id, name: c.name })),
      // Active branches only: a deactivated branch having no staff is the
      // expected end state, not something to chase.
      branchesWithoutStaff: shaped.flatMap((c) =>
        c.branches
          .filter((b) => b.isActive && b.staffCount === 0)
          .map((b) => ({ id: b.id, name: b.name, clinicId: c.id, clinicName: c.name }))
      ),
      strandedInClosedBranch: stranded.map(toAccount),
    },
  }
}
