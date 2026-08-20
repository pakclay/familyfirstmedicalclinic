// Phase 0 seed: branches + one staff account per role, enough to prove
// role-aware auth and nav end to end. Patients, appointments, leads, and
// quota data get seeded incrementally as each phase's feature lands (see
// DECISIONS.md) rather than faked wholesale now against schema that hasn't
// been exercised yet.

import { PrismaClient, type EmploymentType, type Role } from "@prisma/client"
import bcrypt from "bcryptjs"

const prisma = new PrismaClient()

const DEV_PASSWORD = "StretchPH2026!"

async function main() {
  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 10)

  const branches = await Promise.all(
    [
      {
        code: "SF-CT",
        name: "Stretch Lab PH — San Fernando (Capital Town)",
        address: "Capital Town, San Fernando, Pampanga — address pending owner confirmation",
        city: "San Fernando",
        province: "Pampanga",
        phone: "0917-000-0001",
        openingHours: { mon_sat: "9:00-19:00", sun: "9:00-15:00" },
      },
      {
        code: "SF-SN",
        name: "Stretch Lab PH — San Fernando (Sto. Niño)",
        address: "Sto. Niño, San Fernando, Pampanga — address pending owner confirmation",
        city: "San Fernando",
        province: "Pampanga",
        phone: "0917-000-0002",
        openingHours: { mon_sat: "9:00-19:00", sun: "9:00-15:00" },
      },
      {
        code: "ANG-1",
        name: "Stretch Lab PH — Angeles City",
        address: "Angeles City, Pampanga — address pending owner confirmation",
        city: "Angeles City",
        province: "Pampanga",
        phone: "0917-000-0003",
        openingHours: { mon_sat: "9:00-19:00", sun: "9:00-15:00" },
      },
      {
        code: "PAMP-4",
        name: "Stretch Lab PH — Branch 4 (name/location pending)",
        address: "Pampanga — branch identity pending owner confirmation (see DECISIONS.md §15.1)",
        city: "Pampanga",
        province: "Pampanga",
        phone: "0917-000-0004",
        openingHours: { mon_sat: "9:00-19:00", sun: "9:00-15:00" },
      },
      {
        code: "NEW-5",
        name: "Stretch Lab PH — 5th Branch (opening soon)",
        address: "Location pending owner confirmation (see DECISIONS.md §15.1)",
        city: "Pampanga",
        province: "Pampanga",
        phone: "0917-000-0005",
        openingHours: { mon_sat: "9:00-19:00", sun: "9:00-15:00" },
        isActive: false,
      },
    ].map((b) => prisma.branch.upsert({ where: { code: b.code }, update: {}, create: b }))
  )

  const [branchSfCt, branchSfSn, branchAng1] = branches

  type SeedUser = {
    email: string
    name: string
    role: Role
    homeBranchId: string | null
    therapist?: { specialties: string[]; employmentType: EmploymentType }
  }

  const users: SeedUser[] = [
    {
      email: "owner@stretchlabph.dev",
      name: "Ma. Teresa Santos",
      role: "OWNER",
      homeBranchId: null,
    },
    {
      email: "manager.capitaltown@stretchlabph.dev",
      name: "Angelo Reyes",
      role: "BRANCH_MANAGER",
      homeBranchId: branchSfCt.id,
    },
    {
      email: "manager.stonino@stretchlabph.dev",
      name: "Kristine Bautista",
      role: "BRANCH_MANAGER",
      homeBranchId: branchSfSn.id,
    },
    {
      email: "manager.angeles@stretchlabph.dev",
      name: "Paolo Dizon",
      role: "BRANCH_MANAGER",
      homeBranchId: branchAng1.id,
    },
    {
      email: "manager.branch4@stretchlabph.dev",
      name: "Cherry Mendoza",
      role: "BRANCH_MANAGER",
      homeBranchId: branches[3].id,
    },
    {
      email: "doctor@stretchlabph.dev",
      name: "Dr. Ramon Villanueva",
      role: "DOCTOR",
      homeBranchId: branchSfCt.id,
    },
    {
      email: "pt.lead@stretchlabph.dev",
      name: "Jasmine Cruz",
      role: "THERAPIST",
      homeBranchId: branchSfCt.id,
      therapist: { specialties: ["Rehab", "Sports Injury"], employmentType: "FULL_TIME" },
    },
    {
      email: "ot.osteo@stretchlabph.dev",
      name: "Michael Torres",
      role: "THERAPIST",
      homeBranchId: branchSfSn.id,
      therapist: { specialties: ["Osteopathy", "Occupational Therapy"], employmentType: "FULL_TIME" },
    },
    {
      email: "pt.flexology@stretchlabph.dev",
      name: "Bea Fernandez",
      role: "THERAPIST",
      homeBranchId: branchAng1.id,
      therapist: { specialties: ["Flexology", "Body Tune-Up"], employmentType: "FULL_TIME" },
    },
    {
      email: "pt.junior@stretchlabph.dev",
      name: "Joyce Ramos",
      role: "THERAPIST",
      homeBranchId: branchSfCt.id,
      therapist: { specialties: ["Wellness Recovery"], employmentType: "PART_TIME" },
    },
    {
      email: "frontdesk@stretchlabph.dev",
      name: "Angelica Navarro",
      role: "FRONT_DESK",
      homeBranchId: branchSfCt.id,
    },
    {
      email: "marketing@stretchlabph.dev",
      name: "Patrick Aquino",
      role: "MARKETING",
      homeBranchId: null,
    },
  ]

  const therapistUserIds: { email: string; id: string; homeBranchId: string }[] = []

  for (const u of users) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        email: u.email,
        passwordHash,
        name: u.name,
        role: u.role,
        homeBranchId: u.homeBranchId,
        mustChangePassword: true,
      },
    })

    if (u.therapist) {
      await prisma.therapistProfile.upsert({
        where: { userId: user.id },
        update: {},
        create: {
          userId: user.id,
          specialties: u.therapist.specialties,
          servicesOffered: [],
          employmentType: u.therapist.employmentType,
          startedAt: new Date("2023-01-01"),
        },
      })
      if (u.homeBranchId) therapistUserIds.push({ email: u.email, id: user.id, homeBranchId: u.homeBranchId })
    }
  }

  // ── Services (§13: ~14, split Wellness/Rehab) ─────────────────────────
  const services = await Promise.all(
    [
      // Wellness — never touches the doctor queue, never gated by a prescription.
      { code: "W-RECOVERY", name: "Recovery Session", category: "WELLNESS", durationMin: 45, priceCentavos: 80000 },
      { code: "W-TUNEUP", name: "Body Tune-Up", category: "WELLNESS", durationMin: 60, priceCentavos: 120000 },
      { code: "W-FLEX", name: "Flexology", category: "WELLNESS", durationMin: 45, priceCentavos: 90000 },
      { code: "W-SPORTS", name: "Sports Massage", category: "WELLNESS", durationMin: 60, priceCentavos: 100000 },
      { code: "W-COMPRESS", name: "Compression Therapy", category: "WELLNESS", durationMin: 30, priceCentavos: 50000 },
      { code: "W-DEEPTISSUE", name: "Deep Tissue Massage", category: "WELLNESS", durationMin: 60, priceCentavos: 110000 },
      { code: "W-CUPPING", name: "Cupping Therapy", category: "WELLNESS", durationMin: 30, priceCentavos: 60000 },
      // Rehab — the initial assessment and taping don't require a prescription
      // (there's nothing to prescribe against yet / it's a minor add-on);
      // ongoing treatment sessions do. See DECISIONS.md.
      {
        code: "R-ASSESS",
        name: "Initial Assessment",
        category: "REHAB",
        durationMin: 60,
        priceCentavos: 150000,
        requiresPrescription: false,
      },
      {
        code: "R-ORTHO",
        name: "Orthopedic Rehab",
        category: "REHAB",
        durationMin: 60,
        priceCentavos: 120000,
        requiresPrescription: true,
      },
      {
        code: "R-POSTOP",
        name: "Post-Op Rehab",
        category: "REHAB",
        durationMin: 60,
        priceCentavos: 120000,
        requiresPrescription: true,
      },
      {
        code: "R-STROKE",
        name: "Stroke Rehab",
        category: "REHAB",
        durationMin: 60,
        priceCentavos: 150000,
        requiresPrescription: true,
      },
      {
        code: "R-SPINAL",
        name: "Spinal Program",
        category: "REHAB",
        durationMin: 60,
        priceCentavos: 150000,
        requiresPrescription: true,
      },
      {
        code: "R-DRYNEEDLE",
        name: "Dry Needling",
        category: "REHAB",
        durationMin: 30,
        priceCentavos: 80000,
        requiresPrescription: true,
      },
      {
        code: "R-TAPING",
        name: "Taping",
        category: "REHAB",
        durationMin: 20,
        priceCentavos: 40000,
        requiresPrescription: false,
      },
    ].map((s) =>
      prisma.service.upsert({
        where: { code: s.code },
        update: {},
        create: {
          code: s.code,
          name: s.name,
          category: s.category as "WELLNESS" | "REHAB",
          durationMin: s.durationMin,
          priceCentavos: s.priceCentavos,
          requiresPrescription: s.requiresPrescription ?? false,
        },
      })
    )
  )
  const recoveryService = services.find((s) => s.code === "W-RECOVERY")!

  // ── Packages (§13: 5/10/20 sessions + intro offer) ────────────────────
  // Package.name has no unique constraint, so upsert-by-name isn't
  // available — find-or-create keeps the seed idempotent instead.
  const packageSeeds = [
    { name: "Intro Offer", serviceId: recoveryService.id, sessionCount: 1, priceCentavos: 49900, validityDays: 14 },
    { name: "5-Session Package", serviceId: null, sessionCount: 5, priceCentavos: 360000, validityDays: 60 },
    { name: "10-Session Package", serviceId: null, sessionCount: 10, priceCentavos: 680000, validityDays: 90 },
    { name: "20-Session Package", serviceId: null, sessionCount: 20, priceCentavos: 1280000, validityDays: 180 },
  ]
  for (const p of packageSeeds) {
    const existing = await prisma.package.findFirst({ where: { name: p.name } })
    if (!existing) await prisma.package.create({ data: p })
  }

  // ── Rooms (2 per active branch) ────────────────────────────────────────
  for (const branch of branches.filter((b) => b.isActive)) {
    for (const roomName of ["Room 1", "Room 2"]) {
      await prisma.room.upsert({
        where: { branchId_name: { branchId: branch.id, name: roomName } },
        update: {},
        create: { branchId: branch.id, name: roomName },
      })
    }
  }

  // ── Therapist availability (Mon–Sat 9:00–18:00 at their home branch) ──
  for (const t of therapistUserIds) {
    for (let dayOfWeek = 1; dayOfWeek <= 6; dayOfWeek++) {
      const existing = await prisma.therapistAvailability.findFirst({
        where: { therapistId: t.id, branchId: t.homeBranchId, dayOfWeek },
      })
      if (!existing) {
        await prisma.therapistAvailability.create({
          data: {
            therapistId: t.id,
            branchId: t.homeBranchId,
            dayOfWeek,
            startTime: "09:00",
            endTime: "18:00",
            effectiveFrom: new Date("2023-01-01"),
          },
        })
      }
    }
  }

  console.log("\nSeed complete.\n")
  console.log("Login credentials (all roles share one dev password):\n")
  console.log(`  Password: ${DEV_PASSWORD}\n`)
  for (const u of users) {
    console.log(`  ${u.role.padEnd(15)} ${u.email}`)
  }
  console.log("")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
