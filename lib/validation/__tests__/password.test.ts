import { describe, expect, it } from "vitest"
import { changePasswordSchema } from "@/lib/validation/password"

const base = {
  currentPassword: "whatever",
  newPassword: "GoodPass123",
  confirmPassword: "GoodPass123",
}

describe("changePasswordSchema", () => {
  it("accepts a password with a letter, a number, and 10+ characters", () => {
    expect(changePasswordSchema.safeParse(base).success).toBe(true)
  })

  it("rejects a password under 10 characters", () => {
    const result = changePasswordSchema.safeParse({ ...base, newPassword: "Ab1", confirmPassword: "Ab1" })
    expect(result.success).toBe(false)
  })

  it("rejects a password with no letters", () => {
    const result = changePasswordSchema.safeParse({
      ...base,
      newPassword: "1234567890",
      confirmPassword: "1234567890",
    })
    expect(result.success).toBe(false)
  })

  it("rejects a password with no numbers", () => {
    const result = changePasswordSchema.safeParse({
      ...base,
      newPassword: "OnlyLettersHere",
      confirmPassword: "OnlyLettersHere",
    })
    expect(result.success).toBe(false)
  })

  it("rejects a mismatched confirmation", () => {
    const result = changePasswordSchema.safeParse({ ...base, confirmPassword: "SomethingElse123" })
    expect(result.success).toBe(false)
  })

  it("rejects an empty current password", () => {
    const result = changePasswordSchema.safeParse({ ...base, currentPassword: "" })
    expect(result.success).toBe(false)
  })
})
