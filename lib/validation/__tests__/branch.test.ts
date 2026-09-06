import { describe, expect, it } from "vitest"
import { branchSettingsSchema } from "@/lib/validation/branch"

const STANDARD_HOURS = {
  mon: { open: "09:00", close: "18:00" },
  tue: { open: "09:00", close: "18:00" },
  wed: { open: "09:00", close: "18:00" },
  thu: { open: "09:00", close: "18:00" },
  fri: { open: "09:00", close: "18:00" },
  sat: null,
  sun: null,
}

const base = {
  address: "1 Test St",
  city: "Test City",
  phone: "0000",
  facebookPageUrl: "",
  operatingHours: STANDARD_HOURS,
}

describe("branchSettingsSchema — calling-board announcement", () => {
  it("accepts a blank template (use the default) and a template with a placeholder", () => {
    expect(branchSettingsSchema.safeParse({ ...base, announcementTemplate: "" }).success).toBe(true)
    expect(branchSettingsSchema.safeParse({ ...base, announcementTemplate: "  " }).success).toBe(true)
    const parsed = branchSettingsSchema.safeParse({ ...base, announcementTemplate: "  Number {number}, {name}.  " })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.announcementTemplate).toBe("Number {number}, {name}.")
  })

  it("refuses a payload that omits the field rather than treating it as cleared", () => {
    expect(branchSettingsSchema.safeParse(base).success).toBe(false)
  })

  it("refuses a misspelt placeholder and a template with none, with the helper's own wording", () => {
    const typo = branchSettingsSchema.safeParse({ ...base, announcementTemplate: "Now serving {nmae}" })
    expect(typo.success).toBe(false)
    if (!typo.success) expect(typo.error.issues[0]?.message).toContain("{nmae} isn't a placeholder")

    const none = branchSettingsSchema.safeParse({ ...base, announcementTemplate: "Please come to the front desk." })
    expect(none.success).toBe(false)
    if (!none.success) expect(none.error.issues[0]?.message).toContain("Include {number} or {name}")
  })
})
