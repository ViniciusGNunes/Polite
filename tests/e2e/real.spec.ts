// Full test plan (TEST_PLAN.md) against the real Groq API.
// Test titles start with the plan's check id so results can be mapped to the report.
import {
  expect,
  GROQ_API_KEY,
  selectField,
  selectText,
  TEST_PAGE_URL,
  test,
  type GroqCall
} from "./fixtures"
import type { Page } from "@playwright/test"

test.skip(!GROQ_API_KEY, "GROQ_API_KEY not set (see .env)")
// Traces store request headers (the API key); keep them off for real-key runs.
test.use({ trace: "off" })

const BROKEN_PT = "Eu vai para a padaria comprar pao amanhã de tarde."
const LEAK_PATTERNS = [
  /^(Correção|Texto corrigido|Aqui está|Segue|Here is|Here's|Corrected text|Translation)\s*:/i,
  /<\/?think>/i,
  /\bRacioc[ií]nio\b/i,
  /^```/,
  /^["“].*["”]$/s
]

function expectCleanCorrection(result: string, original: string) {
  expect(result.trim(), "result should not be empty").not.toBe("")
  expect(result.trim(), "result should differ from the broken input").not.toBe(original.trim())
  for (const pattern of LEAK_PATTERNS) {
    expect(result, `result leaks model chatter (${pattern})`).not.toMatch(pattern)
  }
}

const chatCalls = (calls: GroqCall[]) => calls.filter((c) => c.url.endsWith("/chat/completions"))

test.beforeEach(async ({ setStorage }, info) => {
  test.skip(info.project.name === "chromium" && !process.env.REAL_ON_CHROMIUM,
    "real-key suite targets branded browsers; set REAL_ON_CHROMIUM=1 to include bundled Chromium")
  await setStorage("local", { groq_api_key: GROQ_API_KEY })
  await setStorage("sync", { groq_model: "openai/gpt-oss-20b" })
})

test.afterEach(async ({ consoleErrors }, info) => {
  // Console errors are recorded per test (1.7) without hiding the test's own result.
  if (consoleErrors.length) info.annotations.push({ type: "console-errors", description: consoleErrors.join("\n") })
})

async function openTestPage(page: Page) {
  await page.goto(TEST_PAGE_URL)
  await expect(page.locator("plasmo-csui")).toBeAttached()
}

async function runFix(page: Page) {
  await page.locator(".polite-trigger").click()
  const box = page.locator(".polite-result-box")
  await expect(box).toBeVisible({ timeout: 25_000 })
  return (await box.innerText()).trim()
}

// ---------------------------------------------------------------- 1. Boot

test.describe("1. Packaging and boot", () => {
  test("[1.4] background starts", async ({ serviceWorker }) => {
    expect(await serviceWorker.evaluate(() => typeof chrome.runtime.id)).toBe("string")
  })

  test("[1.5] manifest fields", async ({ serviceWorker }) => {
    const m = await serviceWorker.evaluate(() => chrome.runtime.getManifest())
    expect(m.name).toBe("Polite")
    expect(m.manifest_version).toBe(3)
    expect(m.commands?.["fix-selection"]?.suggested_key?.default).toBe("Alt+C")
    expect(m.permissions).toContain("storage")
    expect(m.host_permissions).toContain("https://api.groq.com/*")
  })

  test("[1.6] icons resolve", async ({ page, extensionId, serviceWorker }) => {
    const icons = await serviceWorker.evaluate(() => chrome.runtime.getManifest().icons!)
    await page.goto(`chrome-extension://${extensionId}/popup.html`)
    for (const [size, file] of Object.entries(icons)) {
      const ok = await page.evaluate(async (f) => (await fetch(`/${f}`)).ok, file)
      expect(ok, `icon ${size}`).toBe(true)
    }
  })
})

// ---------------------------------------------------------------- 2. Popup

test.describe("2. Popup", () => {
  test.beforeEach(async ({ serviceWorker }) => {
    await serviceWorker.evaluate(() => chrome.storage.local.remove("groq_api_key"))
  })

  test("[2.1] popup renders the key form", async ({ page, extensionId }) => {
    await page.goto(`chrome-extension://${extensionId}/popup.html`)
    await expect(page.getByPlaceholder("gsk_...")).toBeVisible()
    await expect(page.getByRole("button", { name: /Salvar Chave/ })).toBeVisible()
  })

  test("[2.2] saving the real key validates and stores it", async ({ page, extensionId, getStorage }) => {
    await page.goto(`chrome-extension://${extensionId}/popup.html`)
    await page.getByPlaceholder("gsk_...").fill(GROQ_API_KEY)
    await page.getByRole("button", { name: /Salvar Chave/ }).click()
    await expect(page.getByText("API Key válida e salva com sucesso!")).toBeVisible({ timeout: 20_000 })
    expect(await getStorage("local", "groq_api_key")).toBe(GROQ_API_KEY)
    expect(await getStorage("sync", "groq_model")).toBeTruthy()
  })

  test("[2.3] empty and invalid keys are rejected", async ({ page, extensionId, getStorage }) => {
    await page.goto(`chrome-extension://${extensionId}/popup.html`)
    await page.getByRole("button", { name: /Salvar Chave/ }).click()
    await expect(page.getByText("Insira uma API Key válida.")).toBeVisible()

    await page.getByPlaceholder("gsk_...").fill("gsk_this_key_is_not_valid_0000000000000000000000000")
    await page.getByRole("button", { name: /Salvar Chave/ }).click()
    await expect(page.getByText(/Chave de API (inválida|não autorizada)/)).toBeVisible({ timeout: 20_000 })
    expect(await getStorage("local", "groq_api_key")).toBeUndefined()
  })

  test("[2.4] saved key shows connected state on reopen", async ({ page, extensionId, setStorage }) => {
    await setStorage("local", { groq_api_key: GROQ_API_KEY })
    await page.goto(`chrome-extension://${extensionId}/popup.html`)
    await expect(page.getByText("Pronto para uso")).toBeVisible()
    await expect(page.getByText("openai/gpt-oss-20b")).toBeVisible()
    await expect(page.getByText(GROQ_API_KEY)).toHaveCount(0)
  })

  test("[2.5] remove key clears storage", async ({ page, extensionId, setStorage, getStorage }) => {
    await setStorage("local", { groq_api_key: GROQ_API_KEY })
    await page.goto(`chrome-extension://${extensionId}/popup.html`)
    await page.getByRole("button", { name: /Remover/ }).click()
    await page.getByRole("button", { name: "Sim" }).click()
    await expect(page.getByPlaceholder("gsk_...")).toBeVisible()
    expect(await getStorage("local", "groq_api_key")).toBeUndefined()
  })

  test("[2.6] settings button opens options page", async ({ page, context, extensionId }) => {
    await page.goto(`chrome-extension://${extensionId}/popup.html`)
    const opened = context.waitForEvent("page")
    await page.getByRole("button", { name: /Configurações/ }).last().click()
    expect((await opened).url()).toContain("/options.html")
  })

  test("[2.7] playground button opens the test tab", async ({ page, context, extensionId }) => {
    await page.goto(`chrome-extension://${extensionId}/popup.html`)
    const opened = context.waitForEvent("page")
    await page.getByRole("button", { name: /Playground/ }).click()
    expect((await opened).url()).toContain("/tabs/test.html")
  })

  test("[2.8] get-key link opens the Groq console", async ({ page, context, extensionId }) => {
    await context.route("https://console.groq.com/**", (r) => r.fulfill({ body: "ok" }))
    await page.goto(`chrome-extension://${extensionId}/popup.html`)
    const opened = context.waitForEvent("page")
    await page.getByText(/Criar grátis no Groq Console/).click()
    const p = await opened
    await p.waitForURL(/console\.groq\.com\/keys/)
  })
})

// ---------------------------------------------------------------- 3. Options

test.describe("3. Options page", () => {
  const optionsUrl = (id: string) => `chrome-extension://${id}/options.html`

  test("[3.1] all panels render", async ({ page, extensionId }) => {
    await page.goto(optionsUrl(extensionId))
    for (const title of ["Autenticação & Chave da API Groq", "Modelo Ativo", "Lista de Exclusão", "Histórico de Correções"]) {
      await expect(page.getByText(title, { exact: false }).first()).toBeVisible()
    }
  })

  test("[3.2] test connection with the real key", async ({ page, extensionId }) => {
    await page.goto(optionsUrl(extensionId))
    await page.getByRole("button", { name: /Testar Conexão/ }).click()
    await expect(page.getByText(/Conexão bem sucedida com a Groq! Modelo operacional utilizado: \S+/)).toBeVisible({ timeout: 20_000 })
  })

  test("[3.3] test connection with an invalid key", async ({ page, extensionId }) => {
    await page.goto(optionsUrl(extensionId))
    await page.getByPlaceholder("gsk_...").fill("gsk_this_key_is_not_valid_0000000000000000000000000")
    await page.getByRole("button", { name: /Testar Conexão/ }).click()
    await expect(page.getByText(/Chave de API (inválida|não autorizada)/)).toBeVisible({ timeout: 20_000 })
  })

  test("[3.4] remove key", async ({ page, extensionId, getStorage }) => {
    await page.goto(optionsUrl(extensionId))
    await page.getByRole("button", { name: /Remover Chave/ }).click()
    await page.getByRole("button", { name: "Sim, remover" }).click()
    await expect.poll(() => getStorage("local", "groq_api_key")).toBeUndefined()
  })

  test("[3.5][3.6] discover account models", async ({ page, extensionId, getStorage }) => {
    await page.goto(optionsUrl(extensionId))
    await page.getByRole("button", { name: /Descobrir Modelos da Conta/ }).click()
    await expect(page.getByText(/\d+ modelos ativos encontrados/)).toBeVisible({ timeout: 20_000 })
    const cached: string[] = JSON.parse(await getStorage("sync", "groq_available_models"))
    expect(cached.length).toBeGreaterThan(0)
    for (const id of cached) expect(id).not.toMatch(/whisper|tts|guard|embed|orpheus/i)
    await expect(page.getByText(/whisper/i)).toHaveCount(0)
  })

  test("[3.5b] every recommended model exists on the account", async ({ page, extensionId, getStorage }) => {
    await page.goto(optionsUrl(extensionId))
    await page.getByRole("button", { name: /Descobrir Modelos da Conta/ }).click()
    await expect(page.getByText(/\d+ modelos ativos encontrados/)).toBeVisible({ timeout: 20_000 })
    const cached: string[] = JSON.parse(await getStorage("sync", "groq_available_models"))
    const recommended = await page.locator(".ant-radio-wrapper input").evaluateAll((els) =>
      els.map((e) => (e as HTMLInputElement).value))
    expect(recommended.length).toBeGreaterThan(0)
    for (const model of recommended) expect.soft(cached, `recommended model ${model}`).toContain(model)
  })

  test("[3.7][3.16] model choice persists after save + reload", async ({ page, extensionId, getStorage }) => {
    await page.goto(optionsUrl(extensionId))
    await page.locator(".ant-radio-wrapper").filter({ hasText: "120B" }).click()
    await page.getByRole("button", { name: /Salvar Preferências/ }).click()
    await expect(page.getByText("Configurações salvas com sucesso!")).toBeVisible()
    expect(await getStorage("sync", "groq_model")).toBe("openai/gpt-oss-120b")
    await page.reload()
    await expect(page.locator(".ant-radio-wrapper-checked")).toContainText("120B")
  })

  test("[3.8] deprecated model migrates on next request", async ({ page, setStorage, getStorage, groqCalls }) => {
    await setStorage("sync", { groq_model: "gemma2-9b-it" })
    await openTestPage(page)
    await selectField(page.locator("#campo-simples"))
    expectCleanCorrection(await runFix(page), BROKEN_PT)
    expect(chatCalls(groqCalls)[0].body.model).toBe("openai/gpt-oss-20b")
    expect(await getStorage("sync", "groq_model")).toBe("openai/gpt-oss-20b")
  })

  test("[3.9][3.10] add and remove ignored domain", async ({ page, extensionId, getStorage }) => {
    await page.goto(optionsUrl(extensionId))
    const input = page.getByPlaceholder("Ex: figma.com ou github.dev")
    await input.fill("https://www.Example.com/some/path")
    await page.getByRole("button", { name: /Adicionar/ }).click()
    await expect(page.locator(".ant-tag").filter({ hasText: "www.example.com" })).toBeVisible()
    expect(JSON.parse(await getStorage("sync", "ignored_domains"))).toEqual(["www.example.com"])

    await page.locator(".ant-tag").filter({ hasText: "www.example.com" }).locator(".ant-tag-close-icon").click()
    await expect.poll(async () => JSON.parse(await getStorage("sync", "ignored_domains"))).toEqual([])
  })

  test("[3.11] invalid and duplicate domains are rejected", async ({ page, extensionId }) => {
    await page.goto(optionsUrl(extensionId))
    const input = page.getByPlaceholder("Ex: figma.com ou github.dev")
    await input.fill("not a domain")
    await page.getByRole("button", { name: /Adicionar/ }).click()
    await expect(page.getByText("Digite um domínio válido, ex: figma.com")).toBeVisible()
    await input.fill("figma.com")
    await page.getByRole("button", { name: /Adicionar/ }).click()
    await input.fill("figma.com")
    await page.getByRole("button", { name: /Adicionar/ }).click()
    await expect(page.getByText("Este domínio já está na lista.")).toBeVisible()
  })

  test("[3.12][3.14] history updates live after a correction", async ({ page, context, extensionId }) => {
    await page.goto(optionsUrl(extensionId))
    await expect(page.getByText("Nenhum histórico registrado ainda")).toBeVisible()

    const site = await context.newPage()
    await openTestPage(site)
    await selectField(site.locator("#campo-simples"))
    const result = await runFix(site)

    await page.bringToFront()
    await expect(page.getByText(BROKEN_PT)).toBeVisible()
    await expect(page.getByText(result)).toBeVisible()
    await expect(page.locator(".ant-tag").filter({ hasText: /^Corrigir$/ })).toBeVisible()
  })

  test("[3.13] history is capped at 30 entries, newest first", async ({ page, setStorage, getStorage }) => {
    const old = Array.from({ length: 30 }, (_, i) => ({
      id: `old-${i}`, timestamp: i, original: `o${i}`, corrected: `c${i}`, mode: "Corrigir", modelUsed: "x"
    }))
    await setStorage("local", { groq_correction_history: old })
    await openTestPage(page)
    await selectField(page.locator("#campo-simples"))
    await runFix(page)
    await expect.poll(async () => (await getStorage("local", "groq_correction_history"))?.[0]?.original).toBe(BROKEN_PT)
    const history = await getStorage("local", "groq_correction_history")
    expect(history).toHaveLength(30)
    expect(history.at(-1).id).toBe("old-28")
  })

  test("[3.15] clear history", async ({ page, extensionId, setStorage, getStorage }) => {
    await setStorage("local", { groq_correction_history: [{ id: "1", timestamp: 1, original: "a", corrected: "b", mode: "Corrigir", modelUsed: "x" }] })
    await page.goto(optionsUrl(extensionId))
    await page.getByRole("button", { name: /Limpar Tudo/ }).click()
    await page.getByRole("button", { name: "Sim, limpar" }).click()
    await expect(page.getByText("Nenhum histórico registrado ainda")).toBeVisible()
    expect(await getStorage("local", "groq_correction_history")).toEqual([])
  })
})

// ---------------------------------------------------------------- 4. Trigger & selection

test.describe("4. Trigger and selection", () => {
  test("[4.1] content script injects", async ({ page }) => {
    await openTestPage(page)
    expect(await page.locator("plasmo-csui").evaluate((el) => !!el.shadowRoot)).toBe(true)
  })

  test("[4.2] trigger on <input>", async ({ page }) => {
    await openTestPage(page)
    await selectField(page.locator("#campo-simples"))
    await expect(page.locator(".polite-trigger")).toBeVisible()
  })

  test("[4.3] trigger on <textarea>", async ({ page }) => {
    await openTestPage(page)
    await selectField(page.locator("#area-texto"))
    await expect(page.locator(".polite-trigger")).toBeVisible()
  })

  test("[4.4] trigger on contenteditable", async ({ page }) => {
    await openTestPage(page)
    await selectText(page, ".content-editable p:nth-child(2)")
    await expect(page.locator(".polite-trigger")).toBeVisible()
  })

  test("[4.5] trigger on static text", async ({ page }) => {
    await openTestPage(page)
    await selectText(page, ".field-group p[style]")
    await expect(page.locator(".polite-trigger")).toBeVisible()
  })

  test("[4.6] short / whitespace selections are ignored", async ({ page }) => {
    await openTestPage(page)
    const input = page.locator("#campo-simples")
    await input.click()
    await input.evaluate((el: HTMLInputElement) => el.setSelectionRange(0, 1))
    await input.dispatchEvent("mouseup")
    await page.waitForTimeout(400)
    await expect(page.locator(".polite-trigger")).toHaveCount(0)

    await input.fill("a        b")
    await input.evaluate((el: HTMLInputElement) => el.setSelectionRange(1, 9))
    await input.dispatchEvent("mouseup")
    await page.waitForTimeout(400)
    await expect(page.locator(".polite-trigger")).toHaveCount(0)
  })

  test("[4.7] password / email / number inputs are ignored", async ({ page }) => {
    await openTestPage(page)
    await page.evaluate(() => {
      for (const type of ["password", "email", "number"]) {
        const el = document.createElement("input")
        el.type = type
        el.id = `f-${type}`
        el.value = type === "number" ? "123456" : type === "email" ? "eu@exemplo.com" : "segredo123"
        document.body.appendChild(el)
      }
    })
    for (const type of ["password", "email", "number"]) {
      const f = page.locator(`#f-${type}`)
      await page.locator("h1").click()
      await f.click()
      await f.press("ControlOrMeta+a")
      await f.dispatchEvent("mouseup")
      await page.waitForTimeout(300)
      await expect.soft(page.locator(".polite-trigger"), `trigger shown for type=${type}`).toHaveCount(0)
    }
  })

  test("[4.8] trigger stays inside the viewport near the edge", async ({ page }) => {
    await openTestPage(page)
    await page.evaluate(() => {
      const el = document.createElement("input")
      el.id = "edge"
      el.value = "Texto com erro perto da borda"
      el.style.cssText = "position:fixed;right:0;bottom:0;width:120px"
      document.body.appendChild(el)
    })
    await selectField(page.locator("#edge"))
    const box = await page.locator(".polite-trigger").boundingBox()
    const vp = page.viewportSize()!
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width)
    expect(box!.y + box!.height).toBeLessThanOrEqual(vp.height)
  })

  test("[4.9] clicking elsewhere closes the card", async ({ page }) => {
    await openTestPage(page)
    await selectField(page.locator("#campo-simples"))
    await runFix(page)
    await page.locator("h1").click()
    await expect(page.locator(".polite-card")).toHaveCount(0)
  })

  test("[4.10] ignored domain hides the trigger, live", async ({ page, setStorage }) => {
    await openTestPage(page)
    await selectField(page.locator("#campo-simples"))
    await expect(page.locator(".polite-trigger")).toBeVisible()
    await setStorage("sync", { ignored_domains: JSON.stringify(["polite.test"]) })
    await expect(page.locator(".polite-trigger")).toHaveCount(0)
    await selectField(page.locator("#area-texto"))
    await page.waitForTimeout(400)
    await expect(page.locator(".polite-trigger")).toHaveCount(0)
  })

  test("[4.11] extension styles stay inside the shadow root", async ({ page }) => {
    await openTestPage(page)
    await selectField(page.locator("#campo-simples"))
    await expect(page.locator(".polite-trigger")).toBeVisible()
    const leaked = await page.evaluate(() =>
      [...document.querySelectorAll("style,link[rel=stylesheet]")]
        .filter((el) => /polite-|chrome-extension:/.test(el.textContent + (el as HTMLLinkElement).href)).length)
    expect(leaked).toBe(0)
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(20, 20, 20)")
  })
})

// ---------------------------------------------------------------- 5. Real corrections

test.describe("5. Corrections with the real API", () => {
  test("[5.1-5.6] input: fix, clean output, same language, replace + events", async ({ page, groqCalls }) => {
    await openTestPage(page)
    const input = page.locator("#campo-simples")
    await input.evaluate((el) => {
      (window as any).__events = []
      el.addEventListener("input", () => (window as any).__events.push("input"))
      el.addEventListener("change", () => (window as any).__events.push("change"))
    })
    await selectField(input)
    await page.locator(".polite-trigger").click()
    await expect(page.locator(".polite-loading")).toBeVisible()
    await expect(page.locator(".polite-result-box")).toBeVisible({ timeout: 25_000 })
    const result = (await page.locator(".polite-result-box").innerText()).trim()
    expectCleanCorrection(result, BROKEN_PT)
    expect(result, "should stay in Portuguese").toMatch(/\b(vou|padaria|amanhã)\b/i)
    expect(chatCalls(groqCalls)).toHaveLength(1)

    await page.getByRole("button", { name: /Substituir/ }).click()
    await expect(input).toHaveValue(result)
    expect(await page.evaluate(() => (window as any).__events)).toContain("input")
  })

  test("[5.5] textarea: replaces only the selected range", async ({ page }) => {
    await openTestPage(page)
    const area = page.locator("#area-texto")
    const full = await area.inputValue()
    const first = full.slice(0, full.indexOf(".") + 1)
    await area.click()
    await area.evaluate((el: HTMLTextAreaElement, n) => el.setSelectionRange(0, n), first.length)
    await area.dispatchEvent("mouseup")
    const result = await runFix(page)
    expectCleanCorrection(result, first)
    await page.getByRole("button", { name: /Substituir/ }).click()
    await expect(area).toHaveValue(result + full.slice(first.length))
  })

  test("[5.5c] contenteditable: replaces the selected paragraph", async ({ page }) => {
    await openTestPage(page)
    const p = page.locator(".content-editable p:nth-child(2)")
    const before = (await p.innerText()).trim()
    await selectText(page, ".content-editable p:nth-child(2)")
    const result = await runFix(page)
    expectCleanCorrection(result, before)
    await page.getByRole("button", { name: /Substituir/ }).click()
    await expect(page.locator(".content-editable")).toContainText(result)
    await expect(page.locator(".content-editable")).not.toContainText("erroz")
    await expect(page.locator(".content-editable p").first()).toContainText("Notion")
  })

  test("[5.7] Enter applies the replacement", async ({ page }) => {
    await openTestPage(page)
    const input = page.locator("#campo-simples")
    await selectField(input)
    const result = await runFix(page)
    await page.keyboard.press("Enter")
    await expect(input).toHaveValue(result)
  })

  test("[5.8] Escape closes without changing the field", async ({ page }) => {
    await openTestPage(page)
    const input = page.locator("#campo-simples")
    await selectField(input)
    await runFix(page)
    await page.keyboard.press("Escape")
    await expect(page.locator(".polite-card")).toHaveCount(0)
    await expect(input).toHaveValue(BROKEN_PT)
  })

  test("[5.9] copy puts the result on the clipboard", async ({ page }) => {
    await openTestPage(page)
    await selectField(page.locator("#campo-simples"))
    const result = await runFix(page)
    await page.getByRole("button", { name: /Copiar/ }).click()
    await expect(page.getByRole("button", { name: /Copiado!/ })).toBeVisible()
    // Verify through a real paste: permission grants for clipboard-read are not
    // supported by every Chromium build (Edge refuses them).
    await page.keyboard.press("Escape")
    await page.evaluate(() => {
      const t = document.createElement("textarea")
      t.id = "paste-target"
      document.body.appendChild(t)
    })
    await page.locator("#paste-target").click()
    await page.keyboard.press("ControlOrMeta+v")
    await expect(page.locator("#paste-target")).toHaveValue(result)
  })

  test("[5.10] diff tab highlights changes", async ({ page }) => {
    await openTestPage(page)
    await selectField(page.locator("#campo-simples"))
    await runFix(page)
    await page.locator(".polite-tab-button").nth(1).click()
    await expect(page.locator(".polite-diff-added").first()).toBeVisible()
    await expect(page.locator(".polite-diff-removed").first()).toBeVisible()
    await expect(page.locator(".polite-diff-stat").first()).toHaveText(/\d/)
  })

  test("[5.11][5.12][5.13] translate to English, then Spanish", async ({ page, getStorage }) => {
    await openTestPage(page)
    await selectField(page.locator("#campo-simples"))
    await page.locator(".polite-trigger").click()
    await expect(page.locator(".polite-result-box")).toBeVisible({ timeout: 25_000 })

    await page.locator(".polite-mode-button").filter({ hasText: "Traduzir" }).click()
    await expect(page.locator(".polite-result-box")).toContainText(/\b(I|bakery|tomorrow|going)\b/i, { timeout: 25_000 })

    await page.locator(".polite-lang-select").selectOption("Espanhol")
    await expect(page.locator(".polite-result-box")).toContainText(/\b(voy|panadería|mañana|pan)\b/i, { timeout: 25_000 })
    expect(await getStorage("sync", "translation_target_lang")).toBe("Espanhol")
    await expect.poll(async () => (await getStorage("local", "groq_correction_history"))?.[0]?.mode)
      .toBe("Traduzir (Espanhol)")
  })

  test("[5.14] Alt+C with a selection triggers a correction", async ({ page, groqCalls }) => {
    await openTestPage(page)
    const input = page.locator("#campo-simples")
    await selectField(input)
    await page.keyboard.press("Alt+KeyC")
    await expect(page.locator(".polite-result-box")).toBeVisible({ timeout: 25_000 })
    expect(chatCalls(groqCalls), "exactly one request per shortcut press").toHaveLength(1)
    await expect(input, "Alt+C must not type a character into the field").toHaveValue(BROKEN_PT)
  })

  test("[5.15] Alt+C on a focused field without selection corrects the whole field", async ({ page, groqCalls }) => {
    await openTestPage(page)
    const input = page.locator("#campo-simples")
    await input.click()
    await input.press("End")
    await page.keyboard.press("Alt+KeyC")
    await expect(page.locator(".polite-result-box")).toBeVisible({ timeout: 25_000 })
    expect(chatCalls(groqCalls)[0].body.messages[1].content).toContain(BROKEN_PT)
  })

  test("[5.16] card can be dragged by its header", async ({ page }) => {
    await openTestPage(page)
    await selectField(page.locator("#campo-simples"))
    await runFix(page)
    const header = page.locator(".polite-card-header")
    const before = (await page.locator(".polite-popover").boundingBox())!
    const h = (await header.boundingBox())!
    await page.mouse.move(h.x + 40, h.y + h.height / 2)
    await page.mouse.down()
    // Drag toward the centre of the viewport so the edge clamp doesn't interfere.
    const vp = page.viewportSize()!
    const dx = before.x > vp.width / 2 ? -120 : 120
    const dy = before.y > vp.height / 2 ? -120 : 120
    await page.mouse.move(h.x + 40 + dx, h.y + h.height / 2 + dy, { steps: 8 })
    await page.mouse.up()
    const after = (await page.locator(".polite-popover").boundingBox())!
    expect(Math.abs(after.x - before.x)).toBeGreaterThan(50)
    expect(Math.abs(after.y - before.y)).toBeGreaterThan(50)
  })

  test("[5.17] a slow earlier request never overwrites a newer one", async ({ page, context }) => {
    // Mode buttons are disabled while loading, so the user-reachable race is:
    // start a fix, Escape, select something else, fix again.
    let n = 0
    await context.route("https://api.groq.com/openai/v1/chat/completions", async (route) => {
      const call = ++n
      if (call === 1) await new Promise((r) => setTimeout(r, 4000))
      await route.fulfill({ json: { choices: [{ finish_reason: "stop", message: { content: call === 1 ? "OLD" : "NEW" } }] } })
    })
    await openTestPage(page)
    await selectField(page.locator("#campo-simples"))
    await page.locator(".polite-trigger").click()
    await expect(page.locator(".polite-loading")).toBeVisible()
    await page.keyboard.press("Escape")
    await selectField(page.locator("#area-texto"))
    await page.locator(".polite-trigger").click()
    await expect(page.locator(".polite-result-box")).toHaveText("NEW")
    await page.waitForTimeout(4500)
    await expect(page.locator(".polite-result-box")).toHaveText("NEW")
  })
})

// ---------------------------------------------------------------- 6. Errors

test.describe("6. Error handling", () => {
  async function fixAndReadError(page: Page) {
    await openTestPage(page)
    await selectField(page.locator("#campo-simples"))
    await page.locator(".polite-trigger").click()
    const err = page.locator(".polite-error")
    await expect(err).toBeVisible({ timeout: 25_000 })
    return err
  }

  const fulfillChat = (context: any, response: object) =>
    context.route("https://api.groq.com/openai/v1/chat/completions", (r: any) => r.fulfill(response))

  test("[6.1] no API key", async ({ page, serviceWorker }) => {
    await serviceWorker.evaluate(() => chrome.storage.local.remove("groq_api_key"))
    await expect(await fixAndReadError(page)).toContainText("API Key da Groq não configurada")
  })

  test("[6.2] invalid key (real API)", async ({ page, setStorage }) => {
    await setStorage("local", { groq_api_key: "gsk_this_key_is_not_valid_0000000000000000000000000" })
    await expect(await fixAndReadError(page)).toContainText(/Chave de API (inválida|não autorizada)/)
  })

  test("[6.3] offline", async ({ page, context }) => {
    await context.route("https://api.groq.com/openai/v1/chat/completions", (r) => r.abort("internetdisconnected"))
    await openTestPage(page)
    await context.setOffline(true)
    await selectField(page.locator("#campo-simples"))
    await page.locator(".polite-trigger").click()
    await expect(page.locator(".polite-error")).toContainText("Sem conexão com a internet", { timeout: 25_000 })
    await context.setOffline(false)
  })

  test("[6.4] Groq unreachable", async ({ page, context }) => {
    await context.route("https://api.groq.com/openai/v1/chat/completions", (r) => r.abort("connectionrefused"))
    await expect(await fixAndReadError(page)).toContainText("Não foi possível conectar à Groq")
  })

  test("[6.5] rate limited", async ({ page, context }) => {
    await fulfillChat(context, { status: 429, json: { error: { message: "Rate limit reached for model openai/gpt-oss-20b. Please try again in 2s." } } })
    await expect(await fixAndReadError(page)).toContainText("Limite de requisições")
  })

  test("[6.6] truncated response", async ({ page, context }) => {
    await fulfillChat(context, { json: { choices: [{ finish_reason: "length", message: { content: "Eu vou" } }] } })
    await expect(await fixAndReadError(page)).toContainText("foi cortada")
  })

  test("[6.7] empty response", async ({ page, context }) => {
    await fulfillChat(context, { json: { choices: [{ finish_reason: "stop", message: { content: "   " } }] } })
    await expect(await fixAndReadError(page)).toContainText("resposta vazia")
  })

  test("[6.8] unavailable model falls back automatically (real API)", async ({ page, setStorage, getStorage, groqCalls }) => {
    await setStorage("sync", { groq_model: "polite/model-that-does-not-exist" })
    await openTestPage(page)
    await selectField(page.locator("#campo-simples"))
    expectCleanCorrection(await runFix(page), BROKEN_PT)
    const models = chatCalls(groqCalls).map((c) => c.body.model)
    expect(models[0]).toBe("polite/model-that-does-not-exist")
    expect(models.at(-1)).toBe("openai/gpt-oss-20b")
    expect(await getStorage("sync", "groq_model")).toBe("openai/gpt-oss-20b")
  })

  test("[6.9] extension reloaded while the page is open", async ({ page, serviceWorker }) => {
    await openTestPage(page)
    await serviceWorker.evaluate(() => chrome.runtime.reload()).catch(() => {})
    await page.waitForTimeout(1500)
    await selectField(page.locator("#campo-simples"))
    await page.locator(".polite-trigger").first().click()
    await expect(page.locator(".polite-error").first()).toContainText("A extensão foi atualizada", { timeout: 15_000 })
  })
})

// ---------------------------------------------------------------- 7. Built-in test page

test.describe("7. Built-in test page", () => {
  test("[7.1][7.2] playground correction works", async ({ page, extensionId }) => {
    await page.goto(`chrome-extension://${extensionId}/tabs/test.html`)
    const input = page.locator("input[type=text]").first()
    await expect(input).toHaveValue(BROKEN_PT)
    await selectField(input)
    const result = await runFix(page)
    expectCleanCorrection(result, BROKEN_PT)
    await page.getByRole("button", { name: /Substituir/ }).click()
    await expect(input).toHaveValue(result)
  })
})

// ---------------------------------------------------------------- 1.7 console

test("[1.7] no console errors on a normal session", async ({ page, extensionId, consoleErrors }) => {
  await page.goto(`chrome-extension://${extensionId}/popup.html`)
  await page.goto(`chrome-extension://${extensionId}/options.html`)
  await openTestPage(page)
  await selectField(page.locator("#campo-simples"))
  await runFix(page)
  await page.getByRole("button", { name: /Substituir/ }).click()
  expect(consoleErrors).toEqual([])
})
