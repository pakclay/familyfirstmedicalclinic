import { PrismaClient, Role, Sex } from "@prisma/client"
import bcrypt from "bcryptjs"

// Seeds against DATABASE_URL (the migration/superuser role) — RLS applies
// only to the app's runtime connection (APP_DATABASE_URL / webinar_app),
// so seeding needs no RLS session GUCs. See lib/db/prisma.ts.
const prisma = new PrismaClient()

const DEV_PASSWORD = "FamilyFirst2026!"

const HOURS_MON_SAT = { open: "08:00", close: "17:00" }
const STANDARD_HOURS = {
  mon: HOURS_MON_SAT,
  tue: HOURS_MON_SAT,
  wed: HOURS_MON_SAT,
  thu: HOURS_MON_SAT,
  fri: HOURS_MON_SAT,
  sat: { open: "08:00", close: "12:00" },
  sun: null,
}

async function main() {
  // Idempotent: reseeding from scratch is the expected way to run this
  // script in dev, so clear anything the previous run created first
  // (FK-safe order) rather than failing on duplicate emails/slugs.
  await prisma.auditLog.deleteMany()
  await prisma.patient.deleteMany()
  await prisma.doctor.deleteMany()
  await prisma.user.deleteMany()
  await prisma.clinic.deleteMany()
  await prisma.holdingCompany.deleteMany()

  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 10)

  const holding = await prisma.holdingCompany.create({
    data: {
      name: "Family First Holdings",
      contactEmail: "owner@familyfirst.example",
      contactPhone: "+63 900 000 0000",
    },
  })

  // Placeholder locations — no real branch list supplied yet (SPEC.md §13.5).
  // Swap for the real clinic names/addresses/Facebook pages when available.
  const clinicSeeds = [
    { name: "Family First Medical Clinic – Quezon City", slug: "quezon-city", city: "Quezon City" },
    { name: "Family First Medical Clinic – Makati", slug: "makati", city: "Makati" },
    { name: "Family First Medical Clinic – Cebu", slug: "cebu", city: "Cebu City" },
  ]

  const holdingAdmin = await prisma.user.create({
    data: {
      name: "Holding Owner",
      email: "owner@familyfirst.example",
      passwordHash,
      role: Role.HOLDING_ADMIN,
      holdingCompanyId: holding.id,
    },
  })

  const createdUsers = [{ role: "HOLDING_ADMIN", email: holdingAdmin.email, clinic: "(all)" }]

  for (const seed of clinicSeeds) {
    const clinic = await prisma.clinic.create({
      data: {
        holdingCompanyId: holding.id,
        name: seed.name,
        slug: seed.slug,
        address: `123 Placeholder St., ${seed.city}`,
        city: seed.city,
        phone: "+63 900 000 0001",
        facebookPageUrl: `https://facebook.com/familyfirst.${seed.slug}`,
        operatingHours: STANDARD_HOURS,
      },
    })

    const clinicAdminEmail = `admin.${seed.slug}@familyfirst.example`
    await prisma.user.create({
      data: {
        clinicId: clinic.id,
        name: `${seed.city} Clinic Admin`,
        email: clinicAdminEmail,
        passwordHash,
        role: Role.CLINIC_ADMIN,
      },
    })
    createdUsers.push({ role: "CLINIC_ADMIN", email: clinicAdminEmail, clinic: seed.name })

    for (let i = 1; i <= 2; i++) {
      const email = `staff${i}.${seed.slug}@familyfirst.example`
      await prisma.user.create({
        data: {
          clinicId: clinic.id,
          name: `${seed.city} Front Desk ${i}`,
          email,
          passwordHash,
          role: Role.FRONT_DESK,
        },
      })
      createdUsers.push({ role: "FRONT_DESK", email, clinic: seed.name })
    }

    for (let i = 1; i <= 3; i++) {
      const email = `doctor${i}.${seed.slug}@familyfirst.example`
      const doctorUser = await prisma.user.create({
        data: {
          clinicId: clinic.id,
          name: `Dr. ${seed.city} ${i}`,
          email,
          passwordHash,
          role: Role.DOCTOR,
        },
      })
      await prisma.doctor.create({
        data: {
          userId: doctorUser.id,
          clinicId: clinic.id,
          licenseNumber: `PH-LIC-${seed.slug}-${i}`,
          consultationFee: 50000, // ₱500.00
        },
      })
      createdUsers.push({ role: "DOCTOR", email, clinic: seed.name })
    }

    // A couple of demo patients per clinic — enough to click through M1's
    // patient screens and demonstrate cross-clinic scoping live. Full
    // realistic seed data (60 patients, 6 months of history — §11) builds
    // up incrementally as later milestones land, same approach the prior
    // project in this repo used.
    await prisma.patient.create({
      data: {
        clinicId: clinic.id,
        firstName: "Maria",
        lastName: "Santos",
        birthdate: new Date("1988-03-14"),
        sex: Sex.FEMALE,
        phone: "+63 917 000 1111",
        address: `45 Sample Ave., ${seed.city}`,
        emergencyContactName: "Jose Santos",
        emergencyContactPhone: "+63 917 000 2222",
        consentAt: new Date(),
      },
    })
    await prisma.patient.create({
      data: {
        clinicId: clinic.id,
        firstName: "Miguel",
        lastName: "Reyes",
        birthdate: new Date("2015-07-02"),
        sex: Sex.MALE,
        phone: "+63 917 000 3333",
        address: `78 Sample Ave., ${seed.city}`,
        emergencyContactName: "Ana Reyes",
        emergencyContactPhone: "+63 917 000 4444",
        guardianName: "Ana Reyes",
        guardianPhone: "+63 917 000 4444",
        consentAt: new Date(),
      },
    })
  }

  console.log(`\nSeeded ${createdUsers.length} users. Dev password for all seeded accounts: ${DEV_PASSWORD}\n`)
  console.table(createdUsers)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
