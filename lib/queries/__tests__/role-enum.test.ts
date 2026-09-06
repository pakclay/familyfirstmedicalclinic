import { afterAll, describe, expect, it } from "vitest"
import { superuserPrisma } from "@/lib/test/superuser-prisma"

/**
 * Three list queries order by role (lib/queries/users.ts). Postgres resolves
 * that against pg_enum.enumsortorder — not the generated client's enum, and
 * not alphabetically — so the physical order of the enum is load-bearing
 * for the UI, and a bare `ALTER TYPE ... ADD VALUE` appends. This pins the
 * order the migrations were written to produce, so a future member added
 * without `BEFORE`/`AFTER` fails here rather than quietly sorting clinic
 * admins after holding admins in every user list.
 */
describe("Role enum", () => {
  afterAll(async () => {
    await superuserPrisma.$disconnect()
  })

  it("is sorted in the database in the declared order, least to most privileged", async () => {
    const rows = await superuserPrisma.$queryRaw<{ enumlabel: string }[]>`
      SELECT enumlabel FROM pg_enum
      WHERE enumtypid = 'public."Role"'::regtype
      ORDER BY enumsortorder`
    expect(rows.map((r) => r.enumlabel)).toEqual(["FRONT_DESK", "DOCTOR", "BRANCH_ADMIN", "CLINIC_ADMIN", "HOLDING_ADMIN"])
  })
})
