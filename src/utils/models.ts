export interface RecommendedModel {
  value: string
  title: string
}

export const DEPRECATED_MODELS = [
  "mixtral-8x7b-32768",
  "gemma2-9b-it",
  "llama-3.1-8b-instant",
  "llama-3.3-70b-versatile"
]

export const DEFAULT_FALLBACK_MODEL = "openai/gpt-oss-20b"

export const FALLBACK_MODEL_CHAIN = [
  DEFAULT_FALLBACK_MODEL,
  "openai/gpt-oss-120b",
  "llama-3.3-70b-versatile"
]

export const RECOMMENDED_MODELS: RecommendedModel[] = [
  { value: "openai/gpt-oss-20b", title: "GPT-OSS 20B (OpenAI)" },
  { value: "openai/gpt-oss-120b", title: "GPT-OSS 120B (OpenAI)" },
  { value: "qwen/qwen3.6-27b", title: "Qwen 3.6 27B" }
]

export function supportsReasoningFormat(model: string): boolean {
  const lower = model.toLowerCase()
  return lower.includes("qwen") || lower.includes("gpt-oss")
}

export function isKnownModel(model: string): boolean {
  return RECOMMENDED_MODELS.some((m) => m.value === model)
}

const EXCLUDED_MODEL_MARKERS = [
  "whisper", "tts", "audio", "embed", "guard", "moderation", "safety",
  "vision", "prompt-guard", "orpheus", "playai", "canopylabs"
]

export function isChatEligibleModel(model: string): boolean {
  const lower = model.toLowerCase()
  return !EXCLUDED_MODEL_MARKERS.some((marker) => lower.includes(marker))
}
