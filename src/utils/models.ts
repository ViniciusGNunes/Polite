export interface RecommendedModel {
  value: string
  title: string
  tagLabel: string
  tagColor: string
  description: string
}

/**
 * Groq model IDs known to be decommissioned. Verify against
 * https://console.groq.com/docs/deprecations before trusting this list;
 * Groq retires models on its own schedule.
 */
export const DEPRECATED_MODELS = [
  "mixtral-8x7b-32768",
  "gemma2-9b-it",
  "llama-3.1-8b-instant",
  "llama-3.3-70b-versatile"
]

export const DEFAULT_FALLBACK_MODEL = "openai/gpt-oss-20b"

/**
 * Ordered list of known-good chat models to fall back to when the
 * user's configured model is unavailable. Kept separate from
 * "whatever the account happens to list first", which can select a
 * non-chat or otherwise unsuitable model.
 */
export const FALLBACK_MODEL_CHAIN = [
  DEFAULT_FALLBACK_MODEL,
  "openai/gpt-oss-120b",
  "llama-3.3-70b-versatile"
]

export const RECOMMENDED_MODELS: RecommendedModel[] = [
  {
    value: "openai/gpt-oss-20b",
    title: "GPT-OSS 20B (OpenAI)",
    tagLabel: "Recomendado / Ultra Rápido",
    tagColor: "green",
    description: "Modelo de produção com alta velocidade e raciocínio nos LPUs da Groq. Substituto oficial para o Llama 8B."
  },
  {
    value: "openai/gpt-oss-120b",
    title: "GPT-OSS 120B (OpenAI)",
    tagLabel: "Mais Inteligente",
    tagColor: "blue",
    description: "Modelo potente para raciocínio profundo, parágrafos complexos e reescritas elaboradas."
  },
  {
    value: "qwen/qwen3.6-27b",
    title: "Qwen 3.6 27B",
    tagLabel: "Multilíngue & Raciocínio",
    tagColor: "purple",
    description: "Excelente consistência sintática, precisão gramatical estrita e vocabulário rico."
  }
]

/**
 * Models that expose their chain-of-thought / reasoning in the
 * response and support the Groq `reasoning_format` parameter to hide it.
 */
export function supportsReasoningFormat(model: string): boolean {
  const lower = model.toLowerCase()
  return lower.includes("qwen") || lower.includes("gpt-oss")
}

export function isKnownModel(model: string): boolean {
  return RECOMMENDED_MODELS.some((m) => m.value === model)
}
