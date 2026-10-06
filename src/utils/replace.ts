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
    }

    el.dispatchEvent(new Event("input", { bubbles: true }))
    el.dispatchEvent(new Event("change", { bubbles: true }))
    replaced = true
  }

  return replaced
}

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

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // navigator.clipboard only exists on secure origins; plain http:// pages
    // need the legacy copy command (still allowed during a user click).
    return copyWithExecCommand(text)
  }
}

function copyWithExecCommand(text: string): boolean {
  const onCopy = (e: ClipboardEvent) => {
    e.clipboardData?.setData("text/plain", text)
    e.preventDefault()
  }
  document.addEventListener("copy", onCopy, true)
  try {
    return document.execCommand("copy")
  } catch {
    return false
  } finally {
    document.removeEventListener("copy", onCopy, true)
  }
}
