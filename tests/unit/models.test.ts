import { describe, expect, it } from "vitest"
import {
  DEFAULT_FALLBACK_MODEL,
  FALLBACK_MODEL_CHAIN,
  isChatEligibleModel,
  isKnownModel,
  supportsReasoningFormat
} from "../../src/utils/models"
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES } from "../../src/utils/languages"

describe("models", () => {
  it("starts the fallback chain with the default model", () => {
    expect(FALLBACK_MODEL_CHAIN[0]).toBe(DEFAULT_FALLBACK_MODEL)
  })

  it("detects reasoning-capable models", () => {
    expect(supportsReasoningFormat("openai/gpt-oss-20b")).toBe(true)
    expect(supportsReasoningFormat("qwen/qwen3.6-27b")).toBe(true)
    expect(supportsReasoningFormat("llama-3.3-70b-versatile")).toBe(false)
  })

  it("recognises recommended models", () => {
    expect(isKnownModel("openai/gpt-oss-120b")).toBe(true)
    expect(isKnownModel("some/unknown-model")).toBe(false)
  })

  it.each(["whisper-large-v3", "playai-tts", "llama-guard-4-12b", "nomic-embed-text"])(
    "filters out non-chat model %s",
    (model) => {
      expect(isChatEligibleModel(model)).toBe(false)
    }
  )

  it("keeps regular chat models", () => {
    expect(isChatEligibleModel("openai/gpt-oss-20b")).toBe(true)
  })
})

describe("languages", () => {
  it("has unique language codes", () => {
    const codes = SUPPORTED_LANGUAGES.map((l) => l.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it("uses a default language that is in the list", () => {
    expect(SUPPORTED_LANGUAGES.some((l) => l.promptName === DEFAULT_LANGUAGE)).toBe(true)
  })
})
