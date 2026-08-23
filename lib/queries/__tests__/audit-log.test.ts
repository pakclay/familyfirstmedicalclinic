import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { Role } from "@prisma/client"
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

/** All five paging fixtures share this instant exactly, to force sort ties. */
const TIED_INSTANT = new Date("2026-05-04T04:00:00.000Z")

/** Ours — the ones a holding admin of `holding` is entitled to see. */
const OWN_FIXTURE_TYPES = [TYPE_ALPHA, TYPE_BETA, TYPE_PAGED]
/** Everything this suite creates, including the rival's, for teardown only. */
const FIXTURE_TYPES = [...OWN_FIXTURE_TYPES, TYPE_FOREIGN]

function idsOf(rows: { id: string }[]): string[] {
  return rows.map((r) => r.id).sort()
}

function sorted(ids: string[]): string[] {
  return [...ids].sort()
}

describe("listAuditLog", () => {
  let holding: { id: string }
  let clinicA: { id: string; name: string }
  let clinicB: { id: string; name: string }
  let holdingAdmin: AbilitySubject
  let clinicAdmin: AbilitySubject
  let frontDesk: AbilitySubject
  let doctor: AbilitySubject
  let frontDeskName: string
  let clinicAdminName: string

  // TYPE_ALPHA fixtures, oldest first.
  let a1: string // clinic A · front desk · ACTION_ALPHA · Jan 10
  let a2: string // clinic A · front desk · ACTION_BETA  · Mar 15
  let a3: string // clinic B · clinic admin · ACTION_ALPHA · Mar 16
  let a4: string // NO clinic · NO user · ACTION_ALPHA · Mar 17
  let b1: string // TYPE_BETA · clinic A · front desk · Mar 18
  let pagedIds: string[] = []

  // A second, unrelated holding company. Nothing below belongs to our
  // holdingAdmin, and none of it may ever surface in their results.
  let otherHolding: { id: string }
  let otherClinic: { id: string; name: string }
  let otherClinicUserName: string
  let otherHoldingAdminName: string
  let f1: string // foreign clinic row
  let f2: string // foreign holding-level row (no clinic, foreign owner)

  beforeAll(async () => {
    holding = await superuserPrisma.holdingCompany.create({ data: { name: `Test Holding — audit ${RUN}` } })

    const clinicData = (name: string, slug: string) => ({
      holdingCompanyId: holding.id,
      name,
      slug,
      address: "1 Test St",
      city: "Test City",
      phone: "0000",
      operatingHours: {},
    })
    clinicA = await superuserPrisma.clinic.create({
      data: clinicData(`Audit Clinic A ${RUN}`, `audit-clinic-a-${RUN}`),
    })
    clinicB = await superuserPrisma.clinic.create({
      data: clinicData(`Audit Clinic B ${RUN}`, `audit-clinic-b-${RUN}`),
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
        clinicId: clinicA.id,
        name: clinicAdminName,
        email: `audit-admin-${RUN}@test.local`,
        passwordHash: "x",
        role: Role.CLINIC_ADMIN,
      },
    })
    const frontDeskUser = await superuserPrisma.user.create({
      data: {
        clinicId: clinicA.id,
        name: frontDeskName,
        email: `audit-fd-${RUN}@test.local`,
        passwordHash: "x",
        role: Role.FRONT_DESK,
      },
    })
    const doctorUser = await superuserPrisma.user.create({
      data: {
        clinicId: clinicA.id,
        name: `Audit Doctor ${RUN}`,
        email: `audit-dr-${RUN}@test.local`,
        passwordHash: "x",
        role: Role.DOCTOR,
      },
    })

    holdingAdmin = { id: holdingUser.id, role: Role.HOLDING_ADMIN, clinicId: null, holdingCompanyId: holding.id }
    clinicAdmin = { id: adminUser.id, role: Role.CLINIC_ADMIN, clinicId: clinicA.id, holdingCompanyId: null }
    frontDesk = { id: frontDeskUser.id, role: Role.FRONT_DESK, clinicId: clinicA.id, holdingCompanyId: null }
    doctor = { id: doctorUser.id, role: Role.DOCTOR, clinicId: clinicA.id, holdingCompanyId: null }

    // Timestamps sit at midday Manila so the range assertions don't hinge on
    // a few hours of timezone slop either way.
    const rowA1 = await superuserPrisma.auditLog.create({
      data: {
        clinicId: clinicA.id,
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
        clinicId: clinicA.id,
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
        clinicId: clinicB.id,
        userId: adminUser.id,
        action: ACTION_ALPHA,
        entityType: TYPE_ALPHA,
        entityId: `patient-beta-${RUN}`,
        createdAt: new Date("2026-03-16T04:00:00.000Z"),
      },
    })
    // Holding-level row: no clinic, no acting user, no entity id, no
    // changes. Every one of these is nullable in the schema and the viewer
    // has to render the row anyway.
    const rowA4 = await superuserPrisma.auditLog.create({
      data: {
        clinicId: null,
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
        clinicId: clinicA.id,
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
            clinicId: clinicA.id,
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

    // ── A second holding company, entirely unrelated to `holding` ────────
    // The RLS policy grants any HOLDING_ADMIN a blanket bypass and says
    // nothing about *which* holding company they own, so these rows are
    // visible at the database layer. Only the application-level holding
    // scope keeps them out — which is exactly what these fixtures test.
    otherHolding = await superuserPrisma.holdingCompany.create({
      data: { name: `Rival Holding — audit ${RUN}` },
    })
    otherClinic = await superuserPrisma.clinic.create({
      data: {
        holdingCompanyId: otherHolding.id,
        name: `Rival Clinic ${RUN}`,
        slug: `rival-clinic-${RUN}`,
        address: "9 Rival St",
        city: "Rival City",
        phone: "9999",
        operatingHours: {},
      },
    })
    otherClinicUserName = `Rival Front Desk ${RUN}`
    otherHoldingAdminName = `Rival Owner ${RUN}`
    const otherClinicUser = await superuserPrisma.user.create({
      data: {
        clinicId: otherClinic.id,
        name: otherClinicUserName,
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
        clinicId: otherClinic.id,
        userId: otherClinicUser.id,
        action: ACTION_ALPHA,
        entityType: TYPE_FOREIGN,
        entityId: SHARED_ENTITY_ID, // same entityId as ours, so `q` can't be a fluke
        createdAt: new Date("2026-03-19T04:00:00.000Z"),
      },
    })
    // Clinic-less, but written by the RIVAL owner — the case a naive
    // "clinicId IS NULL is always visible" rule would leak.
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
    const clinicIds = [clinicA.id, clinicB.id, otherClinic.id]
    const holdingIds = [holding.id, otherHolding.id]
    await superuserPrisma.auditLog.deleteMany({ where: { entityType: { in: FIXTURE_TYPES } } })
    await superuserPrisma.auditLog.deleteMany({ where: { clinicId: { in: clinicIds } } })
    // Clinic-less rows are found via their author, not their clinic.
    await superuserPrisma.auditLog.deleteMany({
      where: { user: { holdingCompanyId: { in: holdingIds } } },
    })
    await superuserPrisma.user.deleteMany({ where: { clinicId: { in: clinicIds } } })
    await superuserPrisma.user.deleteMany({ where: { holdingCompanyId: { in: holdingIds } } })
    await superuserPrisma.clinic.deleteMany({ where: { id: { in: clinicIds } } })
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

  it("maps a clinic-and-user row into the DTO with names resolved", async () => {
    const result = await listAuditLog(holdingAdmin, { entityType: TYPE_ALPHA })
    const row = result.rows.find((r) => r.id === a1)

    expect(row).toBeDefined()
    expect(row).toMatchObject({
      id: a1,
      clinicId: clinicA.id,
      clinicName: clinicA.name,
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

  it("still returns and renders a row with no clinic and no user", async () => {
    const result = await listAuditLog(holdingAdmin, { entityType: TYPE_ALPHA })
    const row = result.rows.find((r) => r.id === a4)

    expect(row).toBeDefined()
    expect(row).toMatchObject({
      clinicId: null,
      clinicName: null,
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
    it("hides another holding company's clinic rows", async () => {
      const result = await listAuditLog(holdingAdmin, { entityType: TYPE_FOREIGN })
      expect(result.rows).toEqual([])
      expect(result.total).toBe(0)
    })

    it("hides another holding company's clinic-less rows", async () => {
      // f2 has clinicId NULL, so a rule that treated "no clinic" as
      // "holding-level, always visible" would leak it across tenants.
      const result = await listAuditLog(holdingAdmin, { action: ACTION_ALPHA })
      const ids = result.rows.map((r) => r.id)
      expect(ids).not.toContain(f1)
      expect(ids).not.toContain(f2)
      expect(ids).toContain(a1) // ...while our own rows still come back
    })

    it("still shows our own clinic-less rows, including system rows with no user", async () => {
      // a4 has neither clinic nor user — a retention.purge-shaped row. The
      // scope must not throw those away while excluding foreign ones.
      const result = await listAuditLog(holdingAdmin, { entityType: TYPE_ALPHA })
      expect(result.rows.map((r) => r.id)).toContain(a4)
    })

    it("cannot be widened by a hand-edited clinicId filter", async () => {
      // The filters are AND-ed with the holding scope, so naming another
      // owner's clinic intersects to nothing rather than reaching across.
      const result = await listAuditLog(holdingAdmin, { clinicId: otherClinic.id })
      expect(result.rows).toEqual([])
      expect(result.total).toBe(0)
    })

    it("cannot be widened by a hand-edited userId filter", async () => {
      const rival = await superuserPrisma.user.findFirstOrThrow({
        where: { name: otherClinicUserName },
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

    it("does not enumerate other holding companies in the clinic dropdown", async () => {
      // `clinics` has no RLS policy at all, so an unfiltered read here would
      // list every clinic in the database regardless of owner.
      const result = await listAuditLog(holdingAdmin, {})
      const names = result.options.clinics.map((c) => c.name)
      expect(names).toContain(clinicA.name)
      expect(names).not.toContain(otherClinic.name)
    })

    it("does not enumerate other holding companies' accounts in the user dropdown", async () => {
      const result = await listAuditLog(holdingAdmin, {})
      const names = result.options.users.map((u) => u.name)
      expect(names).toContain(frontDeskName)
      expect(names).not.toContain(otherClinicUserName)
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

    it("narrows by clinicId", async () => {
      const result = await listAuditLog(holdingAdmin, { entityType: TYPE_ALPHA, clinicId: clinicB.id })
      expect(idsOf(result.rows)).toEqual([a3])
      expect(result.rows[0].clinicName).toBe(clinicB.name)
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
        clinicId: clinicB.id,
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
      expect(result.options.clinics.map((c) => c.id)).toEqual(expect.arrayContaining([clinicA.id, clinicB.id]))
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
