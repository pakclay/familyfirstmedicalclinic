import { describe, expect, it } from "vitest"
import { firstParam } from "@/lib/utils/search-params"

describe("firstParam", () => {
  it("passes a single value through untouched", () => {
    expect(firstParam("cebu")).toBe("cebu")
    expect(firstParam("")).toBe("")
  })

  it("is absent when the key is absent", () => {
    expect(firstParam(undefined)).toBeUndefined()
  })

  it("takes the first of a repeated key, like URLSearchParams.get", () => {
    expect(firstParam(["makati", "cebu"])).toBe("makati")
    expect(new URLSearchParams("q=makati&q=cebu").get("q")).toBe("makati")
  })

  it("treats an empty array as absent rather than returning a non-string", () => {
    expect(firstParam([])).toBeUndefined()
  })

  it("never returns an array — the property every caller relies on", () => {
    for (const v of [undefined, "", "x", [], ["a"], ["a", "b"]] as const) {
      const out = firstParam(v as string | string[] | undefined)
      expect(Array.isArray(out)).toBe(false)
    }
  })
})
