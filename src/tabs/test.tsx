import React, { useState, useEffect, useRef, useMemo } from "react"
import { Storage } from "@plasmohq/storage"
import { 
  ConfigProvider, 
  Layout, 
  Card, 
  Typography, 
  Input, 
  Button, 
  Space, 
  Alert, 
  Tag, 
  message, 
  Spin,
  theme,
  Segmented
} from "antd"
import { 
  ExperimentOutlined, 
  SettingOutlined, 
  ReloadOutlined, 
  CopyOutlined, 
  ThunderboltFilled,
  CloseOutlined,
  EditOutlined,
  InfoCircleOutlined,
  HolderOutlined,
  BulbOutlined,
  ClockCircleOutlined
} from "@ant-design/icons"
import { computeWordDiff, getDiffStats, type DiffPart } from "../utils/diff"
import { SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE } from "../utils/languages"
import "../style.css"

const { Header, Content } = Layout
const { Title, Text, Paragraph } = Typography

const ACTION_MODES = [
  { id: "fix", label: "Corrigir" },
  { id: "translate", label: "Traduzir" }
]

export default function TestPage() {
  const [simpleInput, setSimpleInput] = useState("Eu vai para a padaria comprar pao amanhã de tarde.")
  const [textareaText, setTextareaText] = useState(
    "Ontem nois fumo no cinema mas o filme tavam muito chato. Agente resolvemos ir enbora antes de acaba porque nois tinha que acordar sedo no outro dia."
  )
  const [editableHtml, setEditableHtml] = useState(
    `<p>Este é um teste de editor de texto rico tipo <b>Notion</b> ou <b>Google Docs</b>.</p><p>Selecione esta frasi com bastanti erroz ortograficos e sintaticos para testar a inteligência artificial da Groq!</p>`
  )

  const [floatingSelection, setFloatingSelection] = useState<{
    text: string
    top: number
    left: number
    isInput: boolean
    inputEl?: HTMLInputElement | HTMLTextAreaElement
    start?: number
    end?: number
    range?: Range
  } | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [correctedText, setCorrectedText] = useState("")
  const [error, setError] = useState("")
  const [copied, setCopied] = useState(false)

  // Mode and view state
  const [activeMode, setActiveMode] = useState("fix")
  const [activeTab, setActiveTab] = useState<"result" | "diff">("result")
  const [targetLanguage, setTargetLanguage] = useState(DEFAULT_LANGUAGE)
  
  // Dragging state for test modal
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const isDraggingRef = useRef(false)
  
  const popoverRef = useRef<HTMLDivElement>(null)
  const [messageApi, contextHolder] = message.useMessage()

  useEffect(() => {
    const storage = new Storage()
    storage.get("translation_target_lang").then((savedLang) => {
      if (savedLang && typeof savedLang === "string") {
        setTargetLanguage(savedLang)
      }
    })
  }, [])

  const detectTestSelection = (allowInputFallback = false) => {
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
            top: Math.min(window.innerHeight - 60, rect.bottom + 8),
            left: Math.min(window.innerWidth - 180, Math.max(10, rect.left)),
            isInput: true,
            inputEl: activeEl,
            start,
            end
          }
        }
      } else if (allowInputFallback && activeEl.value && activeEl.value.trim().length >= 2) {
        const text = activeEl.value.trim()
        const rect = activeEl.getBoundingClientRect()
        return {
          text,
          top: Math.min(window.innerHeight - 60, rect.bottom + 8),
          left: Math.min(window.innerWidth - 180, Math.max(10, rect.left)),
          isInput: true,
          inputEl: activeEl,
          start: 0,
          end: activeEl.value.length
        }
      }
    }

    const winSel = window.getSelection()
    if (winSel && winSel.rangeCount > 0) {
      const text = winSel.toString().trim()
      if (text.length >= 2) {
        const range = winSel.getRangeAt(0)
        const rect = range.getBoundingClientRect()
        if (rect.width > 0 || rect.height > 0) {
          return {
            text,
            top: Math.min(window.innerHeight - 60, rect.bottom + 8),
            left: Math.min(window.innerWidth - 180, Math.max(10, rect.left)),
            isInput: false,
            range: range.cloneRange()
          }
        }
      }
    }

    return null
  }

  useEffect(() => {
    const handleMouseUp = (e: MouseEvent) => {
      if (popoverRef.current && e.composedPath().includes(popoverRef.current)) return

      setTimeout(() => {
        const sel = detectTestSelection(false)
        if (sel) {
          setFloatingSelection(sel)
        } else if (!isOpen) {
          setFloatingSelection(null)
          setDragPos(null)
        }
      }, 60)
    }

    const handleMouseDown = (e: MouseEvent) => {
      if (isDraggingRef.current) return
      if (popoverRef.current && e.composedPath().includes(popoverRef.current)) return
      if (!isOpen) {
        setFloatingSelection(null)
        setDragPos(null)
      }
    }

    document.addEventListener("mouseup", handleMouseUp)
    document.addEventListener("mousedown", handleMouseDown)

    return () => {
      document.removeEventListener("mouseup", handleMouseUp)
      document.removeEventListener("mousedown", handleMouseDown)
    }
  }, [isOpen])

  // Keyboard shortcut listener (Alt+C to Trigger, Enter to Replace, Esc to Close)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.code === "KeyC" || e.key?.toLowerCase() === "c")) {
        if (isOpen) return
        const sel = detectTestSelection(true) || floatingSelection
        if (sel && sel.text && sel.text.trim().length >= 2) {
          e.preventDefault()
          e.stopPropagation()
          handleExecuteFix("fix", sel)
        }
        return
      }

      if (!isOpen) return
      if (e.key === "Escape") {
        e.preventDefault()
        handleClose()
      } else if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        handleReplace()
      }
    }

    window.addEventListener("keydown", handleKeyDown, true)
    return () => window.removeEventListener("keydown", handleKeyDown, true)
  }, [isOpen, floatingSelection, correctedText])

  const handleStartDrag = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()

    const startMouseX = e.clientX
    const startMouseY = e.clientY
    const startPosX = dragPos ? dragPos.x : (floatingSelection ? floatingSelection.left : 10)
    const startPosY = dragPos ? dragPos.y : (floatingSelection ? floatingSelection.top : 10)

    isDraggingRef.current = true
    setIsDragging(true)

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startMouseX
      const deltaY = moveEvent.clientY - startMouseY

      const modalWidth = 400
      const modalHeight = 320
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

  const handleClose = () => {
    setIsOpen(false)
    setFloatingSelection(null)
    setDragPos(null)
    setActiveTab("result")
  }

  const handleExecuteFix = async (modeToUse = "fix", explicitSel?: typeof floatingSelection, langToUse?: string) => {
    const target = explicitSel || floatingSelection
    if (!target) return
    setFloatingSelection(target)
    setIsOpen(true)
    setLoading(true)
    setError("")
    setActiveMode(modeToUse)

    const chosenLang = langToUse || targetLanguage || DEFAULT_LANGUAGE

    try {
      const response = await chrome.runtime.sendMessage({
        action: "fix_grammar",
        text: target.text,
        mode: modeToUse,
        targetLang: modeToUse === "translate" ? chosenLang : undefined
      })

      if (response.error) {
        setError(response.error)
      } else {
        setCorrectedText(response.correctedText)
      }
    } catch (err: any) {
      setError(err?.message || "Erro ao comunicar com a extensão.")
    } finally {
      setLoading(false)
    }
  }

  const handleReplace = () => {
    if (floatingSelection?.isInput && floatingSelection.inputEl) {
      const el = floatingSelection.inputEl
      const start = floatingSelection.start ?? 0
      const end = floatingSelection.end ?? 0
      
      const before = el.value.substring(0, start)
      const after = el.value.substring(end)
      const fullNewText = before + correctedText + after

      if (el.tagName === "INPUT") {
        setSimpleInput(fullNewText)
      } else {
        setTextareaText(fullNewText)
      }
      messageApi.success("Texto substituído no campo!")
    } else if (floatingSelection?.range) {
      const range = floatingSelection.range
      const sel = window.getSelection()
      if (sel) {
        sel.removeAllRanges()
        sel.addRange(range)
      }

      // 1. Try document.execCommand first
      let replaced = false
      try {
        replaced = document.execCommand("insertText", false, correctedText)
      } catch {
        replaced = false
      }

      // 2. Direct DOM Range manipulation if execCommand failed
      if (!replaced) {
        try {
          range.deleteContents()
          const textNode = document.createTextNode(correctedText)
          range.insertNode(textNode)

          const newRange = document.createRange()
          newRange.setStartAfter(textNode)
          newRange.setEndAfter(textNode)
          sel?.removeAllRanges()
          sel?.addRange(newRange)

          const editable = textNode.parentElement?.closest('[contenteditable="true"]') as HTMLElement | null
          if (editable) {
            editable.dispatchEvent(new Event("input", { bubbles: true }))
          }
          replaced = true
        } catch {
          replaced = false
        }
      }

      if (replaced) {
        messageApi.success("Texto substituído no editor rico!")
      } else {
        navigator.clipboard.writeText(correctedText)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
        messageApi.info("Texto copiado para a área de transferência.")
      }
    } else {
      navigator.clipboard.writeText(correctedText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      messageApi.info("Texto copiado para a área de transferência.")
    }
    handleClose()
  }

  const handleReset = () => {
    setSimpleInput("Eu vai para a padaria comprar pao amanhã de tarde.")
    setTextareaText(
      "Ontem nois fumo no cinema mas o filme tavam muito chato. Agente resolvemos ir enbora antes de acaba porque nois tinha que acordar sedo no outro dia."
    )
    setEditableHtml(
      `<p>Este é um teste de editor de texto rico tipo <b>Notion</b> ou <b>Google Docs</b>.</p><p>Selecione esta frasi com bastanti erroz ortograficos e sintaticos para testar a inteligência artificial da Groq!</p>`
    )
    setFloatingSelection(null)
    setIsOpen(false)
    messageApi.info("Textos reiniciados para o padrão original.")
  }

  const openSettings = () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage()
    } else {
      window.open(chrome.runtime.getURL("options.html"))
    }
  }

  // Word diff calculations
  const diffParts = useMemo<DiffPart[]>(() => {
    if (!floatingSelection?.text || !correctedText) return []
    return computeWordDiff(floatingSelection.text, correctedText)
  }, [floatingSelection?.text, correctedText])

  const diffStats = useMemo(() => {
    return getDiffStats(diffParts)
  }, [diffParts])

  const wordCount = correctedText ? correctedText.trim().split(/\s+/).filter(Boolean).length : 0
  const charCount = correctedText ? correctedText.length : 0

  return (
    <ConfigProvider
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: "#1677ff",
          borderRadius: 8,
          colorBgBase: "#141414",
          colorBgContainer: "#1f1f1f",
          colorBgElevated: "#262626",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
        }
      }}
    >
      {contextHolder}
      <Layout style={{ minHeight: "100vh", backgroundColor: "#141414", margin: 0, padding: 0 }}>
        {/* Header */}
        <Header
          style={{
            backgroundColor: "#1f1f1f",
            borderBottom: "1px solid #303030",
            padding: "16px 32px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            height: "auto",
            minHeight: 72,
            lineHeight: "normal"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div 
              style={{ 
                width: 44, 
                height: 44, 
                borderRadius: 10, 
                backgroundColor: "#111d2c", 
                border: "1px solid #113560",
                display: "flex", 
                alignItems: "center", 
                justifyContent: "center" 
              }}
            >
              <ExperimentOutlined style={{ color: "#1677ff", fontSize: 24 }} />
            </div>
            <div>
              <Title level={4} style={{ color: "#ffffff", margin: 0, fontSize: 18, lineHeight: "24px" }}>
                Playground de Testes & Demonstração
              </Title>
              <Text style={{ fontSize: 13, color: "#8c8c8c", display: "block" }}>
                Teste a seleção de texto, diff comparativo, modos rápidos e atalho <Tag color="blue" style={{ fontSize: 10, margin: 0, padding: "0 4px" }}>Alt+C</Tag>
              </Text>
            </div>
          </div>

          <Space size={12}>
            <Button icon={<ReloadOutlined />} onClick={handleReset}>
              Restaurar Textos
            </Button>
            <Button icon={<SettingOutlined />} onClick={openSettings}>
              Configurações
            </Button>
          </Space>
        </Header>

        {/* Content */}
        <Content style={{ padding: "32px", maxWidth: 980, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
          <Space direction="vertical" size={24} style={{ width: "100%" }}>
            
            {/* Instruction banner */}
            <Alert
              message="Como testar os recursos avançados:"
              description={
                <div style={{ fontSize: 13, lineHeight: "20px" }}>
                  1. <b>Selecione</b> qualquer trecho dos textos abaixo.<br/>
                  2. Clique no botão flutuante <b>"Corrigir com IA"</b> ou pressione <Tag color="blue" style={{ margin: "0 2px" }}>Alt + C</Tag>.<br/>
                  3. Experimente alternar entre <b>Resultado</b> e <b>Comparativo (Diff)</b> para ver palavras alteradas.<br/>
                  4. Clique nos chips rápidos (<b>Encurtar, Expandir, Formal, Inglês</b>) ou pressione <Tag color="default" style={{ margin: "0 2px" }}>Enter</Tag> para substituir!
                </div>
              }
              type="info"
              showIcon
              style={{ backgroundColor: "#111d2c", borderColor: "#113560" }}
            />

            {/* Test 1 */}
            <Card
              style={{ backgroundColor: "#1f1f1f", borderColor: "#303030" }}
              bodyStyle={{ padding: "18px 22px" }}
              title={
                <Space size={8}>
                  <Tag color="blue">1</Tag>
                  <span style={{ color: "#ffffff", fontWeight: 600 }}>Campo de Texto Simples (Input)</span>
                </Space>
              }
              extra={<Tag color="default">HTML &lt;input&gt;</Tag>}
            >
              <Input
                value={simpleInput}
                onChange={(e) => setSimpleInput(e.target.value)}
                style={{ height: 42, backgroundColor: "#141414", borderColor: "#303030", fontSize: 14 }}
              />
            </Card>

            {/* Test 2 */}
            <Card
              style={{ backgroundColor: "#1f1f1f", borderColor: "#303030" }}
              bodyStyle={{ padding: "18px 22px" }}
              title={
                <Space size={8}>
                  <Tag color="blue">2</Tag>
                  <span style={{ color: "#ffffff", fontWeight: 600 }}>Área de Texto Longa (Textarea)</span>
                </Space>
              }
              extra={<Tag color="default">HTML &lt;textarea&gt;</Tag>}
            >
              <Input.TextArea
                rows={4}
                value={textareaText}
                onChange={(e) => setTextareaText(e.target.value)}
                style={{ backgroundColor: "#141414", borderColor: "#303030", fontSize: 14, lineHeight: "22px" }}
              />
            </Card>

            {/* Test 3 */}
            <Card
              style={{ backgroundColor: "#1f1f1f", borderColor: "#303030" }}
              bodyStyle={{ padding: "18px 22px" }}
              title={
                <Space size={8}>
                  <Tag color="blue">3</Tag>
                  <span style={{ color: "#ffffff", fontWeight: 600 }}>Editor Rico (Div ContentEditable)</span>
                </Space>
              }
              extra={<Tag color="default">Notion / Google Docs</Tag>}
            >
              <div
                contentEditable
                dangerouslySetInnerHTML={{ __html: editableHtml }}
                style={{
                  border: "1px solid #303030",
                  borderRadius: 6,
                  padding: "12px 16px",
                  minHeight: 100,
                  backgroundColor: "#141414",
                  color: "#d9d9d9",
                  fontSize: 14,
                  lineHeight: "24px",
                  outline: "none"
                }}
              />
            </Card>

          </Space>
        </Content>

        {/* Floating popover inside Test Page (Dark Mode) */}
        {floatingSelection && (
          <div 
            ref={popoverRef}
            style={{ 
              position: "fixed", 
              top: isOpen && dragPos ? dragPos.y : floatingSelection.top, 
              left: isOpen && dragPos ? dragPos.x : floatingSelection.left,
              zIndex: 99999,
              userSelect: isDragging ? "none" : "auto"
            }}
          >
            {!isOpen ? (
              <Button
                type="primary"
                icon={<ThunderboltFilled />}
                onClick={() => handleExecuteFix("fix")}
                style={{
                  height: 36,
                  padding: "0 16px",
                  fontWeight: 500,
                  boxShadow: "0 4px 14px rgba(0, 0, 0, 0.6)"
                }}
              >
                <span>Corrigir com IA</span>
                <span style={{ fontSize: 11, opacity: 0.8, marginLeft: 6 }}>Alt+C</span>
              </Button>
            ) : (
              <Card
                size="small"
                style={{
                  width: 400,
                  backgroundColor: "#1f1f1f",
                  borderColor: isDragging ? "#1677ff" : "#303030",
                  boxShadow: isDragging ? "0 14px 36px rgba(0, 0, 0, 0.9), 0 0 0 2px rgba(22, 119, 255, 0.25)" : "0 10px 28px rgba(0, 0, 0, 0.75)",
                  borderRadius: 8,
                  overflow: "hidden",
                  transition: isDragging ? "none" : "border-color 0.2s, box-shadow 0.2s"
                }}
                headStyle={{
                  cursor: isDragging ? "grabbing" : "grab",
                  userSelect: "none",
                  backgroundColor: isDragging ? "#2a2a2a" : "#262626",
                  borderBottom: "1px solid #303030",
                  padding: "0 14px"
                }}
                onMouseDown={handleStartDrag}
                bodyStyle={{ padding: "14px 16px" }}
                title={
                  <div 
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                    title="Clique e arraste para mover"
                  >
                    <HolderOutlined style={{ color: isDragging ? "#1677ff" : "#8c8c8c", fontSize: 13 }} />
                    <ThunderboltFilled style={{ color: "#1677ff" }} />
                    <span style={{ fontSize: 13, color: "#ffffff" }}>Corretor IA (Groq)</span>
                  </div>
                }
                extra={
                  <Button 
                    type="text" 
                    size="small" 
                    icon={<CloseOutlined />} 
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={handleClose} 
                  />
                }
              >
                <div onMouseDown={(e) => e.stopPropagation()}>
                  {/* Mode Chips & Language Selector */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 8 }}>
                    <div style={{ display: "flex", gap: 6 }}>
                      {ACTION_MODES.map((mode) => (
                        <Button
                          key={mode.id}
                          size="small"
                          type={activeMode === mode.id ? "primary" : "default"}
                          onClick={() => handleExecuteFix(mode.id, undefined, targetLanguage)}
                          loading={loading && activeMode === mode.id}
                          style={{ fontSize: 11, height: 26, padding: "0 10px" }}
                        >
                          {mode.label}
                        </Button>
                      ))}
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <span style={{ fontSize: 11, color: activeMode === "translate" ? "#69b1ff" : "#8c8c8c" }}>
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
                          if (activeMode === "translate" && floatingSelection?.text) {
                            handleExecuteFix("translate", undefined, newLang)
                          }
                        }}
                        style={{
                          backgroundColor: activeMode === "translate" ? "#111d2c" : "#1f1f1f",
                          color: activeMode === "translate" ? "#69b1ff" : "#d9d9d9",
                          border: activeMode === "translate" ? "1px solid #1677ff" : "1px solid #383838",
                          borderRadius: 4,
                          padding: "2px 6px",
                          fontSize: 11,
                          outline: "none",
                          cursor: "pointer"
                        }}
                      >
                        {SUPPORTED_LANGUAGES.map((lang) => (
                          <option key={lang.code} value={lang.promptName} style={{ backgroundColor: "#1f1f1f", color: "#ffffff" }}>
                            {lang.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {loading ? (
                    <div style={{ textAlign: "center", padding: "26px 0" }}>
                      <Spin tip="Processando com a Groq..." />
                    </div>
                  ) : error ? (
                    <Alert type="error" message={error} style={{ fontSize: 12 }} />
                  ) : (
                    <div>
                      {/* Tabs: Result vs Diff */}
                      <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
                        <Segmented
                          size="small"
                          value={activeTab}
                          onChange={(val) => setActiveTab(val as "result" | "diff")}
                          options={[
                            { label: "Resultado", value: "result" },
                            { 
                              label: (
                                <span>
                                  Diff{" "}
                                  {(diffStats.additions > 0 || diffStats.deletions > 0) && (
                                    <span style={{ color: "#52c41a", fontSize: 10 }}>
                                      +{diffStats.additions}/-{diffStats.deletions}
                                    </span>
                                  )}
                                </span>
                              ), 
                              value: "diff" 
                            }
                          ]}
                        />
                      </div>

                      {/* Text box */}
                      <div style={{ 
                        padding: "12px 14px", 
                        backgroundColor: "#141414", 
                        border: "1px solid #303030", 
                        borderRadius: 6, 
                        fontSize: 13, 
                        color: "#d9d9d9", 
                        lineHeight: "20px", 
                        marginBottom: 12, 
                        maxHeight: 180, 
                        overflowY: "auto" 
                      }}>
                        {activeTab === "result" ? (
                          <div>{correctedText}</div>
                        ) : (
                          <div>
                            {diffParts.map((part, idx) => {
                              if (part.type === "added") {
                                return (
                                  <span key={idx} style={{ backgroundColor: "rgba(82, 196, 26, 0.2)", color: "#73d13d", borderRadius: 2, padding: "1px 2px", fontWeight: 500 }}>
                                    {part.value}
                                  </span>
                                )
                              }
                              if (part.type === "removed") {
                                return (
                                  <span key={idx} style={{ backgroundColor: "rgba(255, 77, 79, 0.2)", color: "#ff7875", textDecoration: "line-through", borderRadius: 2, padding: "1px 2px" }}>
                                    {part.value}
                                  </span>
                                )
                              }
                              return <span key={idx}>{part.value}</span>
                            })}
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <Space style={{ width: "100%", justifyContent: "flex-end" }} size={8}>
                        <Button 
                          size="small"
                          icon={<CopyOutlined />} 
                          onClick={() => {
                            navigator.clipboard.writeText(correctedText)
                            messageApi.info("Copiado!")
                          }}
                        >
                          Copiar
                        </Button>
                        <Button 
                          size="small"
                          type="primary" 
                          icon={<EditOutlined />} 
                          onClick={handleReplace}
                        >
                          Substituir (↵ Enter)
                        </Button>
                      </Space>
                    </div>
                  )}
                </div>
              </Card>
            )}
          </div>
        )}
      </Layout>
    </ConfigProvider>
  )
}
