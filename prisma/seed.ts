import { PrismaClient, Role, Sex, MedicineForm, MedicineUnit } from "@prisma/client"
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

// A starter catalog, not yet §13's full ~30-medicine list with 6 months of
// movement history — that builds up incrementally as later milestones
// (M4b's receiving/counting screens, M6's reports) give it somewhere real
// to be exercised. Two intentionally below reorderLevel, one expiring
// within 30 days, matching §13's seed guidance for what the dashboards
// should have something to show on first run.
const MEDICINE_SEEDS = [
  { name: "Paracetamol", genericName: "Paracetamol", form: MedicineForm.TABLET, strength: "500mg", unit: MedicineUnit.PIECE, stock: 200, reorderLevel: 50, unitCost: 150, sellingPrice: 300 },
  { name: "Amoxicillin", genericName: "Amoxicillin", form: MedicineForm.CAPSULE, strength: "500mg", unit: MedicineUnit.PIECE, stock: 120, reorderLevel: 40, unitCost: 350, sellingPrice: 700 },
  { name: "Mefenamic Acid", genericName: "Mefenamic Acid", form: MedicineForm.TABLET, strength: "500mg", unit: MedicineUnit.PIECE, stock: 30, reorderLevel: 40, unitCost: 200, sellingPrice: 400 }, // below reorder
  { name: "Cetirizine", genericName: "Cetirizine", form: MedicineForm.TABLET, strength: "10mg", unit: MedicineUnit.PIECE, stock: 90, reorderLevel: 30, unitCost: 180, sellingPrice: 350 },
  { name: "Salbutamol Syrup", genericName: "Salbutamol", form: MedicineForm.SYRUP, strength: "2mg/5mL", unit: MedicineUnit.BOTTLE, stock: 15, reorderLevel: 20, unitCost: 8000, sellingPrice: 15000 }, // below reorder
  { name: "Oral Rehydration Salts", genericName: "ORS", form: MedicineForm.OTHER, strength: "20.5g", unit: MedicineUnit.SACHET, stock: 100, reorderLevel: 30, unitCost: 1500, sellingPrice: 2500 },
  { name: "Amlodipine", genericName: "Amlodipine", form: MedicineForm.TABLET, strength: "5mg", unit: MedicineUnit.PIECE, stock: 60, reorderLevel: 20, unitCost: 250, sellingPrice: 500 },
  { name: "Povidone Iodine", genericName: "Povidone-Iodine", form: MedicineForm.OINTMENT, strength: "10%", unit: MedicineUnit.BOTTLE, stock: 25, reorderLevel: 10, unitCost: 4000, sellingPrice: 7500, expiresInDays: 25 }, // expiring soon
] as const

// Placeholder locations — no real branch list supplied yet (SPEC.md §13.5).
// Swap for the real clinic/branch names/addresses/Facebook pages when
// available. Cebu deliberately gets 2 branches (not 1, like the other two
// clinics) so the seed actually exercises the thing this hierarchy exists
// for: two branches *under the same clinic* that must not see each other's
// patients/queue/money — a stronger boundary test than cross-clinic alone,
// which every other seeded pair already covers. Going from 3 locations to 4
// keeps this from tripling the seed volume the way giving every clinic 2
// branches would.
const CLINIC_SEEDS = [
  {
    name: "Family First Medical Clinic – Quezon City",
    branches: [{ slug: "quezon-city", city: "Quezon City" }],
  },
  {
    name: "Family First Medical Clinic – Makati",
    branches: [{ slug: "makati", city: "Makati" }],
  },
  {
    name: "Family First Medical Clinic – Cebu",
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

      const clinicAdminEmail = `admin.${b.slug}@familyfirst.example`
      const clinicAdmin = await prisma.user.create({
        data: {
          branchId: branch.id,
          name: `${b.city} Clinic Admin`,
          email: clinicAdminEmail,
          passwordHash,
          role: Role.CLINIC_ADMIN,
        },
      })
      createdUsers.push({ role: "CLINIC_ADMIN", email: clinicAdminEmail, branch: branchLabel })

      // current_stock only ever changes through a stock_movements row (§6) —
      // seeding respects that too, rather than setting the field directly,
      // so the ledger-equals-cached-total invariant holds from row one.
      for (const m of MEDICINE_SEEDS) {
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
            expiryDate: "expiresInDays" in m ? new Date(Date.now() + m.expiresInDays * 86_400_000) : null,
          },
        })
        await prisma.stockMovement.create({
          data: {
            branchId: branch.id,
            medicineId: medicine.id,
            movementType: "RECEIPT",
            quantityChange: m.stock,
            balanceAfter: m.stock,
            reason: "Initial stock (seed)",
            performedByUserId: clinicAdmin.id,
          },
        })
        await prisma.medicine.update({ where: { id: medicine.id }, data: { currentStock: m.stock } })
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
