import { describe, expect, it } from "vitest"
import {
  ANNOUNCEMENT_TEMPLATE_MAX_LENGTH,
  DEFAULT_ANNOUNCEMENT_TEMPLATE,
  announcementTemplateProblem,
  renderAnnouncement,
} from "@/lib/utils/announcement"

describe("renderAnnouncement", () => {
  const values = { number: 7, name: "Maria Santos" }

  it("fills both placeholders, as many times as they appear", () => {
    expect(renderAnnouncement("Number {number}. {name}, {name}, number {number}.", values)).toBe(
      "Number 7. Maria Santos, Maria Santos, number 7."
    )
  })

  it("falls back to the default for a branch that never set one, or cleared it", () => {
    const expected = DEFAULT_ANNOUNCEMENT_TEMPLATE.replace("{number}", "7").replace("{name}", "Maria Santos")
    expect(renderAnnouncement(null, values)).toBe(expected)
    expect(renderAnnouncement(undefined, values)).toBe(expected)
    expect(renderAnnouncement("", values)).toBe(expected)
    expect(renderAnnouncement("   ", values)).toBe(expected)
  })

  it("the default itself says the number, the name, and where to go", () => {
    const spoken = renderAnnouncement(null, values)
    expect(spoken).toContain("7")
    expect(spoken).toContain("Maria Santos")
    expect(spoken.toLowerCase()).toContain("front desk")
  })

  it("never throws on a template the validator would have refused — it leaves the unknown placeholder alone", () => {
    expect(renderAnnouncement("Calling {nmae}", values)).toBe("Calling {nmae}")
    expect(renderAnnouncement("Hello there", values)).toBe("Hello there")
  })
})

describe("announcementTemplateProblem", () => {
  it("accepts the default and any template naming at least one placeholder", () => {
    expect(announcementTemplateProblem(DEFAULT_ANNOUNCEMENT_TEMPLATE)).toBeNull()
    expect(announcementTemplateProblem("Number {number} please")).toBeNull()
    expect(announcementTemplateProblem("{name}, the doctor will see you now.")).toBeNull()
  })

  it("refuses a blank template — blank means 'use the default' and is handled before this runs", () => {
    expect(announcementTemplateProblem("")).not.toBeNull()
    expect(announcementTemplateProblem("   ")).not.toBeNull()
  })

  it("refuses a template with no placeholder at all", () => {
    expect(announcementTemplateProblem("Please come to the front desk.")).toMatch(/\{number\} or \{name\}/)
  })

  it("names the misspelt placeholder rather than reading it aloud every call", () => {
    expect(announcementTemplateProblem("Now serving {nmae}")).toBe("{nmae} isn't a placeholder — use {number} and {name}.")
    expect(announcementTemplateProblem("Number {number} {}")).toBe("{} isn't a placeholder — use {number} and {name}.")
  })

  it("caps the length", () => {
    const long = "{number} " + "a".repeat(ANNOUNCEMENT_TEMPLATE_MAX_LENGTH)
    expect(announcementTemplateProblem(long)).toMatch(/under 200 characters/)
    expect(announcementTemplateProblem("{number} " + "a".repeat(ANNOUNCEMENT_TEMPLATE_MAX_LENGTH - 9))).toBeNull()
  })
})
