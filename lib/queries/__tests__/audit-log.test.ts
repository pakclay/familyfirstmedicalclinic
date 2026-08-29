import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { Role, type Prisma } from "@prisma/client"
import { superuserPrisma } from "@/lib/test/superuser-prisma"
import { prisma } from "@/lib/db/prisma"
import {
  listAuditLog,
  clampPageSize,
  AUDIT_LOG_PAGE_SIZE_DEFAULT,
  AUDIT_LOG_PAGE_SIZE_MAX,
} from "@/lib/queries/audit-log"
import { normalizeChanges } from "@/lib/dto/audit-log"
import { ForbiddenError } from "@/lib/permissions/errors"
import type { AbilitySubject } from "@/lib/permissions/ability"

/**
 * These tests run against the real database through the real RLS-bound
 * client, so they are deliberately written to fail if `listAuditLog` ever
 * stops wrapping its reads in `runWithRls`: the `audit_logs` SELECT policy
 * makes an unwrapped read return zero rows *silently*, so every assertion
 * below names the specific seeded rows it expects. An assertion like
 * "returns an array" or "length >= 0" would pass just as happily against a
 * completely blind query and is worse than no test at all here.
 *
 * Every fixture row is tagged with a per-run suffix so the suite can find
 * exactly its own rows in a database that already contains real audit
 * history (and rows written concurrently by the other suites).
 */
const RUN = Date.now().toString(36)
const TYPE_ALPHA = `AuditFixtureAlpha-${RUN}`
const TYPE_BETA = `AuditFixtureBeta-${RUN}`
const TYPE_PAGED = `AuditFixturePaged-${RUN}`
/** Rows belonging to a *second* holding company — never visible to our admin. */
const TYPE_FOREIGN = `AuditFixtureForeign-${RUN}`
const ACTION_ALPHA = `fixture.alpha.${RUN}`
const ACTION_BETA = `fixture.beta.${RUN}`
const SHARED_ENTITY_ID = `patient-alpha-${RUN}`

/**
 * The branch tier's own boundary: `branchA` and `siblingOfA` sit under the
 * SAME clinic. Every pre-existing fixture pair in this file (`branchA` /
 * `branchB`) is cross-*clinic*, so nothing above can tell a genuinely
 * branch-keyed rule apart from a clinic-keyed one. These rows can.
 *
 * Their entity types are deliberately new literals rather than additions to
 * `OWN_FIXTURE_TYPES`, so none of the exact-equality assertions above (which
 * all filter by TYPE_ALPHA / TYPE_BETA / TYPE_PAGED) can be perturbed by
 * them, and none of their entity ids contain `SHARED_ENTITY_ID` so the `q`
 * exact-set test is untouched too.
 */
const TYPE_SIBLING = `AuditFixtureSibling-${RUN}`
/** Rows written *by the RLS-bound client* inside the INSERT-policy tests. */
const TYPE_INSERT = `AuditFixtureInsert-${RUN}`
const ACTION_SIBLING = `fixture.sibling.${RUN}`
const ACTION_INSERT = `fixture.insert.${RUN}`
/** Payload markers — a leak of the row also leaks the string inside it. */
const SIBLING_PHI = `SIBLING-ONLY-PHI-${RUN}`
const OWN_PHI = `BRANCH-A-ONLY-PHI-${RUN}`

/** All five paging fixtures share this instant exactly, to force sort ties. */
const TIED_INSTANT = new Date("2026-05-04T04:00:00.000Z")

/** Ours — the ones a holding admin of `holding` is entitled to see. */
const OWN_FIXTURE_TYPES = [TYPE_ALPHA, TYPE_BETA, TYPE_PAGED]
/** Everything this suite creates, including the rival's, for teardown only. */
const FIXTURE_TYPES = [...OWN_FIXTURE_TYPES, TYPE_FOREIGN, TYPE_SIBLING, TYPE_INSERT]

function idsOf(rows: { id: string }[]): string[] {
  return rows.map((r) => r.id).sort()
}

function sorted(ids: string[]): string[] {
  return [...ids].sort()
}

/**
 * The three session GUCs `lib/db/rls.ts` sets, spelled out by hand so the
 * RLS tests below exercise the *policy* rather than `runWithRls`. Note the
 * branch id is a parameter of its own: every negative assertion in this file
 * is paired with the identical query under a different `app.branch_id`, and
 * that pairing is the only thing separating "the policy is branch-keyed"
 * from "the query returns nothing at all".
 */
async function setRlsGucs(
  tx: Prisma.TransactionClient,
  role: Role,
  userId: string,
  branchId: string
): Promise<void> {
  await tx.$executeRaw`SELECT set_config('app.role', ${role}, true)`
  await tx.$executeRaw`SELECT set_config('app.user_id', ${userId}, true)`
  await tx.$executeRaw`SELECT set_config('app.branch_id', ${branchId}, true)`
}

describe("listAuditLog", () => {
  let holding: { id: string }
  let branchA: { id: string; name: string }
  let branchB: { id: string; name: string }
  /** Under the SAME clinic as branchA — the boundary the branch tier adds. */
  let siblingOfA: { id: string; name: string }
  let clinicAName: string
  let holdingAdmin: AbilitySubject
  let clinicAdmin: AbilitySubject
  let frontDesk: AbilitySubject
  let doctor: AbilitySubject
  /** A branch-scoped admin whose branch shares clinicA with branchA. */
  let siblingAdmin: AbilitySubject
  let frontDeskName: string
  let clinicAdminName: string

  // TYPE_ALPHA fixtures, oldest first.
  let a1: string // branch A · front desk · ACTION_ALPHA · Jan 10
  let a2: string // branch A · front desk · ACTION_BETA  · Mar 15
  let a3: string // branch B · clinic admin · ACTION_ALPHA · Mar 16
  let a4: string // NO branch · NO user · ACTION_ALPHA · Mar 17
  let b1: string // TYPE_BETA · branch A · front desk · Mar 18
  let pagedIds: string[] = []

  // The sibling pair. Same clinic, same entityType, same action — the only
  // thing that differs is the branch, which is exactly the property under test.
  let own1: string // TYPE_SIBLING · branch A       · carries OWN_PHI
  let s1: string //  TYPE_SIBLING · siblingOfA      · carries SIBLING_PHI + attemptedBranchId

  // A second, unrelated holding company. Nothing below belongs to our
  // holdingAdmin, and none of it may ever surface in their results.
  let otherHolding: { id: string }
  let otherBranch: { id: string; name: string }
  let otherBranchUserName: string
  let otherHoldingAdminName: string
  let f1: string // foreign branch row
  let f2: string // foreign holding-level row (no branch, foreign owner)

  beforeAll(async () => {
    holding = await superuserPrisma.holdingCompany.create({ data: { name: `Test Holding — audit ${RUN}` } })

    const branchData = (clinicId: string, name: string, slug: string) => ({
      clinicId,
      name,
      slug,
      address: "1 Test St",
      city: "Test City",
      phone: "0000",
      operatingHours: {},
    })
    const clinicA = await superuserPrisma.clinic.create({
      data: { holdingCompanyId: holding.id, name: `Audit Clinic A ${RUN}` },
    })
    const clinicB = await superuserPrisma.clinic.create({
      data: { holdingCompanyId: holding.id, name: `Audit Clinic B ${RUN}` },
    })
    branchA = await superuserPrisma.branch.create({
      data: branchData(clinicA.id, `Audit Branch A ${RUN}`, `audit-branch-a-${RUN}`),
    })
    branchB = await superuserPrisma.branch.create({
      data: branchData(clinicB.id, `Audit Branch B ${RUN}`, `audit-branch-b-${RUN}`),
    })
    clinicAName = clinicA.name
    // Second branch under clinicA. branchA/branchB are in *different* clinics,
    // so they cannot distinguish a branch-keyed rule from a clinic-keyed one.
    siblingOfA = await superuserPrisma.branch.create({
      data: branchData(clinicA.id, `Audit Branch A Sibling ${RUN}`, `audit-branch-a-sibling-${RUN}`),
    })

    frontDeskName = `Audit Front Desk ${RUN}`
    clinicAdminName = `Audit Clinic Admin ${RUN}`

    const holdingUser = await superuserPrisma.user.create({
      data: {
        holdingCompanyId: holding.id,
        name: `Audit Holding Owner ${RUN}`,
        email: `audit-owner-${RUN}@test.local`,
        passwordHash: "x",
        role: Role.HOLDING_ADMIN,
      },
    })
    const adminUser = await superuserPrisma.user.create({
      data: {
        branchId: branchA.id,
        name: clinicAdminName,
        email: `audit-admin-${RUN}@test.local`,
        passwordHash: "x",
        role: Role.CLINIC_ADMIN,
      },
    })
    const frontDeskUser = await superuserPrisma.user.create({
      data: {
        branchId: branchA.id,
        name: frontDeskName,
        email: `audit-fd-${RUN}@test.local`,
        passwordHash: "x",
        role: Role.FRONT_DESK,
      },
    })
    const doctorUser = await superuserPrisma.user.create({
      data: {
        branchId: branchA.id,
        name: `Audit Doctor ${RUN}`,
        email: `audit-dr-${RUN}@test.local`,
        passwordHash: "x",
        role: Role.DOCTOR,
      },
    })

    holdingAdmin = { id: holdingUser.id, role: Role.HOLDING_ADMIN, branchId: null, holdingCompanyId: holding.id }
    clinicAdmin = { id: adminUser.id, role: Role.CLINIC_ADMIN, branchId: branchA.id, holdingCompanyId: null }
    frontDesk = { id: frontDeskUser.id, role: Role.FRONT_DESK, branchId: branchA.id, holdingCompanyId: null }
    doctor = { id: doctorUser.id, role: Role.DOCTOR, branchId: branchA.id, holdingCompanyId: null }

    // Timestamps sit at midday Manila so the range assertions don't hinge on
    // a few hours of timezone slop either way.
    const rowA1 = await superuserPrisma.auditLog.create({
      data: {
        branchId: branchA.id,
        userId: frontDeskUser.id,
        action: ACTION_ALPHA,
        entityType: TYPE_ALPHA,
        entityId: SHARED_ENTITY_ID,
        // Centavos, as everywhere else in this codebase — the DTO must not
        // rescale it into pesos.
        changes: { amount: 12345 },
        ipAddress: "10.0.0.9",
        createdAt: new Date("2026-01-10T04:00:00.000Z"),
      },
    })
    const rowA2 = await superuserPrisma.auditLog.create({
      data: {
        branchId: branchA.id,
        userId: frontDeskUser.id,
        action: ACTION_BETA,
        entityType: TYPE_ALPHA,
        entityId: `queue-alpha-${RUN}`,
        changes: { from: 1, to: 2 },
        createdAt: new Date("2026-03-15T04:00:00.000Z"),
      },
    })
    const rowA3 = await superuserPrisma.auditLog.create({
      data: {
        branchId: branchB.id,
        userId: adminUser.id,
        action: ACTION_ALPHA,
        entityType: TYPE_ALPHA,
        entityId: `patient-beta-${RUN}`,
        createdAt: new Date("2026-03-16T04:00:00.000Z"),
      },
    })
    // Holding-level row: no branch, no acting user, no entity id, no
    // changes. Every one of these is nullable in the schema and the viewer
    // has to render the row anyway.
    const rowA4 = await superuserPrisma.auditLog.create({
      data: {
        branchId: null,
        userId: null,
        action: ACTION_ALPHA,
        entityType: TYPE_ALPHA,
        entityId: null,
        changes: { note: "holding level" },
        createdAt: new Date("2026-03-17T04:00:00.000Z"),
      },
    })
    const rowB1 = await superuserPrisma.auditLog.create({
      data: {
        branchId: branchA.id,
        userId: frontDeskUser.id,
        action: ACTION_ALPHA,
        entityType: TYPE_BETA,
        entityId: SHARED_ENTITY_ID,
        createdAt: new Date("2026-03-18T04:00:00.000Z"),
      },
    })

    a1 = rowA1.id
    a2 = rowA2.id
    a3 = rowA3.id
    a4 = rowA4.id
    b1 = rowB1.id

    // Five rows written in ONE transaction sharing one exact timestamp —
    // the tie that an unstable sort turns into duplicated/dropped rows.
    const paged = await superuserPrisma.$transaction(
      Array.from({ length: 5 }, (_, i) =>
        superuserPrisma.auditLog.create({
          data: {
            branchId: branchA.id,
            userId: frontDeskUser.id,
            action: ACTION_ALPHA,
            entityType: TYPE_PAGED,
            entityId: `paged-${i}-${RUN}`,
            createdAt: TIED_INSTANT,
          },
        })
      )
    )
    pagedIds = paged.map((row) => row.id)

    // ── The sibling pair, under ONE clinic ───────────────────────────────
    const siblingAdminUser = await superuserPrisma.user.create({
      data: {
        branchId: siblingOfA.id,
        name: `Audit Sibling Admin ${RUN}`,
        email: `audit-sib-admin-${RUN}@test.local`,
        passwordHash: "x",
        role: Role.CLINIC_ADMIN,
      },
    })
    siblingAdmin = {
      id: siblingAdminUser.id,
      role: Role.CLINIC_ADMIN,
      branchId: siblingOfA.id,
      holdingCompanyId: null,
    }

    const rowOwn1 = await superuserPrisma.auditLog.create({
      data: {
        branchId: branchA.id,
        userId: frontDeskUser.id,
        action: ACTION_SIBLING,
        entityType: TYPE_SIBLING,
        entityId: `own-phi-${RUN}`,
        changes: { diagnosis: OWN_PHI },
        createdAt: new Date("2026-03-21T04:00:00.000Z"),
      },
    })
    // A denial row, the shape `getPatientById` writes when it refuses a
    // cross-branch read: it embeds both PHI and the branch that was reached
    // for. Neither may ever surface to the branch next door.
    const rowS1 = await superuserPrisma.auditLog.create({
      data: {
        branchId: siblingOfA.id,
        userId: siblingAdminUser.id,
        action: ACTION_SIBLING,
        entityType: TYPE_SIBLING,
        entityId: `sibling-phi-${RUN}`,
        changes: { diagnosis: SIBLING_PHI, attemptedBranchId: siblingOfA.id },
        createdAt: new Date("2026-03-22T04:00:00.000Z"),
      },
    })
    own1 = rowOwn1.id
    s1 = rowS1.id

    // ── A second holding company, entirely unrelated to `holding` ────────
    // The RLS policy grants any HOLDING_ADMIN a blanket bypass and says
    // nothing about *which* holding company they own, so these rows are
    // visible at the database layer. Only the application-level holding
    // scope keeps them out — which is exactly what these fixtures test.
    otherHolding = await superuserPrisma.holdingCompany.create({
      data: { name: `Rival Holding — audit ${RUN}` },
    })
    const otherClinic = await superuserPrisma.clinic.create({
      data: { holdingCompanyId: otherHolding.id, name: `Rival Clinic ${RUN}` },
    })
    otherBranch = await superuserPrisma.branch.create({
      data: {
        clinicId: otherClinic.id,
        name: `Rival Branch ${RUN}`,
        slug: `rival-branch-${RUN}`,
        address: "9 Rival St",
        city: "Rival City",
        phone: "9999",
        operatingHours: {},
      },
    })
    otherBranchUserName = `Rival Front Desk ${RUN}`
    otherHoldingAdminName = `Rival Owner ${RUN}`
    const otherBranchUser = await superuserPrisma.user.create({
      data: {
        branchId: otherBranch.id,
        name: otherBranchUserName,
        email: `rival-fd-${RUN}@test.local`,
        passwordHash: "x",
        role: Role.FRONT_DESK,
      },
    })
    const otherHoldingAdminUser = await superuserPrisma.user.create({
      data: {
        holdingCompanyId: otherHolding.id,
        name: otherHoldingAdminName,
        email: `rival-owner-${RUN}@test.local`,
        passwordHash: "x",
        role: Role.HOLDING_ADMIN,
      },
    })

    const rowF1 = await superuserPrisma.auditLog.create({
      data: {
        branchId: otherBranch.id,
        userId: otherBranchUser.id,
        action: ACTION_ALPHA,
        entityType: TYPE_FOREIGN,
        entityId: SHARED_ENTITY_ID, // same entityId as ours, so `q` can't be a fluke
        createdAt: new Date("2026-03-19T04:00:00.000Z"),
      },
    })
    // Branch-less, but written by the RIVAL owner — the case a naive
    // "branchId IS NULL is always visible" rule would leak.
    const rowF2 = await superuserPrisma.auditLog.create({
      data: {
        userId: otherHoldingAdminUser.id,
        action: ACTION_ALPHA,
        entityType: TYPE_FOREIGN,
        createdAt: new Date("2026-03-20T04:00:00.000Z"),
      },
    })
    f1 = rowF1.id
    f2 = rowF2.id
  })

  afterAll(async () => {
    const branchIds = [branchA.id, branchB.id, siblingOfA.id, otherBranch.id]
    const holdingIds = [holding.id, otherHolding.id]
    await superuserPrisma.auditLog.deleteMany({ where: { entityType: { in: FIXTURE_TYPES } } })
    await superuserPrisma.auditLog.deleteMany({ where: { branchId: { in: branchIds } } })
    // Branch-less rows are found via their author, not their branch.
    await superuserPrisma.auditLog.deleteMany({
      where: { user: { holdingCompanyId: { in: holdingIds } } },
    })
    await superuserPrisma.user.deleteMany({ where: { branchId: { in: branchIds } } })
    await superuserPrisma.user.deleteMany({ where: { holdingCompanyId: { in: holdingIds } } })
    await superuserPrisma.branch.deleteMany({ where: { id: { in: branchIds } } })
    await superuserPrisma.clinic.deleteMany({ where: { holdingCompanyId: { in: holdingIds } } })
    await superuserPrisma.holdingCompany.deleteMany({ where: { id: { in: holdingIds } } })
    await superuserPrisma.$disconnect()
    await prisma.$disconnect()
  })

  it("returns the seeded rows to a holding admin, newest first", async () => {
    const result = await listAuditLog(holdingAdmin, { entityType: TYPE_ALPHA })

    // Named rows, not a length check: an unwrapped (non-RLS) read returns an
    // empty list without erroring, and only naming the rows catches that.
    expect(idsOf(result.rows)).toEqual(sorted([a1, a2, a3, a4]))
    expect(result.total).toBe(4)
    expect(result.rows.map((r) => r.id)).toEqual([a4, a3, a2, a1])
    expect(result.pageSize).toBe(AUDIT_LOG_PAGE_SIZE_DEFAULT)
    expect(result.pageCount).toBe(1)
    expect(result.hasPrev).toBe(false)
    expect(result.hasNext).toBe(false)
  })

  it("maps a branch-and-user row into the DTO with names resolved", async () => {
    const result = await listAuditLog(holdingAdmin, { entityType: TYPE_ALPHA })
    const row = result.rows.find((r) => r.id === a1)

    expect(row).toBeDefined()
    expect(row).toMatchObject({
      id: a1,
      branchId: branchA.id,
      branchName: branchA.name,
      userId: frontDesk.id,
      userName: frontDeskName,
      action: ACTION_ALPHA,
      entityType: TYPE_ALPHA,
      entityId: SHARED_ENTITY_ID,
      ipAddress: "10.0.0.9",
    })
    // Centavos are carried through untouched — never divided by 100.
    expect(row!.changes).toBe('{"amount":12345}')
    expect(row!.createdAt).toBeInstanceOf(Date)
  })

  it("still returns and renders a row with no branch and no user", async () => {
    const result = await listAuditLog(holdingAdmin, { entityType: TYPE_ALPHA })
    const row = result.rows.find((r) => r.id === a4)

    expect(row).toBeDefined()
    expect(row).toMatchObject({
      branchId: null,
      branchName: null,
      userId: null,
      userName: null,
      entityId: null,
      ipAddress: null,
    })
    expect(row!.changes).toBe('{"note":"holding level"}')
  })

  it("returns null changes for a row whose changes column is null", async () => {
    const result = await listAuditLog(holdingAdmin, { entityType: TYPE_ALPHA })
    expect(result.rows.find((r) => r.id === a3)?.changes).toBeNull()
  })

  it("applies no default date window — rows far older than 30 days still come back", async () => {
    const result = await listAuditLog(holdingAdmin, { entityType: TYPE_ALPHA })
    expect(result.rows.map((r) => r.id)).toContain(a1) // January
    expect(result.applied.start).toBe("")
    expect(result.applied.end).toBe("")
  })

  describe("access control", () => {
    it("throws ForbiddenError for a clinic admin", async () => {
      await expect(listAuditLog(clinicAdmin, {})).rejects.toThrow(ForbiddenError)
    })

    it("throws ForbiddenError for front desk", async () => {
      await expect(listAuditLog(frontDesk, {})).rejects.toThrow(ForbiddenError)
    })

    it("throws ForbiddenError for a doctor", async () => {
      await expect(listAuditLog(doctor, {})).rejects.toThrow(ForbiddenError)
    })

    it("does not degrade to an empty list for a forbidden reader", async () => {
      // The whole point of §4.2: a refusal must be distinguishable from
      // "there is nothing here", which is what a broken RLS setup looks like.
      const attempt = listAuditLog(clinicAdmin, { entityType: TYPE_ALPHA })
      await expect(attempt).rejects.toBeInstanceOf(ForbiddenError)
    })
  })

  describe("holding-company scope", () => {
    // Postgres RLS is NOT the tenant boundary on this table: its policy
    // grants every HOLDING_ADMIN a blanket bypass regardless of which
    // holding company they belong to. These tests cover the only thing that
    // actually separates one owner from another.
    it("hides another holding company's branch rows", async () => {
      const result = await listAuditLog(holdingAdmin, { entityType: TYPE_FOREIGN })
      expect(result.rows).toEqual([])
      expect(result.total).toBe(0)
    })

    it("hides another holding company's branch-less rows", async () => {
      // f2 has branchId NULL, so a rule that treated "no branch" as
      // "holding-level, always visible" would leak it across tenants.
      const result = await listAuditLog(holdingAdmin, { action: ACTION_ALPHA })
      const ids = result.rows.map((r) => r.id)
      expect(ids).not.toContain(f1)
      expect(ids).not.toContain(f2)
      expect(ids).toContain(a1) // ...while our own rows still come back
    })

    it("still shows our own branch-less rows, including system rows with no user", async () => {
      // a4 has neither branch nor user — a retention.purge-shaped row. The
      // scope must not throw those away while excluding foreign ones.
      const result = await listAuditLog(holdingAdmin, { entityType: TYPE_ALPHA })
      expect(result.rows.map((r) => r.id)).toContain(a4)
    })

    it("cannot be widened by a hand-edited branchId filter", async () => {
      // The filters are AND-ed with the holding scope, so naming another
      // owner's branch intersects to nothing rather than reaching across.
      const result = await listAuditLog(holdingAdmin, { branchId: otherBranch.id })
      expect(result.rows).toEqual([])
      expect(result.total).toBe(0)
    })

    it("cannot be widened by a hand-edited userId filter", async () => {
      const rival = await superuserPrisma.user.findFirstOrThrow({
        where: { name: otherBranchUserName },
      })
      const result = await listAuditLog(holdingAdmin, { userId: rival.id })
      expect(result.rows).toEqual([])
    })

    it("cannot be widened by a free-text entityId search shared with a foreign row", async () => {
      // f1 deliberately carries the same entityId as a1/a2.
      const result = await listAuditLog(holdingAdmin, { q: SHARED_ENTITY_ID })
      const ids = result.rows.map((r) => r.id)
      expect(ids).not.toContain(f1)
      expect(ids).toContain(a1)
    })

    it("does not enumerate other holding companies in the branch dropdown", async () => {
      // `branches` has no RLS policy at all, so an unfiltered read here would
      // list every branch in the database regardless of owner.
      const result = await listAuditLog(holdingAdmin, {})
      const names = result.options.branches.map((c) => c.name)
      expect(names).toContain(branchA.name)
      expect(names).not.toContain(otherBranch.name)
    })

    it("does not enumerate other holding companies' accounts in the user dropdown", async () => {
      const result = await listAuditLog(holdingAdmin, {})
      const names = result.options.users.map((u) => u.name)
      expect(names).toContain(frontDeskName)
      expect(names).not.toContain(otherBranchUserName)
      expect(names).not.toContain(otherHoldingAdminName)
    })
  })

  describe("filters", () => {
    it("narrows by a closed date range", async () => {
      const result = await listAuditLog(holdingAdmin, {
        entityType: TYPE_ALPHA,
        start: "2026-03-15",
        end: "2026-03-16",
      })
      expect(idsOf(result.rows)).toEqual(sorted([a2, a3]))
      expect(result.total).toBe(2)
      expect(result.applied).toMatchObject({ start: "2026-03-15", end: "2026-03-16" })
    })

    it("narrows by a start bound alone", async () => {
      const result = await listAuditLog(holdingAdmin, { entityType: TYPE_ALPHA, start: "2026-03-16" })
      expect(idsOf(result.rows)).toEqual(sorted([a3, a4]))
    })

    it("narrows by an end bound alone, inclusive of the whole end day", async () => {
      const result = await listAuditLog(holdingAdmin, { entityType: TYPE_ALPHA, end: "2026-01-10" })
      expect(idsOf(result.rows)).toEqual([a1])
    })

    it("ignores a malformed date instead of applying an invented range", async () => {
      const result = await listAuditLog(holdingAdmin, { entityType: TYPE_ALPHA, start: "not-a-date" })
      expect(idsOf(result.rows)).toEqual(sorted([a1, a2, a3, a4]))
      expect(result.applied.start).toBe("")
    })

    it("narrows by action", async () => {
      const result = await listAuditLog(holdingAdmin, { entityType: TYPE_ALPHA, action: ACTION_BETA })
      expect(idsOf(result.rows)).toEqual([a2])
      expect(result.total).toBe(1)
    })

    it("narrows by entityType", async () => {
      const result = await listAuditLog(holdingAdmin, { entityType: TYPE_BETA })
      expect(idsOf(result.rows)).toEqual([b1])
    })

    it("narrows by userId", async () => {
      const result = await listAuditLog(holdingAdmin, { entityType: TYPE_ALPHA, userId: frontDesk.id })
      expect(idsOf(result.rows)).toEqual(sorted([a1, a2]))
    })

    it("narrows by branchId", async () => {
      const result = await listAuditLog(holdingAdmin, { entityType: TYPE_ALPHA, branchId: branchB.id })
      expect(idsOf(result.rows)).toEqual([a3])
      expect(result.rows[0].branchName).toBe(branchB.name)
    })

    it("matches q against entityId, case-insensitively, across entity types", async () => {
      const result = await listAuditLog(holdingAdmin, { q: SHARED_ENTITY_ID.toUpperCase() })
      expect(idsOf(result.rows)).toEqual(sorted([a1, b1]))
      expect(result.applied.q).toBe(SHARED_ENTITY_ID.toUpperCase())
    })

    it("combines filters", async () => {
      const result = await listAuditLog(holdingAdmin, {
        entityType: TYPE_ALPHA,
        action: ACTION_ALPHA,
        branchId: branchB.id,
      })
      expect(idsOf(result.rows)).toEqual([a3])
    })

    it("offers the distinct actions and entity types actually present, not a hardcoded list", async () => {
      const result = await listAuditLog(holdingAdmin, { entityType: TYPE_ALPHA })
      expect(result.options.actions).toContain(ACTION_ALPHA)
      expect(result.options.actions).toContain(ACTION_BETA)
      // Computed over the unfiltered table, so narrowing one facet doesn't
      // empty the other's dropdown.
      expect(result.options.entityTypes).toEqual(expect.arrayContaining(OWN_FIXTURE_TYPES))
      // ...but the dropdown is holding-scoped too: a rival owner's entity
      // types would otherwise leak the existence of their activity.
      expect(result.options.entityTypes).not.toContain(TYPE_FOREIGN)
      expect(new Set(result.options.actions).size).toBe(result.options.actions.length)
      expect(result.options.branches.map((c) => c.id)).toEqual(expect.arrayContaining([branchA.id, branchB.id]))
      expect(result.options.users.map((u) => u.name)).toContain(clinicAdminName)
    })
  })

  describe("pagination", () => {
    it("walks tied-timestamp rows into disjoint pages that cover every row exactly once", async () => {
      const seen: string[] = []
      const perPage: string[][] = []

      for (let page = 1; page <= 3; page++) {
        const result = await listAuditLog(holdingAdmin, { entityType: TYPE_PAGED, pageSize: 2, page })
        expect(result.total).toBe(5)
        expect(result.pageCount).toBe(3)
        expect(result.page).toBe(page)
        perPage.push(result.rows.map((r) => r.id))
        seen.push(...result.rows.map((r) => r.id))
      }

      expect(perPage.map((p) => p.length)).toEqual([2, 2, 1])
      // No duplicates: an unstable sort repeats a tied row across pages.
      expect(new Set(seen).size).toBe(5)
      // No omissions: the same instability drops a different tied row entirely.
      expect(sorted(seen)).toEqual(sorted(pagedIds))
    })

    it("reports hasPrev/hasNext consistently while paging", async () => {
      const first = await listAuditLog(holdingAdmin, { entityType: TYPE_PAGED, pageSize: 2, page: 1 })
      expect(first.hasPrev).toBe(false)
      expect(first.hasNext).toBe(true)

      const middle = await listAuditLog(holdingAdmin, { entityType: TYPE_PAGED, pageSize: 2, page: 2 })
      expect(middle.hasPrev).toBe(true)
      expect(middle.hasNext).toBe(true)

      const last = await listAuditLog(holdingAdmin, { entityType: TYPE_PAGED, pageSize: 2, page: 3 })
      expect(last.hasPrev).toBe(true)
      expect(last.hasNext).toBe(false)
    })

    it("clamps a page request past the end to the last page", async () => {
      const result = await listAuditLog(holdingAdmin, { entityType: TYPE_PAGED, pageSize: 2, page: 99 })
      expect(result.page).toBe(3)
      expect(result.rows).toHaveLength(1)
      expect(result.hasNext).toBe(false)
    })

    it("clamps an oversized page size instead of honouring it", async () => {
      const result = await listAuditLog(holdingAdmin, { entityType: TYPE_ALPHA, pageSize: "100000" })
      expect(result.pageSize).toBe(AUDIT_LOG_PAGE_SIZE_MAX)
      expect(result.rows.length).toBeLessThanOrEqual(AUDIT_LOG_PAGE_SIZE_MAX)
    })

    it("falls back to the default page size for junk, zero, and negative values", async () => {
      for (const pageSize of ["abc", "0", "-5", "", undefined]) {
        const result = await listAuditLog(holdingAdmin, { entityType: TYPE_ALPHA, pageSize })
        expect(result.pageSize).toBe(AUDIT_LOG_PAGE_SIZE_DEFAULT)
      }
    })

    it("clamps a page size at the unit level too", () => {
      expect(clampPageSize(undefined)).toBe(AUDIT_LOG_PAGE_SIZE_DEFAULT)
      expect(clampPageSize("10")).toBe(10)
      expect(clampPageSize(10.9)).toBe(10)
      expect(clampPageSize(Number.MAX_SAFE_INTEGER)).toBe(AUDIT_LOG_PAGE_SIZE_MAX)
      expect(clampPageSize(Number.POSITIVE_INFINITY)).toBe(AUDIT_LOG_PAGE_SIZE_DEFAULT)
    })
  })

  /**
   * ── Two branches under ONE clinic ──────────────────────────────────────
   *
   * Everything above proves the cross-*clinic* and cross-*holding-company*
   * boundaries. The branch rewrite introduced a third, tighter one that none
   * of it can see: `branchA` and `siblingOfA` share clinicA, so a regression
   * from `branchId: <id>` to `branch: { clinicId }` — or from a branch-keyed
   * RLS policy to a clinic-keyed one — leaves every assertion above green.
   *
   * Both enforcement layers are exercised separately, because they fail
   * independently: the app-layer `where` clause via `listAuditLog`, and the
   * Postgres policy via the RLS-bound `prisma` client with the session GUCs
   * set by hand. `superuserPrisma` is deliberately NOT used for the policy
   * tests — it connects as the migration superuser, which bypasses RLS
   * outright, so the negative half would pass for the wrong reason.
   */
  describe("sibling branches under one clinic", () => {
    it("has no branch-scoped read path at all — a clinic admin of the sibling branch is refused, not filtered", async () => {
      // `listAuditLog` gates on role before it ever looks at a branch, so the
      // sibling's own admin never reaches a query. Sharing clinicA with
      // branchA buys nothing, and neither does owning the rows themselves.
      await expect(listAuditLog(siblingAdmin, { entityType: TYPE_SIBLING })).rejects.toBeInstanceOf(ForbiddenError)

      // Positive control: a refusal is only meaningful if there was something
      // to refuse. Both sibling rows exist and are readable by someone.
      const visible = await listAuditLog(holdingAdmin, { entityType: TYPE_SIBLING })
      expect(idsOf(visible.rows)).toEqual(sorted([own1, s1]))
    })

    it("the branchId filter separates two branches under the SAME clinic", async () => {
      // The regression catcher the existing "narrows by branchId" test cannot
      // be: that one names branchB, which is in a *different* clinic, so a
      // clinic-keyed `where` would satisfy it just as well. These two calls
      // differ only in the branch id, and both clinics are the same clinic.
      const mine = await listAuditLog(holdingAdmin, { entityType: TYPE_SIBLING, branchId: branchA.id })
      expect(idsOf(mine.rows)).toEqual([own1])
      expect(mine.rows[0].branchName).toBe(branchA.name)

      const theirs = await listAuditLog(holdingAdmin, { entityType: TYPE_SIBLING, branchId: siblingOfA.id })
      expect(idsOf(theirs.rows)).toEqual([s1])
      expect(theirs.rows[0].branchName).toBe(siblingOfA.name)
    })

    it("a sibling's changes payload never rides along in the other branch's page", async () => {
      const mine = await listAuditLog(holdingAdmin, { entityType: TYPE_SIBLING, branchId: branchA.id })
      const serialized = JSON.stringify(mine.rows)
      // Not just the row — the PHI inside it, and the attemptedBranchId that
      // would name the sibling branch even if the diagnosis were redacted.
      expect(serialized).not.toContain(SIBLING_PHI)
      expect(serialized).not.toContain(siblingOfA.id)
      // Positive control: this page does carry its own branch's payload, so
      // the two absences above are not just "changes is never populated".
      expect(mine.rows[0].changes).toContain(OWN_PHI)

      const theirs = await listAuditLog(holdingAdmin, { entityType: TYPE_SIBLING, branchId: siblingOfA.id })
      const theirsSerialized = JSON.stringify(theirs.rows)
      expect(theirsSerialized).toContain(SIBLING_PHI)
      expect(theirsSerialized).toContain(siblingOfA.id)
    })

    it("a holding admin legitimately sees both siblings, listed under the one clinic name", async () => {
      // The other half of the boundary: separating siblings must not mean
      // losing them. This also pins the extra branch → clinic → holding
      // company hop the refactor added, in both the rows and the dropdown.
      const result = await listAuditLog(holdingAdmin, { entityType: TYPE_SIBLING })
      expect(idsOf(result.rows)).toEqual(sorted([own1, s1]))

      const mineOption = result.options.branches.find((b) => b.id === branchA.id)
      const siblingOption = result.options.branches.find((b) => b.id === siblingOfA.id)
      expect(mineOption?.clinicName).toBe(clinicAName)
      expect(siblingOption?.clinicName).toBe(clinicAName)
      expect(siblingOption?.name).toBe(siblingOfA.name)
    })

    it("RLS backstop: a branch-scoped session cannot SELECT a sibling branch's audit row", async () => {
      const hidden = await prisma.$transaction(async (tx) => {
        await setRlsGucs(tx, Role.FRONT_DESK, frontDesk.id, branchA.id)
        // Deliberately unfiltered by branch — this proves Postgres hides the
        // row, not that some `where` clause forgot to ask for it.
        return tx.auditLog.findMany({ where: { id: s1 } })
      })
      expect(hidden).toHaveLength(0)

      // Positive control. A policy of `USING (false)`, a wiped table, or a
      // broken fixture all satisfy the zero above. Identical query, identical
      // code path, only `app.branch_id` differs — this passing is what proves
      // the policy is keyed on the branch rather than blocking everything.
      const visible = await prisma.$transaction(async (tx) => {
        await setRlsGucs(tx, Role.FRONT_DESK, frontDesk.id, siblingOfA.id)
        return tx.auditLog.findMany({ where: { id: s1 } })
      })
      expect(visible).toHaveLength(1)
    })

    it("RLS backstop: the same branch-scoped session does see its own branch's row", async () => {
      const rows = await prisma.$transaction(async (tx) => {
        await setRlsGucs(tx, Role.FRONT_DESK, frontDesk.id, branchA.id)
        return tx.auditLog.findMany({ where: { id: own1 } })
      })
      expect(rows).toHaveLength(1)
      expect(rows[0].branchId).toBe(branchA.id)
    })

    it("RLS backstop: the sibling's PHI and attemptedBranchId never reach a branch-scoped session", async () => {
      // A whole-entityType sweep rather than a lookup by id: this is the
      // shape a leak would actually take — a list query that forgot its
      // branch predicate and fell back on the database to be right.
      const fromBranchA = await prisma.$transaction(async (tx) => {
        await setRlsGucs(tx, Role.FRONT_DESK, frontDesk.id, branchA.id)
        return tx.auditLog.findMany({ where: { entityType: TYPE_SIBLING } })
      })
      expect(fromBranchA.map((r) => r.id)).toEqual([own1]) // positive control: own row present
      expect(JSON.stringify(fromBranchA)).not.toContain(SIBLING_PHI)
      expect(JSON.stringify(fromBranchA)).not.toContain(siblingOfA.id)

      const fromSibling = await prisma.$transaction(async (tx) => {
        await setRlsGucs(tx, Role.FRONT_DESK, frontDesk.id, siblingOfA.id)
        return tx.auditLog.findMany({ where: { entityType: TYPE_SIBLING } })
      })
      expect(fromSibling.map((r) => r.id)).toEqual([s1])
      expect(JSON.stringify(fromSibling)).toContain(SIBLING_PHI)
    })

    it("RLS backstop: branch_id IS NULL rows are invisible to a branch-scoped session — the SELECT policy has no NULL arm", async () => {
      // `audit_logs` is the one table whose branch_id is nullable, and its
      // INSERT policy has an explicit `branch_id IS NULL` arm that the SELECT
      // policy deliberately does not mirror. The consequence is that a
      // holding-level row is readable by holding admins only — a branch
      // session cannot see it even though the same session could (via raw
      // SQL) have written it. See the INSERT test below for the other half.
      const fromBranchA = await prisma.$transaction(async (tx) => {
        await setRlsGucs(tx, Role.FRONT_DESK, frontDesk.id, branchA.id)
        return {
          holdingLevel: await tx.auditLog.findMany({ where: { id: a4 } }),
          // Positive control inside the very same session: this context is
          // not simply blind.
          ownRow: await tx.auditLog.findMany({ where: { id: own1 } }),
        }
      })
      expect(fromBranchA.holdingLevel).toHaveLength(0)
      expect(fromBranchA.ownRow).toHaveLength(1)

      // Second positive control: the row itself is readable — through the
      // policy's role arm, which is the only arm a NULL branch_id can match.
      const asHoldingAdmin = await prisma.$transaction(async (tx) => {
        await setRlsGucs(tx, Role.HOLDING_ADMIN, holdingAdmin.id, "")
        return tx.auditLog.findMany({ where: { id: a4 } })
      })
      expect(asHoldingAdmin).toHaveLength(1)
      expect(asHoldingAdmin[0].branchId).toBeNull()
    })

    it("append-only: a branch-scoped session cannot UPDATE even its own branch's audit row", async () => {
      // There is no UPDATE policy on `audit_logs` at all, so every row is
      // outside the updatable set and `updateMany` matches nothing.
      const result = await prisma.$transaction(async (tx) => {
        await setRlsGucs(tx, Role.FRONT_DESK, frontDesk.id, branchA.id)
        // Positive control, in the same transaction and the same session:
        // the row IS visible here, so `count: 0` below is the missing UPDATE
        // policy rather than an invisible row.
        const readable = await tx.auditLog.findMany({ where: { id: own1 } })
        const updated = await tx.auditLog.updateMany({ where: { id: own1 }, data: { action: "tampered.by.own.branch" } })
        return { readable: readable.length, count: updated.count }
      })
      expect(result.readable).toBe(1)
      expect(result.count).toBe(0)

      const row = await superuserPrisma.auditLog.findUniqueOrThrow({ where: { id: own1 } })
      expect(row.action).toBe(ACTION_SIBLING)
    })

    it("append-only: neither branch can UPDATE the sibling's audit row — not the neighbour, not its owner", async () => {
      const fromBranchA = await prisma.$transaction(async (tx) => {
        await setRlsGucs(tx, Role.FRONT_DESK, frontDesk.id, branchA.id)
        return tx.auditLog.updateMany({ where: { id: s1 }, data: { action: "tampered.from.branch.a" } })
      })
      expect(fromBranchA.count).toBe(0)

      const fromSibling = await prisma.$transaction(async (tx) => {
        await setRlsGucs(tx, Role.CLINIC_ADMIN, siblingAdmin.id, siblingOfA.id)
        // Positive control: the owning branch can read it, so the zero counts
        // are about writing, not about visibility.
        const readable = await tx.auditLog.findMany({ where: { id: s1 } })
        const updated = await tx.auditLog.updateMany({ where: { id: s1 }, data: { action: "tampered.from.sibling" } })
        return { readable: readable.length, count: updated.count }
      })
      expect(fromSibling.readable).toBe(1)
      expect(fromSibling.count).toBe(0)

      const row = await superuserPrisma.auditLog.findUniqueOrThrow({ where: { id: s1 } })
      expect(row.action).toBe(ACTION_SIBLING)
    })

    it("append-only: not even a HOLDING_ADMIN session can UPDATE an audit row", async () => {
      // Append-only is not a branch rule — the role arm of the SELECT policy
      // widens *reads* only. Someone who can see every branch's trail still
      // cannot rewrite any of it.
      const result = await prisma.$transaction(async (tx) => {
        await setRlsGucs(tx, Role.HOLDING_ADMIN, holdingAdmin.id, "")
        const readable = await tx.auditLog.findMany({ where: { id: s1 } })
        const updated = await tx.auditLog.updateMany({ where: { id: s1 }, data: { action: "tampered.by.holding.admin" } })
        return { readable: readable.length, count: updated.count }
      })
      expect(result.readable).toBe(1) // positive control: fully visible to this session
      expect(result.count).toBe(0)

      const row = await superuserPrisma.auditLog.findUniqueOrThrow({ where: { id: s1 } })
      expect(row.action).toBe(ACTION_SIBLING)
    })

    it("append-only: a single-row update rejects rather than silently reporting success", async () => {
      // `updateMany` reporting 0 is easy to ignore; the single-row form has
      // to fail loudly, because a caller that ignores its result would
      // otherwise believe the row was rewritten.
      const attempt = prisma.$transaction(async (tx) => {
        await setRlsGucs(tx, Role.FRONT_DESK, frontDesk.id, branchA.id)
        return tx.auditLog.update({ where: { id: own1 }, data: { action: "tampered.single" } })
      })
      await expect(attempt).rejects.toThrow(/No record was found for an update/)

      const row = await superuserPrisma.auditLog.findUniqueOrThrow({ where: { id: own1 } })
      expect(row.action).toBe(ACTION_SIBLING)
    })

    it("append-only: a branch-scoped session cannot hard-delete an audit row", async () => {
      // Belt and braces above the missing UPDATE policy: the app role is not
      // granted DELETE on this table at all, so the attempt fails at
      // permission-check time rather than quietly matching zero rows.
      const attempt = prisma.$transaction(async (tx) => {
        await setRlsGucs(tx, Role.FRONT_DESK, frontDesk.id, branchA.id)
        return tx.auditLog.deleteMany({ where: { id: own1 } })
      })
      await expect(attempt).rejects.toThrow(/permission denied/)

      // Positive control: the row is still there to have been deleted.
      expect(await superuserPrisma.auditLog.count({ where: { id: own1 } })).toBe(1)
    })

    it("RLS backstop: a branch-scoped session cannot forge an audit row attributed to a sibling branch", async () => {
      // The mirror image of the SELECT tests. A branch that cannot read its
      // sibling's trail must also not be able to write into it — planting a
      // fabricated entry under the branch next door is a tamper, not a read.
      const forged = prisma.$transaction(async (tx) => {
        await setRlsGucs(tx, Role.FRONT_DESK, frontDesk.id, branchA.id)
        return tx.auditLog.create({
          data: {
            branchId: siblingOfA.id,
            userId: frontDesk.id,
            action: ACTION_INSERT,
            entityType: TYPE_INSERT,
            entityId: `insert-forged-${RUN}`,
          },
        })
      })
      await expect(forged).rejects.toThrow(/row-level security policy/)
      expect(await superuserPrisma.auditLog.count({ where: { entityId: `insert-forged-${RUN}` } })).toBe(0)

      // Positive control: the identical write into the caller's OWN branch
      // succeeds, so the rejection above is the branch predicate and not a
      // blanket "this session may never insert".
      const allowed = await prisma.$transaction(async (tx) => {
        await setRlsGucs(tx, Role.FRONT_DESK, frontDesk.id, branchA.id)
        return tx.auditLog.create({
          data: {
            branchId: branchA.id,
            userId: frontDesk.id,
            action: ACTION_INSERT,
            entityType: TYPE_INSERT,
            entityId: `insert-own-${RUN}`,
          },
        })
      })
      expect(allowed.branchId).toBe(branchA.id)
    })

    it("the INSERT policy's wider NULL arm is unreachable through Prisma, and unreadable even when forced", async () => {
      // The asymmetry spelled out: INSERT accepts `branch_id IS NULL`,
      // SELECT has no NULL arm. Prisma's `create` always emits RETURNING, and
      // Postgres runs the SELECT policy over the returned row — so the wider
      // INSERT arm is dead code for any ORM write from a branch session.
      const viaPrisma = prisma.$transaction(async (tx) => {
        await setRlsGucs(tx, Role.FRONT_DESK, frontDesk.id, branchA.id)
        return tx.auditLog.create({
          data: {
            branchId: null,
            userId: frontDesk.id,
            action: ACTION_INSERT,
            entityType: TYPE_INSERT,
            entityId: `insert-null-prisma-${RUN}`,
          },
        })
      })
      await expect(viaPrisma).rejects.toThrow(/row-level security policy/)
      expect(await superuserPrisma.auditLog.count({ where: { entityId: `insert-null-prisma-${RUN}` } })).toBe(0)

      // Drop the RETURNING and the same session's INSERT is accepted — which
      // is what the wider arm actually buys, and the reason it is worth
      // pinning: the write lands somewhere its author can never read back.
      const rawEntityId = `insert-null-raw-${RUN}`
      const inserted = await prisma.$transaction(async (tx) => {
        await setRlsGucs(tx, Role.FRONT_DESK, frontDesk.id, branchA.id)
        return tx.$executeRaw`INSERT INTO "audit_logs" ("id", "branch_id", "user_id", "action", "entity_type", "entity_id", "created_at")
          VALUES (gen_random_uuid(), NULL, ${frontDesk.id}::uuid, ${ACTION_INSERT}, ${TYPE_INSERT}, ${rawEntityId}, now())`
      })
      expect(inserted).toBe(1)

      const readBack = await prisma.$transaction(async (tx) => {
        await setRlsGucs(tx, Role.FRONT_DESK, frontDesk.id, branchA.id)
        return tx.auditLog.findMany({ where: { entityId: rawEntityId } })
      })
      expect(readBack).toHaveLength(0)
      // Positive control: the row genuinely exists — the zero above is the
      // missing NULL arm on SELECT, not a failed insert.
      expect(await superuserPrisma.auditLog.count({ where: { entityId: rawEntityId } })).toBe(1)

      // Positive control for the rejection: a HOLDING_ADMIN session writes
      // the exact same branch-less row through Prisma without complaint,
      // because the role arm satisfies both policies at once.
      const holdingLevel = await prisma.$transaction(async (tx) => {
        await setRlsGucs(tx, Role.HOLDING_ADMIN, holdingAdmin.id, "")
        return tx.auditLog.create({
          data: {
            branchId: null,
            userId: holdingAdmin.id,
            action: ACTION_INSERT,
            entityType: TYPE_INSERT,
            entityId: `insert-null-holding-${RUN}`,
          },
        })
      })
      expect(holdingLevel.branchId).toBeNull()
    })
  })
})

describe("normalizeChanges", () => {
  it("returns null for an absent or empty payload", () => {
    expect(normalizeChanges(null)).toBeNull()
    expect(normalizeChanges(undefined)).toBeNull()
    expect(normalizeChanges({})).toBeNull()
    expect(normalizeChanges([])).toBeNull()
    expect(normalizeChanges("")).toBeNull()
  })

  it("keeps integer centavos exactly as stored", () => {
    expect(normalizeChanges({ amount: 12345 })).toBe('{"amount":12345}')
    expect(normalizeChanges(12345)).toBe("12345")
  })

  it("passes a bare string through and stringifies anything else", () => {
    expect(normalizeChanges("stock count corrected")).toBe("stock count corrected")
    expect(normalizeChanges(true)).toBe("true")
    expect(normalizeChanges({ from: 1, to: 2 })).toBe('{"from":1,"to":2}')
    expect(normalizeChanges([1, "a"])).toBe('[1,"a"]')
  })
})
