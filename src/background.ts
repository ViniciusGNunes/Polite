import { Storage } from "@plasmohq/storage"
import { DEFAULT_LANGUAGE } from "./utils/languages"

const storage = new Storage()

const DEPRECATED_MODELS = [
  "mixtral-8x7b-32768",
  "gemma2-9b-it",
  "llama-3.1-8b-instant",
  "llama-3.3-70b-versatile"
]

const DEFAULT_FALLBACK_MODEL = "openai/gpt-oss-20b"

// Keyboard Shortcut Command Setup (Alt + C)
chrome.commands.onCommand.addListener(async (command) => {
  if (command === "fix-selection") {
    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) {
      const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
      tab = tabs[0]
    }
    if (tab?.id) {
      try {
        await chrome.tabs.sendMessage(tab.id, {
          action: "trigger_fix_from_shortcut"
        })
      } catch (err) {
        // Tab not responsive or content script not injected yet
      }
    }
  }
})

// Message dispatcher
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "fix_grammar") {
    handleGrammarFix(message.text, message.mode, message.targetLang)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({ error: error.message || "Erro desconhecido ao processar texto." })
      })
    return true // Asynchronous response
  }

  if (message.action === "get_history") {
    getHistory()
      .then((history) => sendResponse({ history }))
      .catch((error) => sendResponse({ error: error.message }))
    return true
  }

  if (message.action === "clear_history") {
    clearHistory()
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ error: error.message }))
    return true
  }

  if (message.action === "test_key") {
    handleTestKey(message.apiKey, message.model)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({ error: error.message || "Erro desconhecido ao testar chave." })
      })
    return true
  }

  if (message.action === "get_models") {
    fetchActiveChatModels(message.apiKey)
      .then((models) => sendResponse({ models }))
      .catch((error) => sendResponse({ error: error.message }))
    return true
  }
})

const SYSTEM_INSTRUCTION_BASE = `Você é um motor automatizado de substituição direta de texto (inline text replacement engine).
O texto que você retornar será inserido DIRETAMENTE no cursor do usuário em seu documento, e-mail ou aplicativo.

REGRAS INVIOLÁVEIS:
1. Retorne ESTRITAMENTE e EXCLUSIVAMENTE o texto final corrigido/traduzido, sem nenhum caractere extra.
2. NUNCA escreva introduções, saudações ou títulos (PROIBIDO escrever "Correção:", "Tradução:", "Aqui está:", etc.).
3. NUNCA forneça explicações, comentários, justificativas gramaticais, listas de erros ou "Raciocínio".
4. NUNCA forneça múltiplas alternativas de frases. Retorne apenas uma única versão definitiva.
5. NUNCA envolva o texto resultante em aspas ou blocos markdown de código, a menos que o texto original já os tivesse.`

function getSystemPrompt(mode?: string, targetLang?: string): string {
  if (mode === "translate" || mode === "translate_en") {
    const lang = targetLang || DEFAULT_LANGUAGE
    return `${SYSTEM_INSTRUCTION_BASE}\nSua tarefa é traduzir o texto fielmente e com alta qualidade para o idioma: ${lang}. Retorne única e exclusivamente o texto traduzido final, natural e fluente, mantendo a pontuação original, sem nenhum comentário ou explicação.`
  }
  return `${SYSTEM_INSTRUCTION_BASE}\nSua tarefa é corrigir a gramática, concordância, ortografia e pontuação mantendo o idioma e a naturalidade da voz do autor.`
}

/**
 * Sanitizes model output, removing accidental prefixes, explanations, or reasoning sections.
 */
function cleanModelOutput(raw: string, originalText: string): string {
  if (!raw) return ""
  let text = raw.trim()

  // 1. Remove reasoning / explanation sections at the end
  const explanationPatterns = [
    /\n*\s*\*{0,2}(?:Raciocínio|Explicaç[oõ]es?|Notas?|Justificativas?|Comentários?|Motivo[s]?|Regras?)(?:\s+e\s+explicaç[oõ]es?)?\*{0,2}\s*:\s*[\s\S]*$/i,
    /\n*\s*1\.\s*\*{0,2}(?:Conjugação|Ortografia|Gramática|Pontuação|Crase|Concordância|Regência|Preposição)[\s\S]*$/i,
    /\n*\s*-\s*\*{0,2}(?:Conjugação|Ortografia|Gramática|Pontuação|Crase|Concordância|Regência|Preposição)[\s\S]*$/i
  ]

  for (const pattern of explanationPatterns) {
    text = text.replace(pattern, "").trim()
  }

  // 2. Remove conversational prefixes
  const prefixPatterns = [
    /^(?:Aqui está|Segue|Segue abaixo)?\s*(?:a\s+)?(?:correção(?:\s+da\s+frase|\s+do\s+texto)?|texto\s+corrigido|versão\s+corrigida|sugestão(?:\s+de\s+correção)?)\s*:\s*/i,
    /^(?:Frase|Texto)\s+corrigid[ao]\s*:\s*/i,
    /^\*{1,2}(?:Correção(?: da frase)?|Texto corrigido|Sugestão)\*{1,2}\s*:\s*/i
  ]

  for (const pattern of prefixPatterns) {
    text = text.replace(pattern, "").trim()
  }

  // 3. If model returned an inline bold primary answer followed by extra commentary/alternatives
  const boldMatch = text.match(/^\*\*([^*]+)\*\*(?:\s+([\s\S]+))?$/)
  if (boldMatch) {
    const boldContent = boldMatch[1].trim()
    const rest = (boldMatch[2] || "").trim()

    if (rest) {
      text = boldContent
    } else if (!originalText.includes("**")) {
      text = boldContent
    }
  }

  // 4. Remove leading/trailing quotes if original didn't have quotes
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith('“') && text.endsWith('”'))) {
    if (!originalText.trim().startsWith('"') && !originalText.trim().startsWith('“')) {
      text = text.slice(1, -1).trim()
    }
  }

  // 5. Final fallback cleanup for codeblocks
  text = text.replace(/^```[a-z]*\n/i, "").replace(/\n```$/i, "").trim()

  return text
}

async function fetchActiveChatModels(apiKeyOverride?: string): Promise<string[]> {
  const apiKey = (apiKeyOverride || (await storage.get("groq_api_key")) || "").toString().trim()
  if (!apiKey) {
    throw new Error("Chave da Groq não informada.")
  }

  const response = await fetch("https://api.groq.com/openai/v1/models", {
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    }
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error?.message || `Erro ${response.status} ao consultar modelos da Groq.`)
  }

  const data = await response.json()
  if (!data.data || !Array.isArray(data.data)) {
    return [DEFAULT_FALLBACK_MODEL]
  }

  const chatModels = data.data
    .map((m: any) => m.id as string)
    .filter((id: string) => {
      const lower = id.toLowerCase()
      if (lower.includes("whisper") || lower.includes("tts") || lower.includes("audio") || lower.includes("embed") || lower.includes("guard")) {
        return false
      }
      return true
    })

  if (chatModels.length > 0) {
    await storage.set("groq_available_models", JSON.stringify(chatModels))
  }

  return chatModels
}

async function handleTestKey(keyInput?: string, modelInput?: string) {
  const apiKey = (keyInput || (await storage.get("groq_api_key")) || "").toString().trim()
  if (!apiKey) {
    throw new Error("Insira uma API Key antes de testar.")
  }

  let model = (modelInput || (await storage.get("groq_model")) || DEFAULT_FALLBACK_MODEL).toString().trim()
  if (DEPRECATED_MODELS.includes(model)) {
    model = DEFAULT_FALLBACK_MODEL
  }

  let response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Ping. Responda 'OK'." }],
      max_tokens: 10
    })
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    const errorMsg = errorData.error?.message || ""

    if (errorMsg.includes("decommissioned") || errorMsg.includes("does not exist") || errorMsg.includes("do not have access")) {
      const activeModels = await fetchActiveChatModels(apiKey).catch(() => [])
      if (activeModels.length > 0) {
        model = activeModels[0]
        await storage.set("groq_model", model)
        response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: "Ping. Responda 'OK'." }],
            max_tokens: 10
          })
        })
      }
    }

    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      throw new Error(err.error?.message || `Erro ${response.status}: Chave inválida ou modelo não suportado.`)
    }
  }

  return { success: true, modelUsed: model }
}

async function saveToHistory(entry: {
  original: string
  corrected: string
  mode: string
  modelUsed: string
}) {
  try {
    let history: any[] = []
    const rawHistory = await storage.get("groq_correction_history")
    if (rawHistory) {
      try {
        history = typeof rawHistory === "string" ? JSON.parse(rawHistory) : (Array.isArray(rawHistory) ? rawHistory : [])
      } catch {
        history = []
      }
    }

    if (history.length === 0 && chrome?.storage?.local) {
      try {
        const local = await chrome.storage.local.get("groq_correction_history")
        if (local?.groq_correction_history) {
          const lRaw = local.groq_correction_history
          history = typeof lRaw === "string" ? JSON.parse(lRaw) : (Array.isArray(lRaw) ? lRaw : [])
        }
      } catch {}
    }

    const newHistoryItem = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      timestamp: Date.now(),
      ...entry
    }

    history = [newHistoryItem, ...history.slice(0, 29)]
    await storage.set("groq_correction_history", history)
    if (chrome?.storage?.local) {
      await chrome.storage.local.set({ groq_correction_history: history })
    }
  } catch (err) {
    console.error("Erro ao salvar no histórico:", err)
  }
}

async function getHistory(): Promise<any[]> {
  try {
    const rawHistory = await storage.get("groq_correction_history")
    if (rawHistory) {
      const parsed = typeof rawHistory === "string" ? JSON.parse(rawHistory) : rawHistory
      if (Array.isArray(parsed)) return parsed
    }
    if (chrome?.storage?.local) {
      const local = await chrome.storage.local.get("groq_correction_history")
      if (local?.groq_correction_history) {
        const parsed = typeof local.groq_correction_history === "string" 
          ? JSON.parse(local.groq_correction_history) 
          : local.groq_correction_history
        if (Array.isArray(parsed)) return parsed
      }
    }
    return []
  } catch {
    return []
  }
}

async function clearHistory(): Promise<void> {
  await storage.set("groq_correction_history", JSON.stringify([]))
}

async function handleGrammarFix(text: string, modeOverride?: string, targetLang?: string) {
  if (!text || !text.trim()) {
    throw new Error("Nenhum texto selecionado para processamento.")
  }

  const [apiKeyRaw, modelRaw] = await Promise.all([
    storage.get("groq_api_key"),
    storage.get("groq_model")
  ])

  const apiKey = (apiKeyRaw || "").toString().trim()
  if (!apiKey) {
    throw new Error("API Key da Groq não configurada. Abra a extensão no navegador e salve sua chave gratuita.")
  }

  let selectedModel = (modelRaw as string) || DEFAULT_FALLBACK_MODEL
  if (DEPRECATED_MODELS.includes(selectedModel)) {
    selectedModel = DEFAULT_FALLBACK_MODEL
    await storage.set("groq_model", DEFAULT_FALLBACK_MODEL)
  }

  const activeMode = modeOverride || "fix"
  const systemPrompt = getSystemPrompt(activeMode, targetLang)

  const sendRequest = async (modelToUse: string) => {
    return fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: modelToUse,
        messages: [
          { role: "system", content: systemPrompt },
          { 
            role: "user", 
            content: `Texto original:\n"""\n${text}\n"""\n\nInstrução: Retorne EXCLUSIVAMENTE o texto final pronto. NUNCA adicione explicações, comentários, raciocínio, nem títulos como "Correção:".` 
          }
        ],
        temperature: activeMode === "shorten" || activeMode === "expand" ? 0.3 : 0.05,
        max_tokens: 1500
      })
    })
  }

  let response: Response
  try {
    response = await sendRequest(selectedModel)
  } catch (netErr: any) {
    throw new Error(`Falha de conexão com a Groq: ${netErr.message || "Verifique sua conexão."}`)
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    const errorMsg = errorData.error?.message || ""

    if (
      errorMsg.includes("decommissioned") ||
      errorMsg.includes("does not exist") ||
      errorMsg.includes("do not have access")
    ) {
      try {
        const activeModels = await fetchActiveChatModels(apiKey)
        if (activeModels.length > 0 && activeModels[0] !== selectedModel) {
          selectedModel = activeModels[0]
          await storage.set("groq_model", selectedModel)
          response = await sendRequest(selectedModel)
        }
      } catch (autoErr) {
        // Fallback
      }
    }

    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      throw new Error(err.error?.message || errorMsg || `Erro ${response.status} na API da Groq.`)
    }
  }

  const data = await response.json()
  if (!data.choices || !data.choices[0] || !data.choices[0].message) {
    throw new Error("Resposta inválida recebida da Groq.")
  }

  const rawOutput = data.choices[0].message.content || ""
  const correctedText = cleanModelOutput(rawOutput, text)

  // Save to history and await to guarantee storage write before service worker freezes
  try {
    await saveToHistory({
      original: text,
      corrected: correctedText,
      mode: activeMode === "translate" || activeMode === "translate_en" 
        ? `Traduzir (${targetLang || DEFAULT_LANGUAGE})` 
        : "Corrigir",
      modelUsed: selectedModel
    })
  } catch (histErr) {
    console.error("Erro ao salvar histórico:", histErr)
  }

  return { 
    correctedText, 
    modelUsed: selectedModel,
    mode: activeMode
  }
}
