import bcrypt from "bcryptjs"
import { randomBytes } from "crypto"
import type { Role, Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { runWithRls, appendAuditLog } from "@/lib/db/rls"
import {
  isHoldingAdmin,
  requireBranchId,
  requireHoldingCompanyId,
  canManageRole,
  assignableRoles,
  isClinicAdmin,
  requireClinicId,
  type AbilitySubject,
} from "@/lib/permissions/ability"
import { toUserDTO, type UserDTO } from "@/lib/dto/user"
import type { CreateUserInput, EditUserInput, ChangeRoleInput } from "@/lib/validation/user"

/** After this many consecutive failed attempts, the account locks out. */
export const LOGIN_LOCKOUT_THRESHOLD = 5
/** How long a lockout lasts before the next attempt is evaluated normally. */
export const LOGIN_LOCKOUT_DURATION_MINUTES = 15

/**
 * Pure check against an already-fetched user row — no DB access, so it's
 * trivially unit-testable and safe to call from authorize() without an
 * extra round trip.
 */
export function isLockedOut(user: { lockedUntil: Date | null }): boolean {
  return user.lockedUntil !== null && user.lockedUntil.getTime() > Date.now()
}

/**
 * Called from auth.ts's Credentials authorize() on a wrong password. Takes
 * the count already loaded by that caller's own findUnique rather than
 * re-reading it, to avoid a lost-update race between the read and this
 * write (authorize() only ever handles one login attempt at a time per
 * request, so this is a single write, not a read-modify-write transaction —
 * acceptable here since a slightly-off count under concurrent attempts from
 * the same account only affects when the *next* lockout triggers, not
 * whether this specific attempt succeeds).
 */
export async function recordFailedLogin(userId: string, currentFailedAttempts: number): Promise<void> {
  const nextCount = currentFailedAttempts + 1
  if (nextCount >= LOGIN_LOCKOUT_THRESHOLD) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: new Date(Date.now() + LOGIN_LOCKOUT_DURATION_MINUTES * 60_000),
      },
    })
    return
  }
  await prisma.user.update({
    where: { id: userId },
    data: { failedLoginAttempts: nextCount },
  })
}

/** Called on a successful login — clears any accumulated failure count. */
export async function recordSuccessfulLogin(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { failedLoginAttempts: 0, lockedUntil: null },
  })
}

export type ChangePasswordResult = { ok: true } | { ok: false; error: string }

/**
 * Self-service password change — covers both the forced first-login flow
 * (mustChangePassword) and a voluntary later change, since both need the
 * identical guarantees (current password verified, new password actually
 * different, mustChangePassword cleared). `where: { id: user.id }` is the
 * *only* enforcement that a user can only change their own password —
 * `users` has no RLS policy at all (it's absent from the
 * enable_rls_backstop migration; auth.ts's authorize() has to read it
 * before any session/RLS context exists), so every function in this file
 * that touches another row must filter explicitly rather than leaning on
 * a database backstop the way patient/queue/payment queries can.
 */
export async function changeOwnPassword(
  user: AbilitySubject,
  currentPassword: string,
  newPassword: string
): Promise<ChangePasswordResult> {
  return runWithRls(user, async (tx) => {
    const row = await tx.user.findUniqueOrThrow({ where: { id: user.id } })

    const currentValid = await bcrypt.compare(currentPassword, row.passwordHash)
    if (!currentValid) {
      return { ok: false, error: "Current password is incorrect." }
    }

    const sameAsCurrent = await bcrypt.compare(newPassword, row.passwordHash)
    if (sameAsCurrent) {
      return { ok: false, error: "New password must be different from your current password." }
    }

    const passwordHash = await bcrypt.hash(newPassword, 10)
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: false },
    })
    await appendAuditLog(tx, {
      data: {
        branchId: user.branchId,
        userId: user.id,
        action: "user.password_changed",
        entityType: "User",
        entityId: user.id,
      },
    })

    return { ok: true }
  })
}

// ─────────────────────────────────────────────────────────────────────────
// User management (holding admin: any account · branch admin: their own
// branch's front desk/doctor accounts only — §4's role table)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Readable, policy-satisfying by construction (6 letters + 4 digits, so
 * `lib/validation/password.ts`'s "10+ chars, a letter, a number" rule
 * always passes — never left to the odds of a random byte string
 * happening to contain both). Excludes visually-confusing characters
 * (0/O, 1/l/I) since a human has to type this in once, from wherever it
 * gets handed to them.
 */
export function generateTempPassword(): string {
  const letters = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ"
  const digits = "23456789"
  const pick = (charset: string, count: number) =>
    Array.from(randomBytes(count), (b) => charset[b % charset.length]).join("")
  const chars = (pick(letters, 6) + pick(digits, 4)).split("")
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomBytes(1)[0] % (i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join("")
}

/**
 * The shape every managed-user lookup must `include`, because canManageTarget
 * needs the target's clinic and a user reaches its clinic through its branch.
 */
const managedTargetInclude = { branch: { select: { clinicId: true } } } as const

type ManagedTarget = { role: Role; branchId: string | null; branch: { clinicId: string } | null }

function canManageTarget(actor: AbilitySubject, target: ManagedTarget): boolean {
  if (isHoldingAdmin(actor)) return true
  // Both admin tiers manage staff roles only — never another admin. Checked
  // first so the scope arms below never have to reason about it.
  if (!assignableRoles(actor).includes(target.role)) return false
  if (isClinicAdmin(actor)) {
    // Both sides required-present on purpose. Comparing two nullables is how
    // a branchless actor would match every other branchless row
    // (`null === null`); a clinic-less row must not reproduce that one tier
    // up. The users_role_scope_check constraint makes such rows
    // unrepresentable; this keeps the code honest even if it were dropped.
    return Boolean(actor.clinicId) && target.branch?.clinicId === actor.clinicId
  }
  return Boolean(actor.branchId) && target.branchId === actor.branchId
}

/**
 * Bounds a single-user lookup to accounts `actor` could manage at all.
 *
 * canManageTarget answers "is this the right *role* and scope", but for a
 * holding admin it answers plain `true` — it has no notion of tenancy. The
 * tenant bound therefore has to be part of the query, not a check after it:
 * `users` has no RLS, so a bare findUnique by id reaches every account in
 * the database. Expressed as a where-clause rather than a post-filter so
 * another tenant's account is simply "not found", which is the same answer
 * getManagedUserById already gives for "exists but not yours".
 *
 * The branch-admin arm carries its own bound too. It used to be a bare
 * `{ id }`, which was safe only because canManageTarget ran afterwards; with
 * two admin tiers that is one forgotten call away from a cross-branch read.
 */
function managedUserWhere(actor: AbilitySubject, id: string): Prisma.UserWhereInput {
  if (isHoldingAdmin(actor)) return { id, ...holdingCompanyScope(requireHoldingCompanyId(actor)) }
  if (isClinicAdmin(actor)) return { id, branch: { clinicId: requireClinicId(actor) } }
  return { id, branchId: requireBranchId(actor) }
}

const userInclude = { branch: { select: { name: true, clinicId: true } }, doctor: true } as const

/**
 * A holding admin's list is bounded to their own company. Three attachment
 * routes: the user's own holdingCompanyId (holding admins), through their
 * branch's clinic (everyone with a branch), or through their clinic directly
 * (clinic admins, who are branchless and carry no company id of their own —
 * see requireClinicId for why). Drop the third arm and every clinic admin
 * becomes invisible to the people who manage it. `users` has no RLS, so
 * dropping the whole predicate lists every account in the database.
 */
function holdingCompanyScope(holdingCompanyId: string): Prisma.UserWhereInput {
  return {
    OR: [{ holdingCompanyId }, { branch: { clinic: { holdingCompanyId } } }, { clinic: { holdingCompanyId } }],
  }
}

/**
 * Every account in one clinic: through the user's branch (front desk,
 * doctors, branch admins) or, for the branchless clinic admin itself, by
 * direct attachment. The second arm is pinned to `branchId: null` on
 * purpose — the branch relation is authoritative whenever one exists, so a
 * stale clinicId on a branch-having row can never widen this past what
 * canManageTarget allows.
 */
function clinicScope(clinicId: string): Prisma.UserWhereInput {
  return { OR: [{ branch: { clinicId } }, { branchId: null, clinicId }] }
}

export async function listUsers(actor: AbilitySubject): Promise<UserDTO[]> {
  // Each non-holding arm filters by the roles that actor may manage —
  // byte-identical to assignableRoles(actor), so the list never shows a
  // row the row actions would then refuse.
  const where: Prisma.UserWhereInput = isHoldingAdmin(actor)
    ? holdingCompanyScope(requireHoldingCompanyId(actor))
    : isClinicAdmin(actor)
      ? { ...clinicScope(requireClinicId(actor)), role: { in: assignableRoles(actor) } }
      : { branchId: requireBranchId(actor), role: { in: assignableRoles(actor) } }
  const rows = await prisma.user.findMany({ where, include: userInclude, orderBy: [{ role: "asc" }, { name: "asc" }] })
  return rows.map(toUserDTO)
}

/**
 * The users working at one clinic — i.e. every user whose *branch* belongs
 * to it. A user is attached to a branch, not a clinic (User.branchId; there
 * is no clinicId on the row), so "this clinic's staff" is the union across
 * its branches and a user moves between clinics only by moving branch.
 *
 * Holding admins are deliberately absent: their branchId is null, so they
 * belong to no clinic and would otherwise appear identically under every
 * one of them.
 *
 * Same authorization shape as listUsers above, plus the clinic filter — a
 * branch admin asking about a clinic that isn't theirs matches nothing
 * rather than being told it exists. `users` has no RLS policy (see
 * changeOwnPassword's comment), so this where-clause is the only thing
 * enforcing that; it must never be relaxed to lean on a database backstop
 * that isn't there.
 */
export async function listUsersForClinic(actor: AbilitySubject, clinicId: string): Promise<UserDTO[]> {
  // A clinic admin asking about a clinic other than its own matches nothing
  // — the same "not yours reads as empty" shape the branch-admin arm has
  // always had, one tier up.
  if (isClinicAdmin(actor) && clinicId !== requireClinicId(actor)) return []

  const where: Prisma.UserWhereInput = isHoldingAdmin(actor)
    ? { branch: { clinicId, clinic: { holdingCompanyId: requireHoldingCompanyId(actor) } } }
    : isClinicAdmin(actor)
      ? { branch: { clinicId }, role: { in: assignableRoles(actor) } }
      : { branchId: requireBranchId(actor), branch: { clinicId }, role: { in: assignableRoles(actor) } }
  const rows = await prisma.user.findMany({
    where,
    include: userInclude,
    orderBy: [{ branch: { name: "asc" } }, { role: "asc" }, { name: "asc" }],
  })
  return rows.map(toUserDTO)
}

/**
 * The staff of one branch — the level users are actually attached to, so
 * unlike listUsersForClinic this needs no union and the branch column is a
 * direct match.
 *
 * A branch admin gets their own branch only: asking about a sibling branch
 * under the same clinic returns nothing rather than an error, so a probe
 * can't distinguish "empty branch" from "not yours". Same reasoning as
 * getManagedUserById returning null for both causes.
 */
export async function listUsersForBranch(actor: AbilitySubject, branchId: string): Promise<UserDTO[]> {
  // The clinic-admin guard must run before requireBranchId is ever
  // evaluated — a branchless actor reaching that call is a 500, not a
  // refusal. Its own bound is the branch's clinic, checked in the where.
  if (!isHoldingAdmin(actor) && !isClinicAdmin(actor) && requireBranchId(actor) !== branchId) return []

  const where: Prisma.UserWhereInput = isHoldingAdmin(actor)
    ? { branchId, branch: { clinic: { holdingCompanyId: requireHoldingCompanyId(actor) } } }
    : isClinicAdmin(actor)
      ? { branchId, branch: { clinicId: requireClinicId(actor) }, role: { in: assignableRoles(actor) } }
      : { branchId, role: { in: assignableRoles(actor) } }
  const rows = await prisma.user.findMany({
    where,
    include: userInclude,
    orderBy: [{ role: "asc" }, { name: "asc" }],
  })
  return rows.map(toUserDTO)
}

/** Returns null for "doesn't exist" *and* "exists but actor can't manage it" — same non-enumeration reasoning as the login lockout not distinguishing its causes. */
export async function getManagedUserById(actor: AbilitySubject, id: string): Promise<UserDTO | null> {
  const row = await prisma.user.findFirst({ where: managedUserWhere(actor, id), include: userInclude })
  if (!row || !canManageTarget(actor, row)) return null
  return toUserDTO(row)
}

export type CreateUserResult = { ok: true; user: UserDTO; tempPassword: string } | { ok: false; error: string }

export async function createUser(actor: AbilitySubject, input: CreateUserInput): Promise<CreateUserResult> {
  if (!canManageRole(actor, input.role)) {
    return { ok: false, error: "You can't create an account with that role." }
  }

  // Each role carries exactly one scope link (users_role_scope_check pins
  // this at the database): holding admins a company, clinic admins a clinic,
  // everyone else a branch.
  let branchId: string | null = null
  let clinicId: string | null = null
  if (input.role === "HOLDING_ADMIN") {
    branchId = null
  } else if (input.role === "CLINIC_ADMIN") {
    // Only a holding admin reaches here (assignableRoles). The clinic must be
    // one of theirs: `clinics` has no RLS, so this where-clause is the bound.
    if (!input.clinicId) return { ok: false, error: "Select a clinic." }
    const clinic = await prisma.clinic.findFirst({
      where: { id: input.clinicId, holdingCompanyId: requireHoldingCompanyId(actor) },
    })
    if (!clinic) return { ok: false, error: "Select a clinic." }
    clinicId = clinic.id
  } else if (isHoldingAdmin(actor)) {
    if (!input.branchId) return { ok: false, error: "Select a branch." }
    // Pre-existing gap closed at the same time: `branches` has no RLS, so
    // without the company bound a holding admin could name any tenant's
    // branch id and mint an account there.
    const branch = await prisma.branch.findFirst({
      where: { id: input.branchId, clinic: { holdingCompanyId: requireHoldingCompanyId(actor) } },
    })
    if (!branch) return { ok: false, error: "Select a branch." }
    branchId = branch.id
  } else if (isClinicAdmin(actor)) {
    // Never trust input.branchId on its own: a sibling clinic's branch id
    // would mint a FRONT_DESK there, and that account HAS full RLS-blessed
    // access to that branch's patients, queue and payments. Re-fetch under
    // the actor's clinic so an out-of-clinic branch reads as "not found",
    // never as a valid choice.
    if (!input.branchId) return { ok: false, error: "Select a branch." }
    const branch = await prisma.branch.findFirst({
      where: { id: input.branchId, clinicId: requireClinicId(actor) },
    })
    if (!branch) return { ok: false, error: "Select a branch." }
    branchId = branch.id
  } else {
    // Branch admin: ignore any branchId the form sent — they can only ever
    // create within their own branch, and trusting a client-supplied value
    // here would be exactly the kind of hole §5's "never from a
    // client-supplied parameter" rule exists to close.
    branchId = requireBranchId(actor)
  }

  const email = input.email.trim().toLowerCase()
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    return { ok: false, error: "An account with that email already exists." }
  }

  const tempPassword = generateTempPassword()
  const passwordHash = await bcrypt.hash(tempPassword, 10)

  const createdId = await runWithRls(actor, async (tx) => {
    const user = await tx.user.create({
      data: {
        branchId,
        clinicId,
        // Deliberately null for a CLINIC_ADMIN: its company is reached
        // through its clinic, so a future read that checks only for the
        // presence of a company id fails closed for this role, not open.
        holdingCompanyId: input.role === "HOLDING_ADMIN" ? actor.holdingCompanyId : null,
        name: input.name.trim(),
        email,
        phone: input.phone?.trim() || null,
        role: input.role,
        passwordHash,
        mustChangePassword: true,
      },
    })
    if (input.role === "DOCTOR") {
      await tx.doctor.create({
        data: {
          userId: user.id,
          branchId: branchId!,
          licenseNumber: input.licenseNumber!.trim(),
          specialization: input.specialization?.trim() || "General Practitioner",
          consultationFee: Math.round(Number(input.consultationFeePesos) * 100),
        },
      })
    }
    await appendAuditLog(tx, {
      data: {
        branchId,
        userId: actor.id,
        action: "user.created",
        entityType: "User",
        entityId: user.id,
        changes: { role: input.role, branchId },
      },
    })
    return user.id
  })

  const full = await prisma.user.findUniqueOrThrow({ where: { id: createdId }, include: userInclude })
  return { ok: true, user: toUserDTO(full), tempPassword }
}

export type ManageUserResult = { ok: true } | { ok: false; error: string }

/**
 * A queue entry in one of these states still expects its doctor to be
 * working in that branch — assignDoctor only ever attaches an in-branch
 * doctor (queue.ts's `findFirst({ id: doctorId, branchId })`), so moving a
 * doctor out from under a live entry would leave it pointing at someone the
 * branch can no longer act on. The finished states (COMPLETED, NO_SHOW,
 * CANCELLED) are history and stay attributed to whoever handled them.
 */
const UNFINISHED_QUEUE_STATUSES = ["BOOKED", "CHECKED_IN", "WAITING", "CALLED", "IN_CONSULTATION"] as const

export async function updateUser(actor: AbilitySubject, id: string, input: EditUserInput): Promise<ManageUserResult> {
  const target = await prisma.user.findFirst({ where: managedUserWhere(actor, id), include: { doctor: true, ...managedTargetInclude } })
  if (!target || !canManageTarget(actor, target)) return { ok: false, error: "User not found." }

  // An absent branchId means "leave it alone" — only an explicit, different
  // value is a move. Past work (payments, consultations, audit rows) keeps
  // the branch it happened in; this only changes where the person works next.
  const requestedBranchId = input.branchId?.trim() || null
  const movingBranch = requestedBranchId !== null && requestedBranchId !== target.branchId

  if (movingBranch) {
    // Deliberately holding-admin-only. canManageTarget already confines a
    // branch admin to targets in their own branch, so without this a clinic
    // admin could push one of their staff into a branch they have no rights
    // over — a one-way escalation out of their own scope.
    if (!isHoldingAdmin(actor)) {
      return { ok: false, error: "Only a holding admin can move a user to another branch." }
    }
    if (target.role === "HOLDING_ADMIN") {
      return { ok: false, error: "A holding admin isn't attached to a branch." }
    }
    const branch = await prisma.branch.findUnique({ where: { id: requestedBranchId } })
    if (!branch) return { ok: false, error: "Select a branch." }
    if (!branch.isActive) return { ok: false, error: "That branch is inactive." }

    if (target.doctor) {
      // Counted inside runWithRls, not on the bare client: queue_entries is
      // RLS-protected, so an un-scoped count outside a transaction sets no
      // GUCs, matches no policy, and returns 0 for everyone — a guard that
      // silently never fires. The actor is necessarily a holding admin here
      // (checked above), whose app.role satisfies every branch policy, so
      // this sees the doctor's entries in whichever branch they sit.
      const unfinished = await runWithRls(actor, (tx) =>
        tx.queueEntry.count({
          where: { doctorId: target.doctor!.id, status: { in: [...UNFINISHED_QUEUE_STATUSES] } },
        })
      )
      if (unfinished > 0) {
        return {
          ok: false,
          error: `This doctor still has ${unfinished} unfinished queue ${unfinished === 1 ? "entry" : "entries"}. Complete or reassign them before moving branch.`,
        }
      }
    }
  }

  await runWithRls(actor, async (tx) => {
    await tx.user.update({
      where: { id },
      data: {
        name: input.name.trim(),
        phone: input.phone?.trim() || null,
        ...(movingBranch ? { branchId: requestedBranchId } : {}),
      },
    })
    // Doctor.branchId is its own non-nullable column, not a view of the
    // user's — leaving it behind would put the doctor in one branch's
    // picker while their account lives in another.
    if (movingBranch && target.doctor) {
      await tx.doctor.update({ where: { userId: id }, data: { branchId: requestedBranchId } })
    }
    if (target.role === "DOCTOR" && target.doctor) {
      await tx.doctor.update({
        where: { userId: id },
        data: {
          licenseNumber: input.licenseNumber?.trim() || target.doctor.licenseNumber,
          specialization: input.specialization?.trim() || target.doctor.specialization,
          consultationFee: input.consultationFeePesos
            ? Math.round(Number(input.consultationFeePesos) * 100)
            : target.doctor.consultationFee,
        },
      })
    }
    // Logged against the branch the user is moving *to*: that branch's
    // admins are the ones who need to see a new person appear in their
    // scope. The `from` id is in `changes` so the move stays traceable from
    // either end.
    await appendAuditLog(tx, {
      data: {
        branchId: movingBranch ? requestedBranchId : target.branchId,
        userId: actor.id,
        action: movingBranch ? "user.branch_changed" : "user.updated",
        entityType: "User",
        entityId: id,
        ...(movingBranch ? { changes: { fromBranchId: target.branchId, toBranchId: requestedBranchId } } : {}),
      },
    })
  })
  return { ok: true }
}

export async function setUserActive(actor: AbilitySubject, id: string, isActive: boolean): Promise<ManageUserResult> {
  // Checked before canManageTarget — a branch admin's own row is a
  // BRANCH_ADMIN, which canManageTarget correctly refuses for anyone
  // *else's* clinic-admin account, but that check running first would
  // reject an admin's own id with the wrong, misleading "not found"
  // instead of the real reason.
  if (id === actor.id) return { ok: false, error: "You can't deactivate your own account." }

  const target = await prisma.user.findFirst({ where: managedUserWhere(actor, id), include: managedTargetInclude })
  if (!target || !canManageTarget(actor, target)) return { ok: false, error: "User not found." }

  await runWithRls(actor, async (tx) => {
    await tx.user.update({ where: { id }, data: { isActive } })
    await appendAuditLog(tx, {
      data: {
        branchId: target.branchId,
        userId: actor.id,
        action: isActive ? "user.reactivated" : "user.deactivated",
        entityType: "User",
        entityId: id,
      },
    })
  })
  return { ok: true }
}

/**
 * Changing an existing account's role — holding-admin only, and the most
 * consequential mutation in this file.
 *
 * Kept out of updateUser deliberately. That function is what an admin uses
 * to fix a typo in someone's name; folding a privilege change into the same
 * call would mean every rename carried the machinery to grant company-wide
 * access, and a caller that forgot to omit `role` would escalate silently.
 *
 * A Doctor row is never deleted here. consultations.doctor_id is NOT NULL
 * with no ON DELETE, so a doctor who has ever recorded a consultation has a
 * row the database physically refuses to remove — and should, since the
 * clinical record points at it. Demotion leaves it dormant and re-promotion
 * reuses it, which also preserves the licence number rather than asking for
 * it again.
 */
export async function changeUserRole(
  actor: AbilitySubject,
  id: string,
  input: ChangeRoleInput
): Promise<ManageUserResult> {
  if (!isHoldingAdmin(actor)) {
    return { ok: false, error: "Only a holding admin can change a role." }
  }
  // Checked before the lookup, like setUserActive's self-check, so the
  // answer is the real reason rather than a misleading "not found".
  //
  // This is also what keeps a company from losing its last holding admin,
  // which is why there is no separate guard for that. A demotion needs an
  // acting holding admin and a *different* target, so the actor is always
  // still an admin afterwards. A count of remaining admins would read as
  // load-bearing while being unreachable — the failure mode this file has
  // already been bitten by once.
  if (id === actor.id) {
    return { ok: false, error: "You can't change your own role — ask another holding admin." }
  }

  const target = await prisma.user.findFirst({
    where: managedUserWhere(actor, id),
    include: { doctor: true, ...managedTargetInclude },
  })
  if (!target) return { ok: false, error: "User not found." }
  if (target.role === input.role) return { ok: false, error: "That's already their role." }

  const toHolding = input.role === "HOLDING_ADMIN"
  const requestedBranchId = input.branchId?.trim() || null

  let branchId: string | null
  let clinicId: string | null = null
  if (toHolding) {
    // A holding admin has no branch; carrying one would make them appear in
    // a branch's staff list while their access ignores branches entirely.
    branchId = null
  } else if (input.role === "CLINIC_ADMIN") {
    // Clinic admins hold no branch (lib/db/rls.ts scopes them by clinic, not
    // branch). Without this arm a promotion would produce a clinic admin
    // WITH a branchId and no clinicId — rejected by users_role_scope_check,
    // and the exact state that would dissolve the fail-closed RLS story.
    branchId = null
    if (!input.clinicId) return { ok: false, error: "Select a clinic for this role." }
    const clinic = await prisma.clinic.findFirst({
      where: { id: input.clinicId, holdingCompanyId: requireHoldingCompanyId(actor) },
    })
    if (!clinic) return { ok: false, error: "Select a clinic." }
    clinicId = clinic.id
  } else {
    // Moving to a branch-scoped role needs a branch. Reuse their current one
    // when the caller did not name one, so a straight FRONT_DESK -> DOCTOR
    // change does not have to restate where they work.
    branchId = requestedBranchId ?? target.branchId
    if (!branchId) return { ok: false, error: "Select a branch for this role." }
    const branch = await prisma.branch.findFirst({
      where: { id: branchId, clinic: { holdingCompanyId: requireHoldingCompanyId(actor) } },
    })
    if (!branch) return { ok: false, error: "Select a branch." }
    if (!branch.isActive) return { ok: false, error: "That branch is inactive." }
  }

  // Same reasoning as the branch move: assignDoctor only ever attaches an
  // in-branch doctor, and a consultation in progress expects its doctor to
  // still be one. Demoting mid-visit strands the entry.
  if (target.role === "DOCTOR" && input.role !== "DOCTOR" && target.doctor) {
    const unfinished = await runWithRls(actor, (tx) =>
      tx.queueEntry.count({
        where: { doctorId: target.doctor!.id, status: { in: [...UNFINISHED_QUEUE_STATUSES] } },
      })
    )
    if (unfinished > 0) {
      return {
        ok: false,
        error: `This doctor still has ${unfinished} unfinished queue ${unfinished === 1 ? "entry" : "entries"}. Complete or reassign them first.`,
      }
    }
  }

  // Promoting to DOCTOR needs a Doctor row. An account that was a doctor
  // before still has one, so only a first-time promotion asks for details.
  const needsNewDoctorRow = input.role === "DOCTOR" && !target.doctor
  if (needsNewDoctorRow) {
    if (!input.licenseNumber?.trim()) {
      return { ok: false, error: "A licence number is required to make someone a doctor." }
    }
    const fee = Number(input.consultationFeePesos)
    if (!input.consultationFeePesos || !Number.isFinite(fee) || fee <= 0) {
      return { ok: false, error: "A consultation fee is required to make someone a doctor." }
    }
  }

  const previousRole = target.role
  await runWithRls(actor, async (tx) => {
    await tx.user.update({
      where: { id },
      data: {
        role: input.role,
        branchId,
        // Written on every role change, not just when set: a demotion away
        // from CLINIC_ADMIN must clear the stale clinic link or the row fails
        // users_role_scope_check. Mirrors createUser's scope-link rule.
        clinicId,
        // Mirrors createUser: the company link is what makes a holding admin
        // reachable at all, since they match no branch.
        holdingCompanyId: toHolding ? actor.holdingCompanyId : null,
      },
    })

    if (needsNewDoctorRow) {
      await tx.doctor.create({
        data: {
          userId: id,
          branchId: branchId!,
          licenseNumber: input.licenseNumber!.trim(),
          specialization: input.specialization?.trim() || "General Practitioner",
          consultationFee: Math.round(Number(input.consultationFeePesos) * 100),
        },
      })
    } else if (input.role === "DOCTOR" && target.doctor && branchId) {
      // Re-promotion, or a promotion that also moved branch: the dormant row
      // has to follow, or the doctor is pickable in the branch they left.
      await tx.doctor.update({ where: { userId: id }, data: { branchId } })
    }

    await appendAuditLog(tx, {
      data: {
        branchId,
        userId: actor.id,
        action: "user.role_changed",
        entityType: "User",
        entityId: id,
        changes: { fromRole: previousRole, toRole: input.role, branchId },
      },
    })
  })

  return { ok: true }
}

export type RegenerateTempPasswordResult = { ok: true; tempPassword: string } | { ok: false; error: string }

/**
 * Issues a fresh temporary password for an account whose old one is lost.
 *
 * forcePasswordReset only raises the mustChangePassword flag — the account
 * still needs its *current* password to sign in and change it, which is
 * exactly what is missing once an onboarding password goes astray. Without
 * this, such an account is unreachable and the only remedy is deleting and
 * recreating it, which is not available once anything references the row.
 *
 * Returns the plaintext to the caller once, the same contract createUser
 * has: it is never stored, never logged, and never recoverable afterwards.
 * The audit row records that a password was issued, never the value.
 */
export async function regenerateTempPassword(
  actor: AbilitySubject,
  id: string
): Promise<RegenerateTempPasswordResult> {
  // Refused for the actor's own account, and checked before canManageTarget
  // for the same reason setUserActive checks first — otherwise a holding
  // admin's own row returns the misleading "not found".
  //
  // This is a real boundary, not tidiness: changeOwnPassword requires the
  // current password, so a stolen session cannot rotate its own credentials
  // today. Allowing self-service here would hand it exactly that, letting an
  // attacker lock the real owner out of their own account. Someone who has
  // genuinely lost their own password needs another admin to issue one.
  if (id === actor.id) {
    return { ok: false, error: "You can't issue yourself a new password — ask another admin." }
  }

  // A clinic admin administers accounts; it must not be able to *become*
  // one. Rotating a front desk password yields a working credential for an
  // existing account — sign in with it and inherit that branch's patients,
  // queue and payments, with no new row for anyone to notice. createUser
  // has the same shape (see assignableRoles' comment) and is allowed as a
  // product decision; this path takes over an account that already exists,
  // which is a different thing, and is refused.
  if (isClinicAdmin(actor)) {
    return { ok: false, error: "Ask a holding admin to issue a password." }
  }

  const target = await prisma.user.findFirst({ where: managedUserWhere(actor, id), include: managedTargetInclude })
  if (!target || !canManageTarget(actor, target)) return { ok: false, error: "User not found." }

  const tempPassword = generateTempPassword()
  const passwordHash = await bcrypt.hash(tempPassword, 10)

  await runWithRls(actor, async (tx) => {
    await tx.user.update({
      where: { id },
      data: {
        passwordHash,
        mustChangePassword: true,
        // Clearing the lockout is part of issuing the password, not a
        // separate courtesy: a lockout counts failed attempts against the
        // *old* password, so leaving it would block the new one too and make
        // this action appear not to have worked.
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    })
    await appendAuditLog(tx, {
      data: {
        branchId: target.branchId,
        userId: actor.id,
        action: "user.temp_password_issued",
        entityType: "User",
        entityId: id,
      },
    })
  })

  return { ok: true, tempPassword }
}

export async function forcePasswordReset(actor: AbilitySubject, id: string): Promise<ManageUserResult> {
  const target = await prisma.user.findFirst({ where: managedUserWhere(actor, id), include: managedTargetInclude })
  if (!target || !canManageTarget(actor, target)) return { ok: false, error: "User not found." }

  await runWithRls(actor, async (tx) => {
    await tx.user.update({ where: { id }, data: { mustChangePassword: true } })
    await appendAuditLog(tx, {
      data: {
        branchId: target.branchId,
        userId: actor.id,
        action: "user.password_reset_forced",
        entityType: "User",
        entityId: id,
      },
    })
  })
  return { ok: true }
}

export async function unlockAccount(actor: AbilitySubject, id: string): Promise<ManageUserResult> {
  const target = await prisma.user.findFirst({ where: managedUserWhere(actor, id), include: managedTargetInclude })
  if (!target || !canManageTarget(actor, target)) return { ok: false, error: "User not found." }

  await runWithRls(actor, async (tx) => {
    await tx.user.update({ where: { id }, data: { failedLoginAttempts: 0, lockedUntil: null } })
    await appendAuditLog(tx, {
      data: { branchId: target.branchId, userId: actor.id, action: "user.unlocked", entityType: "User", entityId: id },
    })
  })
  return { ok: true }
}
