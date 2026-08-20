import { describe, expect, it } from "vitest"
import { ABILITY_MATRIX, can, canAccess, type AbilitySubject, type Role } from "../ability"

// Sanity checks on the §4.1 matrix itself. The full "every forbidden read
// 403s" suite (record-level scoping, scopedPrisma, DTOs) is Phase 2 scope —
// this just proves the data is complete and a few load-bearing rules hold.

const ALL_ROLES: Role[] = ["OWNER", "BRANCH_MANAGER", "DOCTOR", "THERAPIST", "FRONT_DESK", "MARKETING"]

function subject(role: Role, overrides: Partial<AbilitySubject> = {}): AbilitySubject {
  return { role, id: "user_1", homeBranchId: "branch_1", ...overrides }
}

describe("ABILITY_MATRIX", () => {
  it("defines a rule for every role on every resource", () => {
    for (const resource of Object.keys(ABILITY_MATRIX) as (keyof typeof ABILITY_MATRIX)[]) {
      for (const role of ALL_ROLES) {
        expect(ABILITY_MATRIX[resource][role]).toBeDefined()
      }
    }
  })
})

describe("can() — hard rules from §4.2", () => {
  it("MARKETING never touches clinical or payments data", () => {
    const marketing = subject("MARKETING")
    expect(canAccess(marketing, "soapNotes", "read")).toBe(false)
    expect(canAccess(marketing, "prescription", "read")).toBe(false)
    expect(canAccess(marketing, "payments", "read")).toBe(false)
    expect(canAccess(marketing, "patientDemographics", "read")).toBe(false)
  })

  it("THERAPIST payout reads are scoped to their own rows only", () => {
    const therapist = subject("THERAPIST", { id: "therapist_1" })
    expect(can(therapist, "read", "payoutResults", { therapistId: "therapist_1" })).toBe(true)
    expect(can(therapist, "read", "payoutResults", { therapistId: "therapist_2" })).toBe(false)
  })

  it("only OWNER can approve a payout", () => {
    for (const role of ALL_ROLES) {
      const expected = role === "OWNER"
      expect(can(subject(role), "approve", "payoutResults")).toBe(expected)
    }
  })

  it("BRANCH_MANAGER payment reads are scoped to their home branch", () => {
    const manager = subject("BRANCH_MANAGER", { homeBranchId: "branch_1" })
    expect(can(manager, "read", "payments", { branchId: "branch_1" })).toBe(true)
    expect(can(manager, "read", "payments", { branchId: "branch_2" })).toBe(false)
  })

  it("FRONT_DESK can record a payment but never read payment reports", () => {
    const frontDesk = subject("FRONT_DESK")
    expect(canAccess(frontDesk, "payments", "write")).toBe(true)
    expect(canAccess(frontDesk, "payments", "read")).toBe(false)
  })

  it("only OWNER can manage user accounts", () => {
    for (const role of ALL_ROLES) {
      const expected = role === "OWNER"
      expect(canAccess(subject(role), "usersAccess", "write")).toBe(expected)
    }
  })
})
