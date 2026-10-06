import { describe, expect, it } from "vitest"
import { computeWordDiff, getDiffStats } from "../../src/utils/diff"

describe("computeWordDiff", () => {
  it("returns an empty diff for two empty strings", () => {
    expect(computeWordDiff("", "")).toEqual([])
  })

  it("marks identical text as unchanged", () => {
    expect(computeWordDiff("olá mundo", "olá mundo")).toEqual([
      { type: "unchanged", value: "olá mundo" }
    ])
  })

  it("handles empty original / updated", () => {
    expect(computeWordDiff("", "novo")).toEqual([{ type: "added", value: "novo" }])
    expect(computeWordDiff("velho", "")).toEqual([{ type: "removed", value: "velho" }])
  })

  it("detects a single replaced word", () => {
    const parts = computeWordDiff("Eu vai para casa", "Eu vou para casa")
    expect(parts).toEqual([
      { type: "unchanged", value: "Eu " },
      { type: "removed", value: "vai" },
      { type: "added", value: "vou" },
      { type: "unchanged", value: " para casa" }
    ])
  })

  it("rebuilds both sides from the diff parts", () => {
    const original = "Ontem nois fumo no cinema"
    const updated = "Ontem nós fomos ao cinema"
    const parts = computeWordDiff(original, updated)
    const join = (skip: string) => parts.filter((p) => p.type !== skip).map((p) => p.value).join("")
    expect(join("added")).toBe(original)
    expect(join("removed")).toBe(updated)
  })

  it("falls back to a full replace for very large inputs", () => {
    const big = "a ".repeat(1500)
    const other = "b ".repeat(1500)
    expect(computeWordDiff(big, other)).toEqual([
      { type: "removed", value: big },
      { type: "added", value: other }
    ])
  })
})

describe("getDiffStats", () => {
  it("counts added and removed words", () => {
    const parts = computeWordDiff("um dois três", "um quatro cinco três")
    expect(getDiffStats(parts)).toEqual({ additions: 2, deletions: 1 })
  })
})
