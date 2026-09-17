export interface LanguageOption {
  code: string
  label: string
  promptName: string
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: "en", label: "Inglês", promptName: "Inglês" },
  { code: "es", label: "Espanhol", promptName: "Espanhol" },
  { code: "pt", label: "Português", promptName: "Português (Brasil)" },
  { code: "fr", label: "Francês", promptName: "Francês" },
  { code: "de", label: "Alemão", promptName: "Alemão" },
  { code: "it", label: "Italiano", promptName: "Italiano" },
  { code: "ja", label: "Japonês", promptName: "Japonês" },
  { code: "zh", label: "Chinês", promptName: "Chinês (Mandarim)" },
  { code: "ru", label: "Russo", promptName: "Russo" }
]

export const DEFAULT_LANGUAGE = "Inglês"
