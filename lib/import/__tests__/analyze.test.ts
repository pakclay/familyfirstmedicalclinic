import { describe, expect, it } from "vitest"
import { analyzeRow } from "../analyze"
import { normalizeMobileLenient, parseDateLenient } from "../normalize"
import type { ColumnMapping } from "../target-fields"

const MAPPING: ColumnMapping = {
  firstName: "First",
  lastName: "Last",
  birthDate: "DOB",
  sex: "Sex",
  mobile: "Mobile",
  address: "Address",
  city: "City",
  province: "Province",
}

const VALID_ROW = {
  First: "Juan",
  Last: "Dela Cruz",
  DOB: "03/15/1990",
  Sex: "M",
  Mobile: "0917 123 4567",
  Address: "123 Rizal St.",
  City: "San Fernando",
  Province: "Pampanga",
}

describe("normalizeMobileLenient", () => {
  it("accepts 09XXXXXXXXX as-is", () => {
    expect(normalizeMobileLenient("09171234567")).toBe("09171234567")
  })
  it("normalizes +63 and spaced/dashed variants", () => {
    expect(normalizeMobileLenient("+63 917 123 4567")).toBe("09171234567")
    expect(normalizeMobileLenient("63-917-123-4567")).toBe("09171234567")
    expect(normalizeMobileLenient("917-123-4567")).toBe("09171234567")
  })
  it("rejects garbage", () => {
    expect(normalizeMobileLenient("12345")).toBeNull()
    expect(normalizeMobileLenient("not a number")).toBeNull()
  })
})

describe("parseDateLenient", () => {
  it("parses MDY vs DMY differently for ambiguous dates", () => {
    const mdy = parseDateLenient("03/04/1990", "MDY")
    const dmy = parseDateLenient("03/04/1990", "DMY")
    expect(mdy?.toISOString().slice(0, 10)).toBe("1990-03-04")
    expect(dmy?.toISOString().slice(0, 10)).toBe("1990-04-03")
  })
  it("parses ISO dates regardless of chosen format", () => {
    expect(parseDateLenient("1990-03-04", "DMY")?.toISOString().slice(0, 10)).toBe("1990-03-04")
  })
  it("rejects impossible dates", () => {
    expect(parseDateLenient("13/40/1990", "MDY")).toBeNull()
    expect(parseDateLenient("02/30/1990", "MDY")).toBeNull()
  })
})

describe("analyzeRow", () => {
  it("accepts a clean, fully-mapped row", () => {
    const result = analyzeRow(VALID_ROW, MAPPING, "MDY", 2)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.firstName).toBe("Juan")
      expect(result.data.mobile).toBe("09171234567")
      expect(result.data.birthDate).toBe("1990-03-15")
      expect(result.data.sex).toBe("MALE")
    }
  })

  it("flags every missing required field by row number", () => {
    const result = analyzeRow({}, MAPPING, "MDY", 5)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.rowNumber).toBe(5)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors.some((e) => e.includes("First name"))).toBe(true)
    }
  })

  it("flags an unparseable mobile number without failing silently", () => {
    const result = analyzeRow({ ...VALID_ROW, Mobile: "abc" }, MAPPING, "MDY", 3)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("Mobile"))).toBe(true)
    }
  })

  it("flags an unrecognized sex value", () => {
    const result = analyzeRow({ ...VALID_ROW, Sex: "X" }, MAPPING, "MDY", 4)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("Sex"))).toBe(true)
    }
  })
})
