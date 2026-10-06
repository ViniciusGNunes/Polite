import React, { useState, useEffect, useRef, useMemo } from "react";
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
} from "antd";
import {
  SettingOutlined,
  ReloadOutlined,
  CopyOutlined,
  ThunderboltFilled,
  CloseOutlined,
  EditOutlined,
  HolderOutlined,
} from "@ant-design/icons";
import { computeWordDiff, getDiffStats, type DiffPart } from "../utils/diff";
import { SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE } from "../utils/languages";
import { syncStorage } from "../utils/storage";
import {
  isEditableTextInput,
  replaceInputRange,
  replaceRangeSelection,
  copyToClipboard,
} from "../utils/replace";
import politeLogoUrl from "url:../../assets/icon.png";
import "../styles.scss";

const { Header, Content } = Layout;
const { Title, Text } = Typography;

const ACTION_MODES = [
  { id: "fix", label: "Corrigir" },
  { id: "translate", label: "Traduzir" },
];

function trimRange(
  fullValue: string,
  start: number,
  end: number,
): { text: string; start: number; end: number } {
  const raw = fullValue.substring(start, end);
  const leadingWs = raw.match(/^\s*/)?.[0].length || 0;
  const trailingWs = raw.match(/\s*$/)?.[0].length || 0;
  return {
    text: raw.slice(leadingWs, raw.length - trailingWs),
    start: start + leadingWs,
    end: end - trailingWs,
  };
}

export default function TestPage() {
  const [simpleInput, setSimpleInput] = useState(
    "Eu vai para a padaria comprar pao amanhã de tarde.",
  );
  const [textareaText, setTextareaText] = useState(
    "Ontem nois fumo no cinema mas o filme tavam muito chato. Agente resolvemos ir enbora antes de acaba porque nois tinha que acordar sedo no outro dia.",
  );
  const [editableKey, setEditableKey] = useState(0);
  const [editableHtml, setEditableHtml] = useState(
    `<p>Este é um teste de editor de texto rico tipo <b>Notion</b> ou <b>Google Docs</b>.</p><p>Selecione esta frasi com bastanti erroz ortograficos e sintaticos para testar a inteligência artificial da Groq!</p>`,
  );

  const [floatingSelection, setFloatingSelection] = useState<{
    text: string;
    top: number;
    left: number;
    isInput: boolean;
    inputEl?: HTMLInputElement | HTMLTextAreaElement;
    start?: number;
    end?: number;
    range?: Range;
  } | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [correctedText, setCorrectedText] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const [activeMode, setActiveMode] = useState("fix");
  const [activeTab, setActiveTab] = useState<"result" | "diff">("result");
  const [targetLanguage, setTargetLanguage] = useState(DEFAULT_LANGUAGE);

  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef = useRef(false);

  const popoverRef = useRef<HTMLDivElement>(null);
  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;
  const selectionTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [messageApi, contextHolder] = message.useMessage();
  const requestIdRef = useRef(0);

  useEffect(() => {
    syncStorage.get("translation_target_lang").then((savedLang) => {
      if (savedLang && typeof savedLang === "string") {
        setTargetLanguage(savedLang);
      }
    });
  }, []);

  const detectTestSelection = (allowInputFallback = false) => {
    const activeEl = document.activeElement as
      | HTMLInputElement
      | HTMLTextAreaElement
      | null;
    if (activeEl?.tagName === "INPUT" && !isEditableTextInput(activeEl)) {
      return null;
    }
    if (activeEl && isEditableTextInput(activeEl)) {
      const selStart = activeEl.selectionStart;
      const selEnd = activeEl.selectionEnd;
      if (
        typeof selStart === "number" &&
        typeof selEnd === "number" &&
        selEnd - selStart >= 2
      ) {
        const { text, start, end } = trimRange(
          activeEl.value,
          selStart,
          selEnd,
        );
        if (text.length >= 2) {
          const rect = activeEl.getBoundingClientRect();
          return {
            text,
            top: Math.min(window.innerHeight - 60, rect.bottom + 8),
            left: Math.min(window.innerWidth - 180, Math.max(10, rect.left)),
            isInput: true,
            inputEl: activeEl,
            start,
            end,
          };
        }
      } else if (
        allowInputFallback &&
        activeEl.value &&
        activeEl.value.trim().length >= 2
      ) {
        const { text, start, end } = trimRange(
          activeEl.value,
          0,
          activeEl.value.length,
        );
        const rect = activeEl.getBoundingClientRect();
        return {
          text,
          top: Math.min(window.innerHeight - 60, rect.bottom + 8),
          left: Math.min(window.innerWidth - 180, Math.max(10, rect.left)),
          isInput: true,
          inputEl: activeEl,
          start,
          end,
        };
      }
    }

    const winSel = window.getSelection();
    if (winSel && winSel.rangeCount > 0) {
      const text = winSel.toString().trim();
      if (text.length >= 2) {
        const range = winSel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        if (rect.width > 0 || rect.height > 0) {
          return {
            text,
            top: Math.min(window.innerHeight - 60, rect.bottom + 8),
            left: Math.min(window.innerWidth - 180, Math.max(10, rect.left)),
            isInput: false,
            range: range.cloneRange(),
          };
        }
      }
    }

    return null;
  };

  useEffect(() => {
    const handleMouseUp = (e: MouseEvent) => {
      if (popoverRef.current && e.composedPath().includes(popoverRef.current))
        return;

      clearTimeout(selectionTimerRef.current);
      selectionTimerRef.current = setTimeout(() => {
        if (isOpenRef.current) return;
        const sel = detectTestSelection(false);
        if (sel) {
          setFloatingSelection(sel);
        } else {
          setFloatingSelection(null);
          setDragPos(null);
        }
      }, 60);
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (isDraggingRef.current) return;
      if (popoverRef.current && e.composedPath().includes(popoverRef.current)) {
        // A pending selection check would run after focus moved to the
        // trigger and hide it before the click lands.
        clearTimeout(selectionTimerRef.current);
        return;
      }
      if (!isOpen) {
        setFloatingSelection(null);
        setDragPos(null);
      }
    };

    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("mousedown", handleMouseDown);

    return () => {
      clearTimeout(selectionTimerRef.current);
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("mousedown", handleMouseDown);
    };
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.altKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        (e.code === "KeyC" || e.key?.toLowerCase() === "c")
      ) {
        const sel =
          detectTestSelection(true) || (isOpen ? null : floatingSelection);
        if (sel && sel.text && sel.text.trim().length >= 2) {
          e.preventDefault();
          e.stopPropagation();
          handleExecuteFix("fix", sel);
        }
        return;
      }

      if (!isOpen) return;
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
      } else if (
        e.key === "Enter" &&
        !e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        const activeTag = document.activeElement?.tagName;
        if (
          activeTag !== "INPUT" &&
          activeTag !== "TEXTAREA" &&
          !loading &&
          !error &&
          correctedText
        ) {
          e.preventDefault();
          handleReplace();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isOpen, floatingSelection, correctedText, loading, error]);

  const handleStartDrag = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const startMouseX = e.clientX;
    const startMouseY = e.clientY;
    const startPosX = dragPos
      ? dragPos.x
      : floatingSelection
        ? floatingSelection.left
        : 10;
    const startPosY = dragPos
      ? dragPos.y
      : floatingSelection
        ? floatingSelection.top
        : 10;

    isDraggingRef.current = true;
    setIsDragging(true);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startMouseX;
      const deltaY = moveEvent.clientY - startMouseY;

      const modalWidth = 400;
      const modalHeight = 320;
      const newX = Math.max(
        10,
        Math.min(window.innerWidth - modalWidth - 10, startPosX + deltaX),
      );
      const newY = Math.max(
        10,
        Math.min(window.innerHeight - modalHeight - 10, startPosY + deltaY),
      );

      setDragPos({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      setIsDragging(false);
      window.removeEventListener("mousemove", handleMouseMove, true);
      window.removeEventListener("mouseup", handleMouseUp, true);
    };

    window.addEventListener("mousemove", handleMouseMove, true);
    window.addEventListener("mouseup", handleMouseUp, true);
  };

  const handleClose = () => {
    setIsOpen(false);
    setFloatingSelection(null);
    setDragPos(null);
    setActiveTab("result");
  };

  const handleExecuteFix = async (
    modeToUse = "fix",
    explicitSel?: typeof floatingSelection,
    langToUse?: string,
  ) => {
    const target = explicitSel || floatingSelection;
    if (!target) return;

    const requestId = ++requestIdRef.current;

    setFloatingSelection(target);
    setIsOpen(true);
    setLoading(true);
    setError("");
    setCorrectedText("");
    setActiveMode(modeToUse);

    const chosenLang = langToUse || targetLanguage || DEFAULT_LANGUAGE;

    try {
      const response = await chrome.runtime.sendMessage({
        action: "fix_grammar",
        text: target.text,
        mode: modeToUse,
        targetLang: modeToUse === "translate" ? chosenLang : undefined,
      });

      if (requestIdRef.current !== requestId) return;

      if (response.error) {
        setError(response.error);
      } else {
        setCorrectedText(response.correctedText);
      }
    } catch (err: any) {
      if (requestIdRef.current !== requestId) return;
      setError(err?.message || "Erro ao comunicar com a extensão.");
    } finally {
      if (requestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  };

  const copyFallback = async () => {
    const ok = await copyToClipboard(correctedText);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      messageApi.info("Texto copiado para a área de transferência.");
    } else {
      messageApi.error("Não foi possível copiar. Copie o texto manualmente.");
    }
    return ok;
  };

  const handleReplace = async () => {
    if (floatingSelection?.isInput && floatingSelection.inputEl) {
      const el = floatingSelection.inputEl;
      const start = floatingSelection.start ?? 0;
      const end = floatingSelection.end ?? 0;

      const before = el.value.substring(0, start);
      const after = el.value.substring(end);
      const fullNewText = before + correctedText + after;

      if (el.tagName === "INPUT") {
        setSimpleInput(fullNewText);
      } else {
        setTextareaText(fullNewText);
      }
      messageApi.success("Texto substituído no campo!");
    } else if (floatingSelection?.range) {
      const replaced = replaceRangeSelection(
        floatingSelection.range,
        correctedText,
      );
      if (replaced) {
        messageApi.success("Texto substituído no editor rico!");
      } else {
        const copied = await copyFallback();
        if (!copied) return;
      }
    } else {
      const copied = await copyFallback();
      if (!copied) return;
    }
    handleClose();
  };

  const handleReset = () => {
    setSimpleInput("Eu vai para a padaria comprar pao amanhã de tarde.");
    setTextareaText(
      "Ontem nois fumo no cinema mas o filme tavam muito chato. Agente resolvemos ir enbora antes de acaba porque nois tinha que acordar sedo no outro dia.",
    );
    setEditableHtml(
      `<p>Este é um teste de editor de texto rico tipo <b>Notion</b> ou <b>Google Docs</b>.</p><p>Selecione esta frasi com bastanti erroz ortograficos e sintaticos para testar a inteligência artificial da Groq!</p>`,
    );
    setEditableKey((k) => k + 1);
    setFloatingSelection(null);
    setIsOpen(false);
    messageApi.info("Textos reiniciados para o padrão original.");
  };

  const openSettings = () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL("options.html"));
    }
  };

  const diffParts = useMemo<DiffPart[]>(() => {
    if (!floatingSelection?.text || !correctedText) return [];
    return computeWordDiff(floatingSelection.text, correctedText);
  }, [floatingSelection?.text, correctedText]);

  const diffStats = useMemo(() => {
    return getDiffStats(diffParts);
  }, [diffParts]);

  const wordCount = correctedText
    ? correctedText.trim().split(/\s+/).filter(Boolean).length
    : 0;
  const charCount = correctedText ? correctedText.length : 0;

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
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
        },
      }}
    >
      {contextHolder}
      <Layout className="polite-page">
        <Header className="polite-page-header">
          <div className="polite-page-brand">
            <div className="polite-page-logo">
              <img
                src={politeLogoUrl}
                alt="Polite Logo"
                style={{ width: 40, height: 40 }}
              />
            </div>
            <div>
              <Title level={4} className="polite-page-title">
                Playground de Testes & Demonstração
              </Title>
              <Text className="polite-page-subtitle">
                Teste a seleção de texto, diff comparativo, modos rápidos e
                atalho{" "}
                <Tag
                  color="blue"
                  style={{ fontSize: 10, margin: 0, padding: "0 4px" }}
                >
                  Alt+C
                </Tag>
              </Text>
            </div>
          </div>

          <Space size={12}>
            <Button
              icon={<ReloadOutlined />}
              onClick={handleReset}
              className="polite-nav-button"
            >
              Restaurar Textos
            </Button>
            <Button
              icon={<SettingOutlined />}
              onClick={openSettings}
              className="polite-nav-button"
            >
              Configurações
            </Button>
          </Space>
        </Header>

        <Content className="polite-page-content">
          <Space direction="vertical" size={24} style={{ width: "100%" }}>
            <Alert
              message="Como testar os recursos avançados:"
              description={
                <div style={{ fontSize: 13, lineHeight: "20px" }}>
                  1. <b>Selecione</b> qualquer trecho dos textos abaixo.
                  <br />
                  2. Clique no botão flutuante <b>"Corrigir com IA"</b> ou
                  pressione{" "}
                  <Tag color="blue" style={{ margin: "0 2px" }}>
                    Alt + C
                  </Tag>
                  .<br />
                  3. Experimente alternar entre <b>Resultado</b> e <b>Diff</b>{" "}
                  para ver as palavras alteradas.
                  <br />
                  4. Escolha <b>Corrigir</b> ou <b>Traduzir</b> e pressione{" "}
                  <Tag color="default" style={{ margin: "0 2px" }}>
                    Enter
                  </Tag>{" "}
                  para substituir!
                </div>
              }
              type="info"
              showIcon
              style={{ backgroundColor: "#111d2c", borderColor: "#113560" }}
            />

            <Card
              className="polite-panel"
              styles={{ body: { padding: "18px 22px" } }}
              title={
                <Space size={8}>
                  <Tag color="blue">1</Tag>
                  <span style={{ color: "#ffffff", fontWeight: 600 }}>
                    Campo de Texto Simples (Input)
                  </span>
                </Space>
              }
              extra={<Tag color="default">HTML &lt;input&gt;</Tag>}
            >
              <Input
                value={simpleInput}
                onChange={(e) => setSimpleInput(e.target.value)}
                style={{
                  height: 42,
                  backgroundColor: "#141414",
                  borderColor: "#303030",
                  fontSize: 14,
                }}
              />
            </Card>

            <Card
              className="polite-panel"
              styles={{ body: { padding: "18px 22px" } }}
              title={
                <Space size={8}>
                  <Tag color="blue">2</Tag>
                  <span style={{ color: "#ffffff", fontWeight: 600 }}>
                    Área de Texto Longa (Textarea)
                  </span>
                </Space>
              }
              extra={<Tag color="default">HTML &lt;textarea&gt;</Tag>}
            >
              <Input.TextArea
                rows={4}
                value={textareaText}
                onChange={(e) => setTextareaText(e.target.value)}
                style={{
                  backgroundColor: "#141414",
                  borderColor: "#303030",
                  fontSize: 14,
                  lineHeight: "22px",
                }}
              />
            </Card>

            <Card
              className="polite-panel"
              styles={{ body: { padding: "18px 22px" } }}
              title={
                <Space size={8}>
                  <Tag color="blue">3</Tag>
                  <span style={{ color: "#ffffff", fontWeight: 600 }}>
                    Editor Rico (Div ContentEditable)
                  </span>
                </Space>
              }
              extra={<Tag color="default">Notion / Google Docs</Tag>}
            >
              <div
                key={editableKey}
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
                  outline: "none",
                }}
              />
            </Card>
          </Space>
        </Content>

        {floatingSelection && (
          <div
            ref={popoverRef}
            className="polite-popover"
            style={{
              position: "fixed",
              top: isOpen && dragPos ? dragPos.y : floatingSelection.top,
              left: isOpen && dragPos ? dragPos.x : floatingSelection.left,
              zIndex: 99999,
              userSelect: isDragging ? "none" : "auto",
            }}
          >
            {!isOpen ? (
              <button
                className="polite-trigger"
                onClick={() => handleExecuteFix("fix")}
                title="Atalho: Alt + C"
              >
                <span>Corrigir</span>
                <span className="polite-trigger-shortcut">Alt+C</span>
              </button>
            ) : (
              <div
                className={`polite-card${isDragging ? " polite-card--dragging" : ""}`}
              >
                <div
                  className={`polite-card-header${isDragging ? " polite-card-header--dragging" : ""}`}
                  onMouseDown={handleStartDrag}
                  title="Clique e arraste para mover"
                >
                  <div className="polite-card-title">
                    <HolderOutlined
                      style={{ color: isDragging ? "#1677ff" : "#8c8c8c" }}
                    />
                    <ThunderboltFilled style={{ color: "#1677ff" }} />
                    <span>Corretor IA (Groq)</span>
                  </div>
                  <Button
                    type="text"
                    size="small"
                    icon={<CloseOutlined />}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={handleClose}
                  />
                </div>

                <div onMouseDown={(e) => e.stopPropagation()}>
                  <div className="polite-toolbar">
                    <div className="polite-mode-group">
                      {ACTION_MODES.map((mode) => {
                        const isSelected = activeMode === mode.id;
                        return (
                          <button
                            key={mode.id}
                            className={`polite-mode-button${isSelected ? " polite-mode-button--active" : ""}`}
                            disabled={loading}
                            onClick={() =>
                              handleExecuteFix(
                                mode.id,
                                undefined,
                                targetLanguage,
                              )
                            }
                          >
                            <span>{mode.label}</span>
                          </button>
                        );
                      })}
                    </div>

                    <div className="polite-lang-group">
                      <span
                        className={`polite-lang-label${activeMode === "translate" ? " polite-lang-label--active" : ""}`}
                      >
                        Para:
                      </span>
                      <select
                        className={`polite-lang-select${activeMode === "translate" ? " polite-lang-select--active" : ""}`}
                        value={targetLanguage}
                        disabled={loading}
                        onChange={(e) => {
                          const newLang = e.target.value;
                          setTargetLanguage(newLang);
                          syncStorage.set("translation_target_lang", newLang);
                          if (
                            activeMode === "translate" &&
                            floatingSelection?.text
                          ) {
                            handleExecuteFix("translate", undefined, newLang);
                          }
                        }}
                      >
                        {SUPPORTED_LANGUAGES.map((lang) => (
                          <option
                            key={lang.code}
                            value={lang.promptName}
                            style={{
                              backgroundColor: "#1f1f1f",
                              color: "#ffffff",
                            }}
                          >
                            {lang.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="polite-body">
                    {loading ? (
                      <div className="polite-loading">
                        <Spin />
                        <div style={{ marginTop: 8 }}>
                          Processando com a Groq...
                        </div>
                      </div>
                    ) : error ? (
                      <div className="polite-error">{error}</div>
                    ) : (
                      <div>
                        <div className="polite-tabs">
                          <button
                            className={`polite-tab-button${activeTab === "result" ? " polite-tab-button--active" : ""}`}
                            onClick={() => setActiveTab("result")}
                          >
                            Resultado
                          </button>
                          <button
                            className={`polite-tab-button${activeTab === "diff" ? " polite-tab-button--active" : ""}`}
                            onClick={() => setActiveTab("diff")}
                          >
                            Diff
                            {(diffStats.additions > 0 ||
                              diffStats.deletions > 0) && (
                              <span className="polite-diff-stat">
                                +{diffStats.additions}/-{diffStats.deletions}
                              </span>
                            )}
                          </button>
                        </div>

                        <div className="polite-result-box">
                          {activeTab === "result" ? (
                            <div>{correctedText}</div>
                          ) : (
                            <div>
                              {diffParts.map((part, idx) => {
                                if (part.type === "added") {
                                  return (
                                    <span
                                      key={idx}
                                      className="polite-diff-added"
                                    >
                                      {part.value}
                                    </span>
                                  );
                                }
                                if (part.type === "removed") {
                                  return (
                                    <span
                                      key={idx}
                                      className="polite-diff-removed"
                                    >
                                      {part.value}
                                    </span>
                                  );
                                }
                                return <span key={idx}>{part.value}</span>;
                              })}
                            </div>
                          )}
                        </div>

                        <div className="polite-actions">
                          <button
                            className="polite-action-button"
                            onClick={async () => {
                              const ok = await copyToClipboard(correctedText);
                              if (ok) {
                                messageApi.info("Copiado!");
                              } else {
                                messageApi.error(
                                  "Não foi possível copiar. Copie o texto manualmente.",
                                );
                              }
                            }}
                          >
                            <CopyOutlined />
                            Copiar
                          </button>
                          <button
                            className="polite-action-button polite-action-button--primary"
                            onClick={handleReplace}
                          >
                            <EditOutlined />
                            <span>Substituir</span>
                            <span className="polite-action-shortcut">
                              ↵ Enter
                            </span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </Layout>
    </ConfigProvider>
  );
}
