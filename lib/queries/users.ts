import bcrypt from "bcryptjs"
import { randomBytes } from "crypto"
import type { Role, Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { runWithRls } from "@/lib/db/rls"
import { isHoldingAdmin, requireBranchId, canManageRole, type AbilitySubject } from "@/lib/permissions/ability"
import { toUserDTO, type UserDTO } from "@/lib/dto/user"
import type { CreateUserInput, EditUserInput } from "@/lib/validation/user"

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
    await tx.auditLog.create({
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
// User management (holding admin: any account · clinic admin: their own
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

function canManageTarget(actor: AbilitySubject, target: { role: Role; branchId: string | null }): boolean {
  if (isHoldingAdmin(actor)) return true
  return target.branchId === actor.branchId && (target.role === "FRONT_DESK" || target.role === "DOCTOR")
}

const userInclude = { branch: { select: { name: true } }, doctor: true } as const

export async function listUsers(actor: AbilitySubject): Promise<UserDTO[]> {
  const where: Prisma.UserWhereInput = isHoldingAdmin(actor)
    ? {}
    : { branchId: requireBranchId(actor), role: { in: ["FRONT_DESK", "DOCTOR"] } }
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
 * clinic admin asking about a clinic that isn't theirs matches nothing
 * rather than being told it exists. `users` has no RLS policy (see
 * changeOwnPassword's comment), so this where-clause is the only thing
 * enforcing that; it must never be relaxed to lean on a database backstop
 * that isn't there.
 */
export async function listUsersForClinic(actor: AbilitySubject, clinicId: string): Promise<UserDTO[]> {
  const where: Prisma.UserWhereInput = isHoldingAdmin(actor)
    ? { branch: { clinicId } }
    : { branchId: requireBranchId(actor), branch: { clinicId }, role: { in: ["FRONT_DESK", "DOCTOR"] } }
  const rows = await prisma.user.findMany({
    where,
    include: userInclude,
    orderBy: [{ branch: { name: "asc" } }, { role: "asc" }, { name: "asc" }],
  })
  return rows.map(toUserDTO)
}

/** Returns null for "doesn't exist" *and* "exists but actor can't manage it" — same non-enumeration reasoning as the login lockout not distinguishing its causes. */
export async function getManagedUserById(actor: AbilitySubject, id: string): Promise<UserDTO | null> {
  const row = await prisma.user.findUnique({ where: { id }, include: userInclude })
  if (!row || !canManageTarget(actor, row)) return null
  return toUserDTO(row)
}

export type CreateUserResult = { ok: true; user: UserDTO; tempPassword: string } | { ok: false; error: string }

export async function createUser(actor: AbilitySubject, input: CreateUserInput): Promise<CreateUserResult> {
  if (!canManageRole(actor, input.role)) {
    return { ok: false, error: "You can't create an account with that role." }
  }

  let branchId: string | null
  if (input.role === "HOLDING_ADMIN") {
    branchId = null
  } else if (isHoldingAdmin(actor)) {
    if (!input.branchId) return { ok: false, error: "Select a branch." }
    branchId = input.branchId
  } else {
    // Clinic admin: ignore any branchId the form sent — they can only ever
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
    await tx.auditLog.create({
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
  const target = await prisma.user.findUnique({ where: { id }, include: { doctor: true } })
  if (!target || !canManageTarget(actor, target)) return { ok: false, error: "User not found." }

  // An absent branchId means "leave it alone" — only an explicit, different
  // value is a move. Past work (payments, consultations, audit rows) keeps
  // the branch it happened in; this only changes where the person works next.
  const requestedBranchId = input.branchId?.trim() || null
  const movingBranch = requestedBranchId !== null && requestedBranchId !== target.branchId

  if (movingBranch) {
    // Deliberately holding-admin-only. canManageTarget already confines a
    // clinic admin to targets in their own branch, so without this a clinic
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
    await tx.auditLog.create({
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
  // Checked before canManageTarget — a clinic admin's own row is a
  // CLINIC_ADMIN, which canManageTarget correctly refuses for anyone
  // *else's* clinic-admin account, but that check running first would
  // reject an admin's own id with the wrong, misleading "not found"
  // instead of the real reason.
  if (id === actor.id) return { ok: false, error: "You can't deactivate your own account." }

  const target = await prisma.user.findUnique({ where: { id } })
  if (!target || !canManageTarget(actor, target)) return { ok: false, error: "User not found." }

  await runWithRls(actor, async (tx) => {
    await tx.user.update({ where: { id }, data: { isActive } })
    await tx.auditLog.create({
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

export async function forcePasswordReset(actor: AbilitySubject, id: string): Promise<ManageUserResult> {
  const target = await prisma.user.findUnique({ where: { id } })
  if (!target || !canManageTarget(actor, target)) return { ok: false, error: "User not found." }

  await runWithRls(actor, async (tx) => {
    await tx.user.update({ where: { id }, data: { mustChangePassword: true } })
    await tx.auditLog.create({
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
  const target = await prisma.user.findUnique({ where: { id } })
  if (!target || !canManageTarget(actor, target)) return { ok: false, error: "User not found." }

  await runWithRls(actor, async (tx) => {
    await tx.user.update({ where: { id }, data: { failedLoginAttempts: 0, lockedUntil: null } })
    await tx.auditLog.create({
      data: { branchId: target.branchId, userId: actor.id, action: "user.unlocked", entityType: "User", entityId: id },
    })
  })
  return { ok: true }
}
