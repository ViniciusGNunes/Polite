// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import { copyToClipboard, isEditableTextInput, replaceInputRange } from "../../src/utils/replace"

function makeInput(type?: string) {
  const el = document.createElement("input")
  if (type !== undefined) el.setAttribute("type", type)
  document.body.appendChild(el)
  return el
}

describe("isEditableTextInput", () => {
  it("accepts textareas and text-like inputs", () => {
    expect(isEditableTextInput(document.createElement("textarea"))).toBe(true)
    expect(isEditableTextInput(makeInput())).toBe(true)
    expect(isEditableTextInput(makeInput("search"))).toBe(true)
  })

  it.each(["password", "email", "number", "checkbox"])("rejects type=%s", (type) => {
    expect(isEditableTextInput(makeInput(type))).toBe(false)
  })
})

describe("replaceInputRange", () => {
  it("replaces the selected range and fires input/change events", () => {
    // jsdom has no execCommand, so this exercises the native-setter fallback.
    document.execCommand = () => false
    const el = makeInput()
    el.value = "Eu vai para casa"
    const onInput = vi.fn()
    const onChange = vi.fn()
    el.addEventListener("input", onInput)
    el.addEventListener("change", onChange)

    expect(replaceInputRange(el, 3, 6, "vou")).toBe(true)
    expect(el.value).toBe("Eu vou para casa")
    expect(el.selectionStart).toBe(6)
    expect(onInput).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledOnce()
  })
})

describe("copyToClipboard", () => {
  it("falls back to the copy command when navigator.clipboard is unavailable (http:// pages)", async () => {
    // jsdom, like insecure origins, has no navigator.clipboard.
    let copied = ""
    document.execCommand = ((cmd: string) => {
      if (cmd !== "copy") return false
      const data = new Map<string, string>()
      const evt = new Event("copy", { cancelable: true }) as ClipboardEvent
      Object.defineProperty(evt, "clipboardData", { value: { setData: (t: string, v: string) => data.set(t, v) } })
      document.dispatchEvent(evt)
      copied = data.get("text/plain") ?? ""
      return true
    }) as typeof document.execCommand

    expect(await copyToClipboard("texto corrigido")).toBe(true)
    expect(copied).toBe("texto corrigido")
  })
})
