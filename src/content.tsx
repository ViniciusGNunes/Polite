import cssText from "data-text:~/style.css"
import type { PlasmoCSConfig, PlasmoGetStyle } from "plasmo"
import { Storage } from "@plasmohq/storage"
import { useEffect, useState, useRef, useCallback, useMemo } from "react"
import { 
  Copy, 
  Check, 
  Replace, 
  X, 
  Loader2, 
  GripVertical,
  Split,
  AlignLeft,
  Zap,
  Globe
} from "lucide-react"
import { computeWordDiff, getDiffStats, type DiffPart } from "./utils/diff"
import { SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE } from "./utils/languages"

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"]
}

export const getStyle: PlasmoGetStyle = () => {
  const style = document.createElement("style")
  style.textContent = cssText
  return style
}

interface SelectionState {
  text: string
  rect: {
    top: number
    bottom: number
    left: number
    right: number
  }
  isInput: boolean
  inputEl?: HTMLInputElement | HTMLTextAreaElement
  start?: number
  end?: number
  range?: Range
}

const ACTION_MODES = [
  { id: "fix", label: "Corrigir", icon: Zap },
  { id: "translate", label: "Traduzir", icon: Globe }
]

function detectActiveSelection(allowInputFallback = false): SelectionState | null {
  // 1. Check if active element is an input or textarea
  const activeEl = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null
  if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA")) {
    const start = activeEl.selectionStart
    const end = activeEl.selectionEnd
    if (typeof start === "number" && typeof end === "number" && end - start >= 2) {
      const text = activeEl.value.substring(start, end).trim()
      if (text.length >= 2) {
        const rect = activeEl.getBoundingClientRect()
        return {
          text,
          rect: {
            top: rect.top,
            bottom: rect.bottom,
            left: rect.left,
            right: rect.right
          },
          isInput: true,
          inputEl: activeEl,
          start,
          end
        }
      }
    } else if (allowInputFallback && activeEl.value && activeEl.value.trim().length >= 2) {
      // If user presses Alt+C while focused on input/textarea without active highlight
      const text = activeEl.value.trim()
      const rect = activeEl.getBoundingClientRect()
      return {
        text,
        rect: {
          top: rect.top,
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right
        },
        isInput: true,
        inputEl: activeEl,
        start: 0,
        end: activeEl.value.length
      }
    }
  }

  // 2. Check window.getSelection for standard text / contenteditable
  const winSel = window.getSelection()
  if (winSel && winSel.rangeCount > 0) {
    const text = winSel.toString().trim()
    if (text.length >= 2) {
      const range = winSel.getRangeAt(0)
      const rect = range.getBoundingClientRect()
      const fallbackRect = (rect.width > 0 || rect.height > 0)
        ? rect
        : (range.getClientRects()[0] || {
            top: window.innerHeight / 2,
            bottom: window.innerHeight / 2 + 30,
            left: window.innerWidth / 2,
            right: window.innerWidth / 2 + 100
          })

      return {
        text,
        rect: {
          top: fallbackRect.top,
          bottom: fallbackRect.bottom,
          left: fallbackRect.left,
          right: fallbackRect.right
        },
        isInput: false,
        range: range.cloneRange()
      }
    }
  }

  return null
}

export default function ContentUI() {
  const [selection, setSelection] = useState<SelectionState | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [correctedText, setCorrectedText] = useState("")
  const [error, setError] = useState("")
  const [copied, setCopied] = useState(false)

  // Mode and view tabs
  const [activeMode, setActiveMode] = useState("fix")
  const [activeTab, setActiveTab] = useState<"result" | "diff">("result")
  const [targetLanguage, setTargetLanguage] = useState(DEFAULT_LANGUAGE)
  const targetLanguageRef = useRef(targetLanguage)
  targetLanguageRef.current = targetLanguage

  // Blacklist state
  const [isBlacklisted, setIsBlacklisted] = useState(false)
  
  // Dragging state for the suggestion window
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const isDraggingRef = useRef(false)
  
  const popoverRef = useRef<HTMLDivElement>(null)
  const isOpenRef = useRef(isOpen)
  isOpenRef.current = isOpen
  const selectionRef = useRef(selection)
  selectionRef.current = selection

  // Check blacklisted domains and load preferred translation language on mount
  useEffect(() => {
    const storage = new Storage()
    storage.get("ignored_domains").then((raw) => {
      if (raw) {
        let domains: string[] = []
        try {
          domains = typeof raw === "string" ? JSON.parse(raw) : raw
        } catch {}
        const currentHost = window.location.hostname.toLowerCase()
        if (domains.some((d) => d && currentHost.includes(d.toLowerCase().trim()))) {
          setIsBlacklisted(true)
        }
      }
    })

    storage.get("translation_target_lang").then((savedLang) => {
      if (savedLang && typeof savedLang === "string") {
        setTargetLanguage(savedLang)
      }
    })
  }, [])

  const checkSelection = useCallback(() => {
    if (isBlacklisted) return
    if (isOpenRef.current) return

    const sel = detectActiveSelection(false)
    setSelection(sel)
  }, [isBlacklisted])

  // Mouse/selection listeners
  useEffect(() => {
    if (isBlacklisted) return
    let timeoutId: ReturnType<typeof setTimeout>

    const handleEvent = (e: Event) => {
      if (popoverRef.current && (e as MouseEvent).composedPath?.().includes(popoverRef.current)) {
        return
      }

      clearTimeout(timeoutId)
      timeoutId = setTimeout(() => {
        checkSelection()
      }, 70)
    }

    const handleMouseDown = (e: MouseEvent) => {
      if (isDraggingRef.current) return
      if (popoverRef.current && e.composedPath().includes(popoverRef.current)) {
        return
      }
      if (isOpenRef.current) {
        handleClose()
      }
    }

    document.addEventListener("mouseup", handleEvent, true)
    document.addEventListener("keyup", handleEvent, true)
    document.addEventListener("mousedown", handleMouseDown, true)

    return () => {
      clearTimeout(timeoutId)
      document.removeEventListener("mouseup", handleEvent, true)
      document.removeEventListener("keyup", handleEvent, true)
      document.removeEventListener("mousedown", handleMouseDown, true)
    }
  }, [checkSelection, isBlacklisted])

  // Process text with chosen mode
  const executeProcessing = async (textToProcess: string, modeToUse: string, langToUse?: string) => {
    if (!textToProcess) return

    setIsOpen(true)
    setLoading(true)
    setError("")
    setActiveMode(modeToUse)

    const chosenLang = langToUse || targetLanguageRef.current || DEFAULT_LANGUAGE

    try {
      const response = await chrome.runtime.sendMessage({
        action: "fix_grammar",
        text: textToProcess,
        mode: modeToUse,
        targetLang: modeToUse === "translate" ? chosenLang : undefined
      })

      if (response.error) {
        setError(response.error)
      } else {
        setCorrectedText(response.correctedText)
      }
    } catch (err: any) {
      setError(err?.message || "Erro ao comunicar com a extensão. Verifique sua API Key nas Configurações.")
    } finally {
      setLoading(false)
    }
  }

  const triggerFix = useCallback((explicitSel?: SelectionState) => {
    if (isBlacklisted) return

    const targetSel = explicitSel || detectActiveSelection(true) || selectionRef.current
    if (!targetSel || !targetSel.text || targetSel.text.trim().length < 2) {
      return
    }

    setSelection(targetSel)
    executeProcessing(targetSel.text.trim(), "fix")
  }, [isBlacklisted])

  // 1. Direct in-page keyboard shortcut listener for Alt + C (capture phase for maximum reliability)
  useEffect(() => {
    if (isBlacklisted) return

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.code === "KeyC" || e.key?.toLowerCase() === "c")) {
        if (isOpenRef.current) return
        
        const sel = detectActiveSelection(true) || selectionRef.current
        if (sel && sel.text && sel.text.trim().length >= 2) {
          e.preventDefault()
          e.stopPropagation()
          triggerFix(sel)
        }
      }
    }

    window.addEventListener("keydown", handleGlobalKeyDown, true)
    return () => window.removeEventListener("keydown", handleGlobalKeyDown, true)
  }, [triggerFix, isBlacklisted])

  // 2. Handle message from global extension shortcut (Alt + C via chrome.commands)
  useEffect(() => {
    if (isBlacklisted) return

    const handleRuntimeMessage = (msg: any) => {
      if (msg.action === "trigger_fix_from_shortcut") {
        triggerFix()
      }
    }

    chrome.runtime.onMessage.addListener(handleRuntimeMessage)
    return () => chrome.runtime.onMessage.removeListener(handleRuntimeMessage)
  }, [triggerFix, isBlacklisted])

  // Keyboard shortcut listener inside modal (Enter to Replace, Esc to Close)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpenRef.current) return
      if (e.key === "Escape") {
        e.preventDefault()
        handleClose()
      } else if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const activeTag = document.activeElement?.tagName
        if (activeTag !== "INPUT" && activeTag !== "TEXTAREA") {
          e.preventDefault()
          handleReplace()
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [correctedText, selection])

  // Dragging logic
  const handleStartDrag = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()

    const startMouseX = e.clientX
    const startMouseY = e.clientY
    const startPosX = dragPos ? dragPos.x : leftPos
    const startPosY = dragPos ? dragPos.y : topPos

    isDraggingRef.current = true
    setIsDragging(true)

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startMouseX
      const deltaY = moveEvent.clientY - startMouseY

      const modalWidth = 380
      const modalHeight = 260
      const newX = Math.max(10, Math.min(window.innerWidth - modalWidth - 10, startPosX + deltaX))
      const newY = Math.max(10, Math.min(window.innerHeight - modalHeight - 10, startPosY + deltaY))

      setDragPos({ x: newX, y: newY })
    }

    const handleMouseUp = () => {
      isDraggingRef.current = false
      setIsDragging(false)
      window.removeEventListener("mousemove", handleMouseMove, true)
      window.removeEventListener("mouseup", handleMouseUp, true)
    }

    window.addEventListener("mousemove", handleMouseMove, true)
    window.addEventListener("mouseup", handleMouseUp, true)
  }

  const handleClose = (e?: React.MouseEvent) => {
    e?.preventDefault()
    e?.stopPropagation()
    setIsOpen(false)
    setSelection(null)
    setDragPos(null)
    setActiveTab("result")
  }

  const handleCopy = (e?: React.MouseEvent) => {
    e?.preventDefault()
    e?.stopPropagation()
    navigator.clipboard.writeText(correctedText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleReplace = (e?: React.MouseEvent) => {
    e?.preventDefault()
    e?.stopPropagation()

    if (selection?.isInput && selection.inputEl) {
      const el = selection.inputEl
      const start = selection.start ?? el.selectionStart ?? 0
      const end = selection.end ?? el.selectionEnd ?? 0
      
      const before = el.value.substring(0, start)
      const after = el.value.substring(end)
      
      el.value = before + correctedText + after
      
      const newCursorPos = start + correctedText.length
      el.setSelectionRange(newCursorPos, newCursorPos)
      
      el.dispatchEvent(new Event("input", { bubbles: true }))
      el.dispatchEvent(new Event("change", { bubbles: true }))
      el.focus()
    } else if (selection?.range) {
      let replaced = false
      const range = selection.range
      const sel = window.getSelection()

      // 1. Restore the user's selection in the document
      if (sel) {
        sel.removeAllRanges()
        sel.addRange(range)
      }

      // 2. Identify and focus the closest contenteditable / rich editor container
      const commonAncestor = range.commonAncestorContainer
      const containerEl = commonAncestor
        ? (commonAncestor.nodeType === Node.ELEMENT_NODE ? (commonAncestor as HTMLElement) : commonAncestor.parentElement)
        : null
      const editableRoot = containerEl?.closest('[contenteditable="true"], [role="textbox"]') as HTMLElement | null

      if (editableRoot) {
        editableRoot.focus()
      }

      // 3. Try browser native insertText (best for rich text editors with undo history)
      try {
        replaced = document.execCommand("insertText", false, correctedText)
      } catch (err) {
        replaced = false
      }

      // 4. If execCommand was not handled or failed, replace directly via DOM Range
      if (!replaced) {
        try {
          range.deleteContents()
          const textNode = document.createTextNode(correctedText)
          range.insertNode(textNode)

          // Position cursor right after the replacement
          const newRange = document.createRange()
          newRange.setStartAfter(textNode)
          newRange.setEndAfter(textNode)
          sel?.removeAllRanges()
          sel?.addRange(newRange)

          // Dispatch input event to notify rich text frameworks (Notion, TipTap, Lexical, DraftJS, Slate)
          const inputEvt = new InputEvent("input", {
            bubbles: true,
            cancelable: true,
            inputType: "insertText",
            data: correctedText
          })
          textNode.parentElement?.dispatchEvent(inputEvt)
          editableRoot?.dispatchEvent(inputEvt)
          editableRoot?.dispatchEvent(new Event("change", { bubbles: true }))

          replaced = true
        } catch (domErr) {
          replaced = false
        }
      }

      if (!replaced) {
        handleCopy()
        alert("Texto copiado para a área de transferência! Cole no campo com Ctrl+V.")
      }
    } else {
      handleCopy()
    }

    handleClose()
  }

  // Word diff calculations
  const diffParts = useMemo<DiffPart[]>(() => {
    if (!selection?.text || !correctedText) return []
    return computeWordDiff(selection.text, correctedText)
  }, [selection?.text, correctedText])

  const diffStats = useMemo(() => {
    return getDiffStats(diffParts)
  }, [diffParts])

  if (isBlacklisted || !selection) return null

  // Safely compute popup viewport positioning
  const popoverWidth = isOpen ? 380 : 160
  const topPos = Math.min(window.innerHeight - (isOpen ? 280 : 50), Math.max(10, selection.rect.bottom + 8))
  const leftPos = Math.min(window.innerWidth - popoverWidth - 10, Math.max(10, selection.rect.left))

  const currentLeft = isOpen && dragPos ? dragPos.x : leftPos
  const currentTop = isOpen && dragPos ? dragPos.y : topPos

  return (
    <div 
      ref={popoverRef}
      style={{ 
        position: "fixed", 
        top: `${currentTop}px`, 
        left: `${currentLeft}px`,
        zIndex: 2147483647,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
        userSelect: isDragging ? "none" : "auto"
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {!isOpen ? (
        <button
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            executeProcessing(selection.text, "fix")
          }}
          title="Atalho: Alt + C"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            backgroundColor: "#1677ff",
            color: "#ffffff",
            border: "none",
            borderRadius: "6px",
            padding: "6px 14px",
            fontSize: "13px",
            fontWeight: 500,
            cursor: "pointer",
            boxShadow: "0 2px 0 rgba(5, 145, 255, 0.1), 0 4px 12px rgba(22, 119, 255, 0.35)",
            transition: "all 0.2s cubic-bezier(0.645, 0.045, 0.355, 1)"
          }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#4096ff")}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#1677ff")}
        >
          <span>Corrigir com IA</span>
          <span style={{ fontSize: "11px", opacity: 0.8, backgroundColor: "rgba(255,255,255,0.2)", padding: "1px 5px", borderRadius: "4px" }}>
            Alt+C
          </span>
        </button>
      ) : (
        <div 
          style={{
            width: "380px",
            backgroundColor: "#1f1f1f",
            border: isDragging ? "1px solid #1677ff" : "1px solid #303030",
            borderRadius: "8px",
            boxShadow: isDragging ? "0 14px 36px rgba(0, 0, 0, 0.9), 0 0 0 2px rgba(22, 119, 255, 0.25)" : "0 10px 28px rgba(0, 0, 0, 0.75)",
            overflow: "hidden",
            transition: isDragging ? "none" : "border-color 0.2s, box-shadow 0.2s"
          }}
        >
          {/* Draggable Header */}
          <div 
            onMouseDown={handleStartDrag}
            title="Clique e arraste para mover"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "9px 12px",
              borderBottom: "1px solid #303030",
              backgroundColor: isDragging ? "#2a2a2a" : "#262626",
              cursor: isDragging ? "grabbing" : "grab",
              userSelect: "none"
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12.5px", fontWeight: 600, color: "#ffffff" }}>
              <GripVertical size={13} style={{ color: isDragging ? "#1677ff" : "#8c8c8c" }} />
              <span>Polite</span>
            </div>
            <button 
              onMouseDown={(e) => e.stopPropagation()}
              onClick={handleClose}
              title="Fechar (Esc)"
              style={{
                background: "transparent",
                border: "none",
                color: "#8c8c8c",
                cursor: "pointer",
                padding: "3px",
                borderRadius: "4px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "color 0.2s"
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#ffffff")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "#8c8c8c")}
            >
              <X size={14} />
            </button>
          </div>

          {/* AI Modes & Translation Language Selector */}
          <div 
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "7px 12px",
              backgroundColor: "#181818",
              borderBottom: "1px solid #2d2d2d",
              gap: "8px"
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              {ACTION_MODES.map((mode) => {
                const Icon = mode.icon
                const isSelected = activeMode === mode.id
                return (
                  <button
                    key={mode.id}
                    disabled={loading}
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      if (selection?.text) {
                        executeProcessing(selection.text, mode.id, targetLanguage)
                      }
                    }}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "5px",
                      backgroundColor: isSelected ? "#1677ff" : "#242424",
                      color: isSelected ? "#ffffff" : "#a6a6a6",
                      border: isSelected ? "1px solid #1677ff" : "1px solid #333333",
                      borderRadius: "5px",
                      padding: "4px 10px",
                      fontSize: "11.5px",
                      fontWeight: 500,
                      cursor: loading ? "not-allowed" : "pointer",
                      whiteSpace: "nowrap",
                      transition: "all 0.15s"
                    }}
                  >
                    <Icon size={12} />
                    <span>{mode.label}</span>
                  </button>
                )
              })}
            </div>

            {/* Language Selector */}
            <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
              <span style={{ fontSize: "11px", color: activeMode === "translate" ? "#91caff" : "#8c8c8c", fontWeight: 500 }}>
                Para:
              </span>
              <select
                value={targetLanguage}
                disabled={loading}
                onChange={(e) => {
                  const newLang = e.target.value
                  setTargetLanguage(newLang)
                  const storage = new Storage()
                  storage.set("translation_target_lang", newLang)
                  if (activeMode === "translate" && selection?.text) {
                    executeProcessing(selection.text, "translate", newLang)
                  }
                }}
                title="Idioma de tradução"
                style={{
                  backgroundColor: activeMode === "translate" ? "#111d2c" : "#222222",
                  color: activeMode === "translate" ? "#69b1ff" : "#d9d9d9",
                  border: activeMode === "translate" ? "1px solid #1677ff" : "1px solid #383838",
                  borderRadius: "5px",
                  padding: "3px 6px",
                  fontSize: "11.5px",
                  fontWeight: 500,
                  outline: "none",
                  cursor: loading ? "not-allowed" : "pointer",
                  transition: "all 0.15s"
                }}
              >
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <option 
                    key={lang.code} 
                    value={lang.promptName}
                    style={{ backgroundColor: "#1f1f1f", color: "#ffffff" }}
                  >
                    {lang.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ padding: "12px 14px" }}>
            {loading ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "22px 0", color: "#8c8c8c" }}>
                <Loader2 size={22} className="animate-spin" style={{ color: "#1677ff", marginBottom: "8px" }} />
                <span style={{ fontSize: "12px" }}>Processando...</span>
              </div>
            ) : error ? (
              <div style={{ fontSize: "12px", color: "#ff4d4f", backgroundColor: "#2a1215", padding: "10px 14px", borderRadius: "6px", border: "1px solid #5c2223" }}>
                {error}
              </div>
            ) : (
              <>
                {/* View Tabs: Result vs Diff */}
                <div style={{ display: "flex", alignItems: "center", marginBottom: "8px", gap: "4px" }}>
                  <button
                    onClick={() => setActiveTab("result")}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                      backgroundColor: activeTab === "result" ? "#262626" : "transparent",
                      color: activeTab === "result" ? "#1677ff" : "#8c8c8c",
                      border: "none",
                      borderRadius: "4px",
                      padding: "3px 8px",
                      fontSize: "11px",
                      fontWeight: 600,
                      cursor: "pointer"
                    }}
                  >
                    <AlignLeft size={12} />
                    Resultado
                  </button>
                  <button
                    onClick={() => setActiveTab("diff")}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                      backgroundColor: activeTab === "diff" ? "#262626" : "transparent",
                      color: activeTab === "diff" ? "#1677ff" : "#8c8c8c",
                      border: "none",
                      borderRadius: "4px",
                      padding: "3px 8px",
                      fontSize: "11px",
                      fontWeight: 600,
                      cursor: "pointer"
                    }}
                  >
                    <Split size={12} />
                    Diff
                    {(diffStats.additions > 0 || diffStats.deletions > 0) && (
                      <span style={{ fontSize: "10px", color: "#52c41a", marginLeft: "2px" }}>
                        +{diffStats.additions}/-{diffStats.deletions}
                      </span>
                    )}
                  </button>
                </div>

                {/* Main Content Area: Result vs Diff */}
                <div 
                  style={{
                    fontSize: "13px",
                    color: "#d9d9d9",
                    maxHeight: "180px",
                    overflowY: "auto",
                    padding: "10px 12px",
                    backgroundColor: "#141414",
                    borderRadius: "6px",
                    lineHeight: "1.6",
                    marginBottom: "12px",
                    border: "1px solid #303030"
                  }}
                >
                  {activeTab === "result" ? (
                    <div>{correctedText}</div>
                  ) : (
                    <div>
                      {diffParts.map((part, idx) => {
                        if (part.type === "added") {
                          return (
                            <span 
                              key={idx} 
                              style={{ 
                                backgroundColor: "rgba(82, 196, 26, 0.2)", 
                                color: "#73d13d", 
                                borderRadius: "2px", 
                                padding: "1px 2px",
                                fontWeight: 500 
                              }}
                            >
                              {part.value}
                            </span>
                          )
                        }
                        if (part.type === "removed") {
                          return (
                            <span 
                              key={idx} 
                              style={{ 
                                backgroundColor: "rgba(255, 77, 79, 0.2)", 
                                color: "#ff7875", 
                                textDecoration: "line-through", 
                                borderRadius: "2px", 
                                padding: "1px 2px",
                                opacity: 0.8
                              }}
                            >
                              {part.value}
                            </span>
                          )
                        }
                        return <span key={idx}>{part.value}</span>
                      })}
                    </div>
                  )}
                </div>

                {/* Actions Footer */}
                <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                  <button
                    onClick={handleCopy}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "5px",
                      backgroundColor: "#262626",
                      border: "1px solid #434343",
                      color: "#d9d9d9",
                      fontSize: "12px",
                      fontWeight: 500,
                      padding: "5px 12px",
                      borderRadius: "6px",
                      cursor: "pointer",
                      transition: "all 0.2s"
                    }}
                  >
                    {copied ? <Check size={12} style={{ color: "#52c41a" }} /> : <Copy size={12} />}
                    {copied ? "Copiado!" : "Copiar"}
                  </button>
                  <button
                    onClick={handleReplace}
                    title="Substituir no campo (Enter)"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      backgroundColor: "#1677ff",
                      border: "none",
                      color: "#ffffff",
                      fontSize: "12px",
                      fontWeight: 500,
                      padding: "5px 14px",
                      borderRadius: "6px",
                      cursor: "pointer",
                      boxShadow: "0 2px 0 rgba(5, 145, 255, 0.15)",
                      transition: "all 0.2s"
                    }}
                  >
                    <Replace size={12} />
                    <span>Substituir</span>
                    <span style={{ fontSize: "10px", opacity: 0.75, backgroundColor: "rgba(0,0,0,0.25)", padding: "1px 4px", borderRadius: "3px" }}>
                      ↵ Enter
                    </span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
