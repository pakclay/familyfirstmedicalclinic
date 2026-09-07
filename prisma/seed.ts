import { Role, Sex } from "@prisma/client"
import bcrypt from "bcryptjs"
import { createPrismaClient } from "../lib/db/client-factory"
import { loadEnvFiles, requireDatabaseUrl } from "../lib/db/env-files"
import { MEDICINE_CATALOG } from "./medicine-catalog"

// Seeds against DATABASE_URL (the migration/superuser role) — RLS applies
// only to the app's runtime connection (APP_DATABASE_URL / webinar_app),
// so seeding needs no RLS session GUCs. See lib/db/prisma.ts. Prisma 7
// neither loads .env nor opens a connection by itself, so the script does
// both (lib/db/client-factory.ts).
loadEnvFiles()
const prisma = createPrismaClient(requireDatabaseUrl())

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

/**
 * The catalog itself now lives in prisma/medicine-catalog.ts, shared with
 * prisma/seed-medicines.ts — the additive script that is safe to run
 * against a clinic already in use, which this file emphatically is not.
 *
 * Two of its entries are seeded below their reorder level so the low-stock
 * panel has something to show on a fresh database. Expiry is the one thing
 * the catalog will not carry (an expiry belongs to a delivery, not to a
 * medicine), so the "expiring soon" case §13 asks for is applied here.
 */
const DEMO_EXPIRES_IN_DAYS: Record<string, number> = {
  "Povidone Iodine": 25,
}

// Placeholder locations — no real branch list supplied yet (SPEC.md §13.5).
// Swap for the real clinic/branch names/addresses/Facebook pages when
// available. Cebu deliberately gets 2 branches (not 1, like the other two
// clinics) so the seed actually exercises the thing this hierarchy exists
// for: two branches *under the same clinic* that must not see each other's
// patients/queue/money — a stronger boundary test than cross-clinic alone,
// which every other seeded pair already covers. Going from 3 locations to 4
// keeps this from tripling the seed volume the way giving every clinic 2
// branches would.
//
// Clinic names carry no location, because the branch under them already
// does. Every public surface composes "{clinic} – {branch}"
// (lib/queries/public-branch-name.ts), so a clinic seeded as "Family First
// Medical Clinic – Quezon City" above a branch named "Quezon City" renders
// to patients as "… – Quezon City – Quezon City" on the booking page, the
// display screen, the status page and in SMS. Region names keep the three
// clinics tellable apart in admin UI without repeating the city.
const CLINIC_SEEDS = [
  {
    name: "Family First North",
    slug: "north",
    branches: [{ slug: "quezon-city", city: "Quezon City" }],
  },
  {
    name: "Family First South",
    slug: "south",
    branches: [{ slug: "makati", city: "Makati" }],
  },
  {
    name: "Family First Visayas",
    slug: "visayas",
    branches: [
      { slug: "cebu-city", city: "Cebu City" },
      { slug: "cebu-mandaue", city: "Mandaue City" },
    ],
  },
]

async function main() {
  // Idempotent: reseeding from scratch is the expected way to run this
  // script in dev, so clear anything the previous run created first
  // (FK-safe order) rather than failing on duplicate emails/slugs.
  await prisma.auditLog.deleteMany()
  await prisma.notification.deleteMany()
  await prisma.remittance.deleteMany()
  await prisma.expense.deleteMany()
  await prisma.medicineDispensed.deleteMany()
  await prisma.stockMovement.deleteMany()
  await prisma.payment.deleteMany()
  await prisma.consultation.deleteMany()
  await prisma.queueEntry.deleteMany()
  await prisma.medicine.deleteMany()
  await prisma.patient.deleteMany()
  await prisma.doctor.deleteMany()
  await prisma.user.deleteMany()
  await prisma.branch.deleteMany()
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

  const holdingAdmin = await prisma.user.create({
    data: {
      name: "Holding Owner",
      email: "owner@familyfirst.example",
      passwordHash,
      role: Role.HOLDING_ADMIN,
      holdingCompanyId: holding.id,
    },
  })

  const createdUsers = [{ role: "HOLDING_ADMIN", email: holdingAdmin.email, branch: "(all)" }]

  for (const clinicSeed of CLINIC_SEEDS) {
    const clinic = await prisma.clinic.create({
      data: { holdingCompanyId: holding.id, name: clinicSeed.name },
    })

    // One clinic-level admin per clinic: branchless, attached to the clinic
    // directly, and deliberately given no holdingCompanyId (its company is
    // reached through its clinic — see lib/permissions/ability.ts). Visayas
    // is the one that matters for demos: with two branches it is the only
    // clinic where "manages both branches, sees neither's patients" is
    // observable at all.
    const clinicAdminEmail = `clinic-admin.${clinicSeed.slug}@familyfirst.example`
    await prisma.user.create({
      data: {
        clinicId: clinic.id,
        name: `${clinicSeed.name} Clinic Admin`,
        email: clinicAdminEmail,
        passwordHash,
        role: Role.CLINIC_ADMIN,
      },
    })
    createdUsers.push({ role: "CLINIC_ADMIN", email: clinicAdminEmail, branch: `(all of ${clinicSeed.name})` })

    for (const b of clinicSeed.branches) {
      // Branch names carry only the location — every admin-facing label
      // renders them as "{clinic} — {branch}", so repeating the clinic name
      // here reads as "Family First Cebu — Family First Cebu – Cebu City".
      const branchLabel = b.city
      const branch = await prisma.branch.create({
        data: {
          clinicId: clinic.id,
          name: branchLabel,
          slug: b.slug,
          address: `123 Placeholder St., ${b.city}`,
          city: b.city,
          phone: "+63 900 000 0001",
          facebookPageUrl: `https://facebook.com/familyfirst.${b.slug}`,
          operatingHours: STANDARD_HOURS,
        },
      })

      const branchAdminEmail = `admin.${b.slug}@familyfirst.example`
      const branchAdmin = await prisma.user.create({
        data: {
          branchId: branch.id,
          name: `${b.city} Branch Admin`,
          email: branchAdminEmail,
          passwordHash,
          role: Role.BRANCH_ADMIN,
        },
      })
      createdUsers.push({ role: "BRANCH_ADMIN", email: branchAdminEmail, branch: branchLabel })

      // current_stock only ever changes through a stock_movements row (§6) —
      // seeding respects that too, rather than setting the field directly,
      // so the ledger-equals-cached-total invariant holds from row one.
      for (const m of MEDICINE_CATALOG) {
        const expiresInDays = DEMO_EXPIRES_IN_DAYS[m.name]
        const medicine = await prisma.medicine.create({
          data: {
            branchId: branch.id,
            name: m.name,
            genericName: m.genericName,
            form: m.form,
            strength: m.strength,
            unit: m.unit,
            currentStock: 0,
            reorderLevel: m.reorderLevel,
            unitCost: m.unitCost,
            sellingPrice: m.sellingPrice,
            expiryDate: expiresInDays === undefined ? null : new Date(Date.now() + expiresInDays * 86_400_000),
          },
        })
        await prisma.stockMovement.create({
          data: {
            branchId: branch.id,
            medicineId: medicine.id,
            movementType: "RECEIPT",
            quantityChange: m.openingStock,
            balanceAfter: m.openingStock,
            reason: "Initial stock (seed)",
            performedByUserId: branchAdmin.id,
          },
        })
        await prisma.medicine.update({ where: { id: medicine.id }, data: { currentStock: m.openingStock } })
      }

      for (let i = 1; i <= 2; i++) {
        const email = `staff${i}.${b.slug}@familyfirst.example`
        await prisma.user.create({
          data: {
            branchId: branch.id,
            name: `${b.city} Front Desk ${i}`,
            email,
            passwordHash,
            role: Role.FRONT_DESK,
          },
        })
        createdUsers.push({ role: "FRONT_DESK", email, branch: branchLabel })
      }

      for (let i = 1; i <= 3; i++) {
        const email = `doctor${i}.${b.slug}@familyfirst.example`
        const doctorUser = await prisma.user.create({
          data: {
            branchId: branch.id,
            name: `Dr. ${b.city} ${i}`,
            email,
            passwordHash,
            role: Role.DOCTOR,
          },
        })
        await prisma.doctor.create({
          data: {
            userId: doctorUser.id,
            branchId: branch.id,
            licenseNumber: `PH-LIC-${b.slug}-${i}`,
            consultationFee: 50000, // ₱500.00
          },
        })
        createdUsers.push({ role: "DOCTOR", email, branch: branchLabel })
      }

      // A couple of demo patients per branch — enough to click through M1's
      // patient screens and demonstrate cross-branch scoping live. Full
      // realistic seed data (60 patients, 6 months of history — §11) builds
      // up incrementally as later milestones land, same approach the prior
      // project in this repo used.
      await prisma.patient.create({
        data: {
          branchId: branch.id,
          firstName: "Maria",
          lastName: "Santos",
          birthdate: new Date("1988-03-14"),
          sex: Sex.FEMALE,
          phone: "+63 917 000 1111",
          address: `45 Sample Ave., ${b.city}`,
          emergencyContactName: "Jose Santos",
          emergencyContactPhone: "+63 917 000 2222",
          consentAt: new Date(),
        },
      })
      await prisma.patient.create({
        data: {
          branchId: branch.id,
          firstName: "Miguel",
          lastName: "Reyes",
          birthdate: new Date("2015-07-02"),
          sex: Sex.MALE,
          phone: "+63 917 000 3333",
          address: `78 Sample Ave., ${b.city}`,
          emergencyContactName: "Ana Reyes",
          emergencyContactPhone: "+63 917 000 4444",
          guardianName: "Ana Reyes",
          guardianPhone: "+63 917 000 4444",
          consentAt: new Date(),
        },
      })
    }
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
