import cssText from "data-text:~/styles.scss";
import type { PlasmoCSConfig, PlasmoGetStyle } from "plasmo";
import {
  useEffect,
  useLayoutEffect,
  useState,
  useRef,
  useCallback,
  useMemo,
} from "react";
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
  Globe,
} from "lucide-react";
import { computeWordDiff, getDiffStats, type DiffPart } from "./utils/diff";
import { SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE } from "./utils/languages";
import { syncStorage } from "./utils/storage";
import {
  isEditableTextInput,
  replaceInputRange,
  replaceRangeSelection,
  copyToClipboard,
} from "./utils/replace";

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
};

export const getStyle: PlasmoGetStyle = () => {
  const style = document.createElement("style");
  style.textContent = cssText;
  return style;
};

interface SelectionState {
  text: string;
  rect: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
  isInput: boolean;
  inputEl?: HTMLInputElement | HTMLTextAreaElement;
  start?: number;
  end?: number;
  range?: Range;
}

const ACTION_MODES = [
  { id: "fix", label: "Corrigir", icon: Zap },
  { id: "translate", label: "Traduzir", icon: Globe },
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

const CONTEXT_INVALIDATED_MESSAGE =
  "A extensão foi atualizada ou recarregada. Atualize esta página (F5) para continuar usando o Polite.";

function isContextInvalidatedError(err: unknown): boolean {
  const msg = (
    err instanceof Error ? err.message : String(err ?? "")
  ).toLowerCase();
  return (
    msg.includes("extension context invalidated") ||
    msg.includes("cannot read properties of undefined") ||
    msg.includes("receiving end does not exist")
  );
}

function isExtensionContextValid(): boolean {
  try {
    return !!(chrome?.runtime && chrome.runtime.id);
  } catch {
    return false;
  }
}

function detectActiveSelection(
  allowInputFallback = false,
): SelectionState | null {
  const activeEl = document.activeElement as
    | HTMLInputElement
    | HTMLTextAreaElement
    | null;
  // Browsers expose text selected inside any <input> via window.getSelection(),
  // so non-text fields (password, email, number...) must stop here.
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
      const { text, start, end } = trimRange(activeEl.value, selStart, selEnd);
      if (text.length >= 2) {
        const rect = activeEl.getBoundingClientRect();
        return {
          text,
          rect: {
            top: rect.top,
            bottom: rect.bottom,
            left: rect.left,
            right: rect.right,
          },
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
        rect: {
          top: rect.top,
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right,
        },
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
      const fallbackRect =
        rect.width > 0 || rect.height > 0
          ? rect
          : range.getClientRects()[0] || {
              top: window.innerHeight / 2,
              bottom: window.innerHeight / 2 + 30,
              left: window.innerWidth / 2,
              right: window.innerWidth / 2 + 100,
            };

      return {
        text,
        rect: {
          top: fallbackRect.top,
          bottom: fallbackRect.bottom,
          left: fallbackRect.left,
          right: fallbackRect.right,
        },
        isInput: false,
        range: range.cloneRange(),
      };
    }
  }

  return null;
}

export default function ContentUI() {
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [correctedText, setCorrectedText] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const [activeMode, setActiveMode] = useState("fix");
  const [activeTab, setActiveTab] = useState<"result" | "diff">("result");
  const [targetLanguage, setTargetLanguage] = useState(DEFAULT_LANGUAGE);
  const targetLanguageRef = useRef(targetLanguage);
  targetLanguageRef.current = targetLanguage;

  const [isBlacklisted, setIsBlacklisted] = useState(false);

  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef = useRef(false);

  const popoverRef = useRef<HTMLDivElement>(null);
  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const requestIdRef = useRef(0);

  useEffect(() => {
    const checkBlacklist = (raw: unknown) => {
      let domains: string[] = [];
      try {
        domains =
          typeof raw === "string"
            ? JSON.parse(raw)
            : Array.isArray(raw)
              ? raw
              : [];
      } catch {}
      const currentHost = window.location.hostname.toLowerCase();
      const matched = domains.some((d) => {
        if (!d) return false;
        const domain = d.toLowerCase().trim();
        return currentHost === domain || currentHost.endsWith(`.${domain}`);
      });
      setIsBlacklisted(matched);
    };

    syncStorage
      .get("ignored_domains")
      .then(checkBlacklist)
      .catch(() => {});

    syncStorage
      .get("translation_target_lang")
      .then((savedLang) => {
        if (savedLang && typeof savedLang === "string") {
          setTargetLanguage(savedLang);
        }
      })
      .catch(() => {});

    const onDomainsChange = (change: { newValue?: unknown }) =>
      checkBlacklist(change.newValue);
    const watchMap = { ignored_domains: onDomainsChange };
    syncStorage.watch(watchMap);
    return () => {
      syncStorage.unwatch(watchMap);
    };
  }, []);

  const checkSelection = useCallback(() => {
    if (isBlacklisted) return;
    if (isOpenRef.current) return;

    const sel = detectActiveSelection(false);
    setSelection(sel);
  }, [isBlacklisted]);

  useEffect(() => {
    if (isBlacklisted) return;
    let timeoutId: ReturnType<typeof setTimeout>;

    const handleEvent = (e: Event) => {
      if (
        popoverRef.current &&
        (e as MouseEvent).composedPath?.().includes(popoverRef.current)
      ) {
        return;
      }

      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        checkSelection();
      }, 70);
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (isDraggingRef.current) return;
      if (popoverRef.current && e.composedPath().includes(popoverRef.current)) {
        return;
      }
      if (isOpenRef.current) {
        handleClose();
      }
    };

    document.addEventListener("mouseup", handleEvent, true);
    document.addEventListener("keyup", handleEvent, true);
    document.addEventListener("mousedown", handleMouseDown, true);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener("mouseup", handleEvent, true);
      document.removeEventListener("keyup", handleEvent, true);
      document.removeEventListener("mousedown", handleMouseDown, true);
    };
  }, [checkSelection, isBlacklisted]);

  const executeProcessing = async (
    textToProcess: string,
    modeToUse: string,
    langToUse?: string,
  ) => {
    if (!textToProcess) return;

    const requestId = ++requestIdRef.current;

    setIsOpen(true);
    setLoading(true);
    setError("");
    setCorrectedText("");
    setActiveMode(modeToUse);

    const chosenLang =
      langToUse || targetLanguageRef.current || DEFAULT_LANGUAGE;

    if (!isExtensionContextValid()) {
      if (requestIdRef.current === requestId) {
        setError(CONTEXT_INVALIDATED_MESSAGE);
        setLoading(false);
      }
      return;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        action: "fix_grammar",
        text: textToProcess,
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

      if (isContextInvalidatedError(err)) {
        setError(CONTEXT_INVALIDATED_MESSAGE);
      } else {
        setError(
          err?.message ||
            "Erro ao comunicar com a extensão. Verifique sua API Key nas Configurações.",
        );
      }
    } finally {
      if (requestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  };

  const triggerFix = useCallback(
    (explicitSel?: SelectionState) => {
      if (isBlacklisted) return;

      const targetSel =
        explicitSel ||
        detectActiveSelection(true) ||
        (isOpenRef.current ? null : selectionRef.current);
      if (!targetSel || !targetSel.text || targetSel.text.trim().length < 2) {
        return;
      }

      setSelection(targetSel);
      executeProcessing(targetSel.text.trim(), "fix");
    },
    [isBlacklisted],
  );

  useEffect(() => {
    if (isBlacklisted) return;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (
        e.altKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        (e.code === "KeyC" || e.key?.toLowerCase() === "c")
      ) {
        const sel =
          detectActiveSelection(true) ||
          (isOpenRef.current ? null : selectionRef.current);
        if (sel && sel.text && sel.text.trim().length >= 2) {
          e.preventDefault();
          e.stopPropagation();
          triggerFix(sel);
        }
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown, true);
    return () =>
      window.removeEventListener("keydown", handleGlobalKeyDown, true);
  }, [triggerFix, isBlacklisted]);

  useEffect(() => {
    if (isBlacklisted) return;

    const handleRuntimeMessage = (msg: any) => {
      if (msg.action === "trigger_fix_from_shortcut") {
        triggerFix();
      }
    };

    chrome.runtime.onMessage.addListener(handleRuntimeMessage);
    return () => chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
  }, [triggerFix, isBlacklisted]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpenRef.current) return;
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

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [correctedText, selection, loading, error]);

  const handleStartDrag = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const startMouseX = e.clientX;
    const startMouseY = e.clientY;
    const startPosX = dragPos ? dragPos.x : leftPos;
    const startPosY = dragPos ? dragPos.y : topPos;

    isDraggingRef.current = true;
    setIsDragging(true);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startMouseX;
      const deltaY = moveEvent.clientY - startMouseY;

      const modalWidth = 380;
      const modalHeight = 260;
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

  useLayoutEffect(() => {
    if (!isOpen || isDraggingRef.current || !popoverRef.current) return;
    const rect = popoverRef.current.getBoundingClientRect();
    const margin = 10;
    let newLeft = rect.left;
    let newTop = rect.top;

    if (rect.right > window.innerWidth - margin) {
      newLeft -= rect.right - (window.innerWidth - margin);
    }
    if (newLeft < margin) newLeft = margin;

    if (rect.bottom > window.innerHeight - margin) {
      newTop -= rect.bottom - (window.innerHeight - margin);
    }
    if (newTop < margin) newTop = margin;

    if (
      Math.abs(newLeft - rect.left) > 0.5 ||
      Math.abs(newTop - rect.top) > 0.5
    ) {
      setDragPos({ x: newLeft, y: newTop });
    }
  }, [isOpen, loading, error, correctedText, activeTab]);

  const handleClose = (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    setIsOpen(false);
    setSelection(null);
    setDragPos(null);
    setActiveTab("result");
  };

  const copiedResetRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const handleCopy = async (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    const ok = await copyToClipboard(correctedText);
    if (!ok) {
      setError(
        "Não foi possível copiar para a área de transferência. Selecione e copie o texto manualmente.",
      );
      return;
    }
    setCopied(true);
    clearTimeout(copiedResetRef.current);
    copiedResetRef.current = setTimeout(() => setCopied(false), 2000);
  };

  useEffect(() => {
    return () => clearTimeout(copiedResetRef.current);
  }, []);

  const handleReplace = async (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();

    if (selection?.isInput && selection.inputEl) {
      const start = selection.start ?? selection.inputEl.selectionStart ?? 0;
      const end = selection.end ?? selection.inputEl.selectionEnd ?? 0;
      replaceInputRange(selection.inputEl, start, end, correctedText);
    } else if (selection?.range) {
      const replaced = replaceRangeSelection(selection.range, correctedText);
      if (!replaced) {
        const copied = await copyToClipboard(correctedText);
        if (copied) {
          setCopied(true);
        } else {
          setError(
            "Não foi possível copiar automaticamente. Copie o texto do resultado manualmente.",
          );
          return;
        }
      }
    } else {
      await handleCopy();
      return;
    }

    handleClose();
  };

  const diffParts = useMemo<DiffPart[]>(() => {
    if (!selection?.text || !correctedText) return [];
    return computeWordDiff(selection.text, correctedText);
  }, [selection?.text, correctedText]);

  const diffStats = useMemo(() => {
    return getDiffStats(diffParts);
  }, [diffParts]);

  if (isBlacklisted || !selection) return null;

  const popoverWidth = isOpen ? 380 : 160;
  const topPos = Math.min(
    window.innerHeight - (isOpen ? 280 : 50),
    Math.max(10, selection.rect.bottom + 8),
  );
  const leftPos = Math.min(
    window.innerWidth - popoverWidth - 10,
    Math.max(10, selection.rect.left),
  );

  const currentLeft = isOpen && dragPos ? dragPos.x : leftPos;
  const currentTop = isOpen && dragPos ? dragPos.y : topPos;

  return (
    <div
      ref={popoverRef}
      className="polite-popover"
      style={{
        position: "fixed",
        top: `${currentTop}px`,
        left: `${currentLeft}px`,
        zIndex: 2147483647,
        userSelect: isDragging ? "none" : "auto",
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {!isOpen ? (
        <button
          className="polite-trigger"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            executeProcessing(selection.text, "fix");
          }}
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
              <GripVertical
                size={13}
                style={{ color: isDragging ? "#1677ff" : "#8c8c8c" }}
              />
              <span>Polite</span>
            </div>
            <button
              className="polite-icon-button"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={handleClose}
              title="Fechar (Esc)"
            >
              <X size={14} />
            </button>
          </div>

          <div className="polite-toolbar">
            <div className="polite-mode-group">
              {ACTION_MODES.map((mode) => {
                const Icon = mode.icon;
                const isSelected = activeMode === mode.id;
                return (
                  <button
                    key={mode.id}
                    className={`polite-mode-button${isSelected ? " polite-mode-button--active" : ""}`}
                    disabled={loading}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (selection?.text) {
                        executeProcessing(
                          selection.text,
                          mode.id,
                          targetLanguage,
                        );
                      }
                    }}
                  >
                    <Icon size={12} />
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
                  if (activeMode === "translate" && selection?.text) {
                    executeProcessing(selection.text, "translate", newLang);
                  }
                }}
                title="Idioma de tradução"
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

          <div className="polite-body">
            {loading ? (
              <div className="polite-loading">
                <Loader2
                  size={22}
                  className="animate-spin"
                  style={{ color: "#1677ff", marginBottom: "8px" }}
                />
                <span>Processando...</span>
              </div>
            ) : error ? (
              <div className="polite-error">
                <div>{error}</div>
                {error === CONTEXT_INVALIDATED_MESSAGE && (
                  <button
                    className="polite-error-reload"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      window.location.reload();
                    }}
                  >
                    Recarregar página
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="polite-tabs">
                  <button
                    className={`polite-tab-button${activeTab === "result" ? " polite-tab-button--active" : ""}`}
                    onClick={() => setActiveTab("result")}
                  >
                    <AlignLeft size={12} />
                    Resultado
                  </button>
                  <button
                    className={`polite-tab-button${activeTab === "diff" ? " polite-tab-button--active" : ""}`}
                    onClick={() => setActiveTab("diff")}
                  >
                    <Split size={12} />
                    Diff
                    {(diffStats.additions > 0 || diffStats.deletions > 0) && (
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
                            <span key={idx} className="polite-diff-added">
                              {part.value}
                            </span>
                          );
                        }
                        if (part.type === "removed") {
                          return (
                            <span key={idx} className="polite-diff-removed">
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
                  <button className="polite-action-button" onClick={handleCopy}>
                    {copied ? (
                      <Check size={12} style={{ color: "#52c41a" }} />
                    ) : (
                      <Copy size={12} />
                    )}
                    {copied ? "Copiado!" : "Copiar"}
                  </button>
                  <button
                    className="polite-action-button polite-action-button--primary"
                    onClick={handleReplace}
                    title="Substituir no campo (Enter)"
                  >
                    <Replace size={12} />
                    <span>Substituir</span>
                    <span className="polite-action-shortcut">↵ Enter</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
