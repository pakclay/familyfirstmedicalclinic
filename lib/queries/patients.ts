import { runWithRls } from "@/lib/db/rls"
import { isHoldingAdmin, requireBranchId, type AbilitySubject } from "@/lib/permissions/ability"
import { ForbiddenError } from "@/lib/permissions/errors"
import { toPatientDTO, type PatientDTO } from "@/lib/dto/patient"
import { toQueueEntryDTO, type QueueEntryDTO } from "@/lib/dto/queue-entry"
import { patientIntakeSchema } from "@/lib/validation/patient"
import { nextQueueNumber, todayAsQueueDate, branchTimezone } from "@/lib/queries/queue"
import { generateAccessToken } from "@/lib/utils/token"

/**
 * Fetches one patient, scoped to the acting user's branch. Returns:
 *  - the patient, if they belong to the user's branch (or the user is a
 *    holding admin, who can see any branch)
 *  - null, if no patient with that id exists at all
 *  - throws ForbiddenError, if the patient exists in a *different* branch
 *
 * The last case is §12/M1's explicit bar: a direct-URL cross-clinic read
 * must 403, not silently 404 — so a broken scoping check is impossible to
 * miss. Postgres RLS (enable_rls_backstop/branch_rewrite_rls_policies
 * migrations) independently blocks the underlying row from this
 * connection regardless of this check, which is why distinguishing
 * "forbidden" from "genuinely missing" needs a second, deliberately
 * widened read (see inline comment below) rather than just inspecting the
 * first query's result.
 */
export async function getPatientById(
  user: AbilitySubject,
  patientId: string
): Promise<PatientDTO | null> {
  // A thrown error inside prisma.$transaction rolls back every write made
  // in that transaction, audit log included — so the "denied" branch can't
  // both throw ForbiddenError and have its audit row survive in one
  // transaction. Read (and, on denial, detect) inside the first
  // transaction; write whichever audit row applies in a second, separate
  // one; only then throw.
  const result = await runWithRls(user, async (tx) => {
    const patient = await tx.patient.findFirst({
      where: isHoldingAdmin(user)
        ? { id: patientId, deletedAt: null }
        : { id: patientId, branchId: user.branchId!, deletedAt: null },
    })
    if (patient) return { kind: "found" as const, patient }
    if (isHoldingAdmin(user)) return { kind: "not_found" as const }

    // Not visible under the user's own branch scope. Widen RLS visibility
    // for this one lookup only, to tell "doesn't exist anywhere" apart from
    // "exists in a different branch" — the same targeted, transaction-local
    // re-presentation pattern used for the completion write in the prior
    // build's scheduling layer. Never used to serve data back to the user,
    // only to log and 403 a genuine cross-branch attempt per §10.
    await tx.$executeRaw`SELECT set_config('app.role', 'HOLDING_ADMIN', true)`
    const existsElsewhere = await tx.patient.findFirst({
      where: { id: patientId, deletedAt: null },
      select: { branchId: true },
    })
    if (!existsElsewhere) return { kind: "not_found" as const }
    return { kind: "denied" as const, attemptedBranchId: existsElsewhere.branchId }
  })

  if (result.kind === "found") {
    await runWithRls(user, (tx) =>
      tx.auditLog.create({
        data: {
          branchId: result.patient.branchId,
          userId: user.id,
          action: "patient.read",
          entityType: "Patient",
          entityId: patientId,
        },
      })
    )
    return toPatientDTO(result.patient)
  }

  if (result.kind === "not_found") return null

  await runWithRls(user, (tx) =>
    tx.auditLog.create({
      data: {
        branchId: user.branchId,
        userId: user.id,
        action: "patient.read.denied",
        entityType: "Patient",
        entityId: patientId,
        changes: { attemptedBranchId: result.attemptedBranchId },
      },
    })
  )
  throw new ForbiddenError("Cannot access a patient outside your branch")
}

/** Lists patients in the acting user's own branch (holding admins pass an explicit branchId). */
export async function listPatients(
  user: AbilitySubject,
  opts: { branchId?: string; search?: string } = {}
): Promise<PatientDTO[]> {
  const branchId = isHoldingAdmin(user) ? opts.branchId : user.branchId!
  if (isHoldingAdmin(user) && !branchId) {
    throw new Error("listPatients requires an explicit branchId for a holding admin")
  }

  return runWithRls(user, async (tx) => {
    const patients = await tx.patient.findMany({
      where: {
        branchId: branchId!,
        deletedAt: null,
        ...(opts.search
          ? {
              OR: [
                { firstName: { contains: opts.search, mode: "insensitive" } },
                { lastName: { contains: opts.search, mode: "insensitive" } },
                { phone: { contains: opts.search } },
              ],
            }
          : {}),
      },
      orderBy: { lastName: "asc" },
      take: 50,
    })
    return patients.map(toPatientDTO)
  })
}

/**
 * Format-invariant duplicate check for §7.2's "phone-number search first to
 * avoid duplicates": strips everything but digits and compares the last 10
 * (a PH mobile number's length regardless of a leading +63 / 0 / spacing),
 * so "+63 917 000 1111" and "09170001111" match the same person.
 *
 * A DB-level `contains` can't do this normalization — a stored number like
 * "+63 917 555 0001" has a space inside almost any fixed-width digit
 * window, so a `contains` filter built from *normalized* digits routinely
 * misses rows whose *raw* text just happens to have punctuation in that
 * span. Filtering in JS after fetching the branch's patients avoids that
 * false-negative class entirely; an MVP branch's own patient roster (§13:
 * dozens to a few hundred) is small enough that this is a real query, not
 * a performance problem masquerading as a design choice.
 */
export async function searchPatientsByPhone(user: AbilitySubject, phone: string): Promise<PatientDTO[]> {
  if (isHoldingAdmin(user)) {
    throw new Error("searchPatientsByPhone requires a branch-scoped user")
  }
  const digits = phone.replace(/\D/g, "").slice(-10)
  if (digits.length < 7) return []

  return runWithRls(user, async (tx) => {
    const patients = await tx.patient.findMany({
      where: { branchId: user.branchId!, deletedAt: null },
      orderBy: { lastName: "asc" },
    })
    return patients
      .filter((p) => p.phone.replace(/\D/g, "").slice(-10) === digits)
      .slice(0, 10)
      .map(toPatientDTO)
  })
}

/**
 * Levenshtein distance, but only asked whether it stays within `max`. Bails
 * out the moment an entire row exceeds the budget, so comparisons that cannot
 * possibly match cost a fraction of the full matrix — which matters when this
 * runs against every name on a branch's roster for every keystroke's worth of
 * search.
 */
function withinEditDistance(a: string, b: string, max: number): boolean {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > max) return false

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      const value = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + cost)
      row.push(value)
      if (value < best) best = value
    }
    if (best > max) return false
    previous = row
  }
  return previous[b.length] <= max
}

/**
 * How many single-character slips to forgive in a token of a given length.
 * Nothing under four characters, where one edit turns half the roster into a
 * match and the search stops meaning anything.
 */
function editBudget(token: string): number {
  if (token.length < 4) return 0
  return token.length >= 7 ? 2 : 1
}

/** Names split on whitespace so a compound surname like "Dela Cruz" compares token by token. */
function nameTokens(firstName: string, lastName: string): string[] {
  return `${firstName} ${lastName}`.toLowerCase().split(/\s+/).filter(Boolean)
}

/**
 * The duplicate check the front desk actually runs at intake: one box that
 * takes a name *or* a number.
 *
 * searchPatientsByPhone above is exact-match on the last ten digits, which
 * finds nobody when the number was mistyped, has since changed, or the
 * patient cannot remember it — and the desk's only remaining option is to
 * re-encode someone the clinic already has. Names are how a returning
 * patient is actually identified at a counter, so the search has to accept
 * them.
 *
 * Both halves run against the branch's roster in JS for the reason the
 * phone search already documents: a DB `contains` built from normalized
 * digits misses rows whose raw text has punctuation inside the window. The
 * name half rides along on the same fetch rather than paying for a second
 * query, and matches against the joined name in both orders so "Juan Dela"
 * and "Dela Cruz, Juan" both land.
 */
export async function searchPatientsForIntake(user: AbilitySubject, term: string): Promise<PatientDTO[]> {
  if (isHoldingAdmin(user)) {
    throw new Error("searchPatientsForIntake requires a branch-scoped user")
  }
  // Commas and repeated spaces are dropped so the form the app itself shows
  // everywhere — "Dela Cruz, Juan" — can be typed back in and still match.
  const needle = term.trim().toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ").trim()
  // Two characters is the shortest search worth running — one letter matches
  // most of the roster and tells the desk nothing.
  if (needle.length < 2) return []

  const digits = term.replace(/\D/g, "")
  // Only treat the term as a phone number once there is enough of one to
  // identify somebody; below that the digits are more likely part of a name
  // or a typo than a number.
  const phoneKey = digits.length >= 7 ? digits.slice(-10) : null

  return runWithRls(user, async (tx) => {
    const patients = await tx.patient.findMany({
      where: { branchId: requireBranchId(user), deletedAt: null },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    })

    const matchesPhone = (p: (typeof patients)[number]) =>
      phoneKey !== null && p.phone.replace(/\D/g, "").slice(-10) === phoneKey

    const matchesExactly = (p: (typeof patients)[number]) => {
      const first = p.firstName.toLowerCase()
      const last = p.lastName.toLowerCase()
      return (
        first.includes(needle) ||
        last.includes(needle) ||
        `${first} ${last}`.includes(needle) ||
        `${last} ${first}`.includes(needle)
      )
    }

    /**
     * The tier that saves the desk from a duplicate. A record typed in wrong
     * once — "Patriomonio" for "Patrimonio" — is invisible to substring
     * matching forever after, and it is exactly the record most likely to be
     * entered a second time. Every meaningful token of the search has to land
     * on some token of the name, so forgiveness accumulates per word rather
     * than letting one close word drag an unrelated person in.
     */
    const searchTokens = needle.split(" ").filter((t) => t.length >= 4)
    const matchesApproximately = (p: (typeof patients)[number]) => {
      if (searchTokens.length === 0) return false
      const candidate = nameTokens(p.firstName, p.lastName)
      return searchTokens.every((token) =>
        candidate.some((against) => withinEditDistance(token, against, editBudget(token)))
      )
    }

    // Exact first: when a real substring match exists, it is the answer, and
    // burying it under near-misses would make the desk hunt for it.
    const exact = patients.filter((p) => matchesPhone(p) || matchesExactly(p))
    const exactIds = new Set(exact.map((p) => p.id))
    const approximate = patients.filter((p) => !exactIds.has(p.id) && matchesApproximately(p))

    return [...exact, ...approximate].slice(0, 10).map(toPatientDTO)
  })
}

/**
 * §7.2 walk-in registration: creates the Patient and their same-day
 * QueueEntry (source WALK_IN, status CHECKED_IN) together. No silent
 * auto-match here — the staff-driven duplicate check
 * (`searchPatientsForIntake`) happens as its own UI step before this is ever
 * called; a front desk user who's already searched and found no match is
 * deliberately creating a new record. §7.1's public-booking auto-match
 * logic is a separate flow, wired up in M3.
 */
export async function registerWalkIn(
  user: AbilitySubject,
  input: unknown
): Promise<{ patient: PatientDTO; queueEntry: QueueEntryDTO }> {
  if (isHoldingAdmin(user)) {
    throw new Error("Holding admins don't register walk-ins directly — pick a branch first")
  }
  const branchId = requireBranchId(user)
  const parsed = patientIntakeSchema.parse(input)

  return runWithRls(user, async (tx) => {
    const timezone = await branchTimezone(tx, branchId)
    const queueDate = todayAsQueueDate(timezone)

    const patient = await tx.patient.create({
      data: {
        branchId,
        firstName: parsed.firstName,
        lastName: parsed.lastName,
        middleName: parsed.middleName || null,
        birthdate: parsed.birthdate,
        sex: parsed.sex,
        phone: parsed.phone,
        email: parsed.email || null,
        address: parsed.address,
        emergencyContactName: parsed.emergencyContactName,
        emergencyContactPhone: parsed.emergencyContactPhone,
        guardianName: parsed.guardianName || null,
        guardianPhone: parsed.guardianPhone || null,
        consentAt: new Date(),
        createdById: user.id,
      },
    })

    const queueNumber = await nextQueueNumber(tx, branchId, queueDate)
    const queueEntry = await tx.queueEntry.create({
      data: {
        branchId,
        patientId: patient.id,
        queueNumber,
        queueDate,
        status: "CHECKED_IN",
        priority: parsed.priority ? "PRIORITY" : "NORMAL",
        source: "WALK_IN",
        reasonForVisit: parsed.reasonForVisit,
        checkedInAt: new Date(),
        accessToken: generateAccessToken(),
      },
    })

    await tx.auditLog.create({
      data: { branchId, userId: user.id, action: "patient.create", entityType: "Patient", entityId: patient.id },
    })
    await tx.auditLog.create({
      data: {
        branchId,
        userId: user.id,
        action: "queue_entry.create",
        entityType: "QueueEntry",
        entityId: queueEntry.id,
        changes: { source: "WALK_IN", patientId: patient.id },
      },
    })

    return { patient: toPatientDTO(patient), queueEntry: toQueueEntryDTO(queueEntry) }
  })
}

/** Checks in a patient the front desk already found via `searchPatientsByPhone` — no new Patient row. */
export async function checkInExistingPatient(
  user: AbilitySubject,
  patientId: string,
  input: { reasonForVisit: string; priority: boolean }
): Promise<QueueEntryDTO> {
  if (isHoldingAdmin(user)) {
    throw new Error("Holding admins don't check in walk-ins directly — pick a branch first")
  }
  const branchId = requireBranchId(user)

  return runWithRls(user, async (tx) => {
    const patient = await tx.patient.findFirst({ where: { id: patientId, branchId, deletedAt: null } })
    if (!patient) {
      throw new ForbiddenError("Patient not found in your branch")
    }

    const timezone = await branchTimezone(tx, branchId)
    const queueDate = todayAsQueueDate(timezone)
    const queueNumber = await nextQueueNumber(tx, branchId, queueDate)

    const queueEntry = await tx.queueEntry.create({
      data: {
        branchId,
        patientId,
        queueNumber,
        queueDate,
        status: "CHECKED_IN",
        priority: input.priority ? "PRIORITY" : "NORMAL",
        source: "WALK_IN",
        reasonForVisit: input.reasonForVisit,
        checkedInAt: new Date(),
        accessToken: generateAccessToken(),
      },
    })

    await tx.auditLog.create({
      data: {
        branchId,
        userId: user.id,
        action: "queue_entry.create",
        entityType: "QueueEntry",
        entityId: queueEntry.id,
        changes: { source: "WALK_IN", patientId },
      },
    })

    return toQueueEntryDTO(queueEntry)
  })
}

/** A patient's visit history for their profile screen — queue entries, newest first. */
export async function listPatientVisits(user: AbilitySubject, patientId: string): Promise<QueueEntryDTO[]> {
  return runWithRls(user, async (tx) => {
    const entries = await tx.queueEntry.findMany({
      where: isHoldingAdmin(user) ? { patientId } : { patientId, branchId: user.branchId! },
      orderBy: [{ queueDate: "desc" }, { queueNumber: "desc" }],
      take: 25,
    })
    return entries.map(toQueueEntryDTO)
  })
}
