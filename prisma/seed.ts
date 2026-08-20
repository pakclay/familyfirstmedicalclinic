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
