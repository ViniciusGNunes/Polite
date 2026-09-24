/**
 * Shared selection-replacement logic used by the content script and the
 * in-extension test/playground page, so both behave the same way.
 */

// Input types that behave like free text. Anything else (password, email,
// number, date, color, etc.) is excluded: some don't support
// setSelectionRange, and password fields must never have their contents
// read or sent anywhere.
const TEXT_LIKE_INPUT_TYPES = new Set([
  "text", "search", "url", "tel", ""
])

export function isEditableTextInput(el: HTMLInputElement | HTMLTextAreaElement): boolean {
  if (el.tagName === "TEXTAREA") return true
  if (el.tagName === "INPUT") {
    const type = (el.getAttribute("type") || "text").toLowerCase()
    return TEXT_LIKE_INPUT_TYPES.has(type)
  }
  return false
}

/**
 * Replaces the [start, end) range of an <input>/<textarea> with newText,
 * preferring document.execCommand (preserves native undo history and
 * notifies frameworks like React correctly) and falling back to the
 * native value setter, which React's synthetic event system also detects.
 */
export function replaceInputRange(
  el: HTMLInputElement | HTMLTextAreaElement,
  start: number,
  end: number,
  newText: string
): boolean {
  el.focus()
  try {
    el.setSelectionRange(start, end)
  } catch {
    // Some input types (email, number, ...) throw on setSelectionRange.
    // isEditableTextInput() should have already excluded these, but guard
    // defensively so a Replace action never crashes silently.
    return false
  }

  let replaced = false
  try {
    replaced = document.execCommand("insertText", false, newText)
  } catch {
    replaced = false
  }

  if (!replaced) {
    const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set
    const before = el.value.substring(0, start)
    const after = el.value.substring(end)
    const newValue = before + newText + after

    if (nativeSetter) {
      nativeSetter.call(el, newValue)
    } else {
      el.value = newValue
    }

    const newCursorPos = start + newText.length
    try {
      el.setSelectionRange(newCursorPos, newCursorPos)
    } catch {
      // ignore
    }

    el.dispatchEvent(new Event("input", { bubbles: true }))
    el.dispatchEvent(new Event("change", { bubbles: true }))
    replaced = true
  }

  return replaced
}

/**
 * Replaces a Range's contents with newText. Only touches the DOM directly
 * (the "deleteContents + insertNode" fallback) when the range sits inside
 * an editable element, so read-only page text is never rewritten.
 * Returns false when the range is not editable and not handled, so the
 * caller can fall back to copy-to-clipboard instead.
 */
export function replaceRangeSelection(range: Range, newText: string): boolean {
  const sel = window.getSelection()

  if (sel) {
    sel.removeAllRanges()
    sel.addRange(range)
  }

  const commonAncestor = range.commonAncestorContainer
  const containerEl = commonAncestor
    ? (commonAncestor.nodeType === Node.ELEMENT_NODE ? (commonAncestor as HTMLElement) : commonAncestor.parentElement)
    : null
  const editableRoot = containerEl?.closest('[contenteditable="true"], [contenteditable=""], [role="textbox"]') as HTMLElement | null
  const isEditable = !!editableRoot || !!containerEl?.isContentEditable

  if (!isEditable) {
    return false
  }

  editableRoot?.focus()

  let replaced = false
  try {
    replaced = document.execCommand("insertText", false, newText)
  } catch {
    replaced = false
  }

  if (!replaced) {
    try {
      range.deleteContents()
      const textNode = document.createTextNode(newText)
      range.insertNode(textNode)

      const newRange = document.createRange()
      newRange.setStartAfter(textNode)
      newRange.setEndAfter(textNode)
      sel?.removeAllRanges()
      sel?.addRange(newRange)

      const inputEvt = new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: newText
      })
      textNode.parentElement?.dispatchEvent(inputEvt)
      editableRoot?.dispatchEvent(inputEvt)
      editableRoot?.dispatchEvent(new Event("change", { bubbles: true }))

      replaced = true
    } catch {
      replaced = false
    }
  }

  return replaced
}

/**
 * Copies text to the clipboard, resolving to whether it actually succeeded
 * (navigator.clipboard.writeText silently rejects on unfocused documents,
 * insecure contexts, etc., and that must not be reported as success).
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
