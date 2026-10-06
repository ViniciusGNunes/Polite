#!/usr/bin/env node
// Firefox counterpart of tests/e2e/real.spec.ts.
// Playwright cannot load extensions into Firefox, so this drives the real
// Firefox build (build/firefox-mv3-prod) as a temporary add-on via Selenium.
// Check ids match TEST_PLAN.md and the Playwright titles.
//
//   node tests/firefox/run.mjs [--grep <text>] [--out <file>] [--headed]
import "dotenv/config"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import http from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Builder, By, Key } from "selenium-webdriver"
import firefox from "selenium-webdriver/firefox.js"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const ADDON_DIR = path.join(ROOT, "build/firefox-mv3-prod")
const MANIFEST = JSON.parse(readFileSync(path.join(ADDON_DIR, "manifest.json"), "utf8"))
const ADDON_ID = MANIFEST.browser_specific_settings.gecko.id
const UUID = "6f1c2b0e-1d2a-4c3b-9e4f-00000e000001"
const EXT = `moz-extension://${UUID}`
const KEY = process.env.GROQ_API_KEY?.trim()
const BAD_KEY = "gsk_this_key_is_not_valid_0000000000000000000000000"
const BROKEN_PT = "Eu vai para a padaria comprar pao amanhã de tarde."

const args = process.argv.slice(2)
const grep = args.includes("--grep") ? args[args.indexOf("--grep") + 1] : null
const outFile = args.includes("--out") ? args[args.indexOf("--out") + 1] : path.join(ROOT, "test-results/runs/firefox.json")
const headed = args.includes("--headed") || !!process.env.HEADED

if (!KEY) {
  console.error("GROQ_API_KEY not set (see .env)")
  process.exit(1)
}

// ------------------------------------------------------------------ test page server

const TEST_HTML = readFileSync(path.join(ROOT, "test.html"), "utf8")
const server = http.createServer((_, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
  res.end(TEST_HTML)
})
await new Promise((r) => server.listen(0, "127.0.0.1", r))
// Same non-secure origin as the Playwright suite (http://polite.test), so
// secure-context-only APIs behave like on a real http:// site.
const SITE = `http://polite.test:${server.address().port}/`

// ------------------------------------------------------------------ helpers

class Session {
  static async start() {
    const opts = new firefox.Options()
      .setPreference("extensions.webextensions.uuids", JSON.stringify({ [ADDON_ID]: UUID }))
      .setPreference("network.dns.localDomains", "polite.test")
      .windowSize({ width: 1280, height: 720 })
    if (!headed) opts.addArguments("-headless")
    const d = await new Builder()
      .forBrowser("firefox")
      .setFirefoxOptions(opts)
      .setFirefoxService(new firefox.ServiceBuilder().addArguments("--allow-system-access"))
      .build()
    const s = new Session(d)
    await d.installAddon(ADDON_DIR, true)
    s.siteHandle = await d.getWindowHandle()
    // Control tab: an extension page we use to reach storage and the background page.
    s.controlHandle = await s.openExtTab("/popup.html")
    await s.bg(`
      if (!bg.__politeMonitor) {
        bg.__politeMonitor = true
        bg.__calls = []; bg.__errors = []
        const realFetch = bg.fetch.bind(bg)
        bg.__realFetch = realFetch
        let last = 0
        bg.fetch = async (url, init) => {
          const u = String(url)
          if (u.includes("api.groq.com")) {
            const call = { url: u, body: init?.body ? JSON.parse(init.body) : null }
            bg.__calls.push(call)
            if (bg.__fault) { const r = await bg.__fault(u, call.body); if (r) return r }
            const wait = last + 2500 - Date.now(); if (wait > 0) await new Promise(r => setTimeout(r, wait))
            last = Date.now()
            const res = await realFetch(url, init)
            call.status = res.status
            return res
          }
          return realFetch(url, init)
        }
        const origError = bg.console.error.bind(bg.console)
        bg.console.error = (...a) => { bg.__errors.push(a.map(String).join(" ")); origError(...a) }
        bg.addEventListener("error", (e) => bg.__errors.push("uncaught: " + e.message))
        bg.addEventListener("unhandledrejection", (e) => bg.__errors.push("unhandled: " + (e.reason?.message || e.reason)))
      }`)
    await s.setStorage("local", { groq_api_key: KEY })
    await s.setStorage("sync", { groq_model: "openai/gpt-oss-20b" })
    await d.switchTo().window(s.siteHandle)
    return s
  }

  constructor(d) {
    this.d = d
  }

  async quit() {
    await this.d.quit().catch(() => {})
  }

  /** Opens an extension page in a new tab (WebDriver can't navigate to moz-extension:// directly). */
  async openExtTab(p) {
    const d = this.d
    const before = await d.getAllWindowHandles()
    await d.setContext(firefox.Context.CHROME)
    await d.executeScript(
      `gBrowser.selectedTab = gBrowser.addTab(arguments[0], { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() })`,
      EXT + p
    )
    await d.setContext(firefox.Context.CONTENT)
    const handle = await this.waitFor(async () => (await d.getAllWindowHandles()).find((h) => !before.includes(h)))
    await d.switchTo().window(handle)
    await this.waitFor(async () => (await d.executeScript("return document.readyState")) === "complete")
    await d.sleep(400)
    return handle
  }

  async inControl(script, ...a) {
    const d = this.d
    const back = await d.getWindowHandle()
    await d.switchTo().window(this.controlHandle)
    try {
      return await d.executeAsyncScript(
        `const done = arguments[arguments.length - 1];
         (async (...args) => { ${script} })(...Array.from(arguments).slice(0, -1))
           .then((v) => done({ ok: v }), (e) => done({ err: String(e && e.message || e) }))`,
        ...a
      ).then((r) => {
        if (r?.err) throw new Error(r.err)
        return r?.ok
      })
    } finally {
      await d.switchTo().window(back)
    }
  }

  /** Runs code with `bg` bound to the extension's background page. */
  bg(script, ...a) {
    return this.inControl(`const bg = await browser.runtime.getBackgroundPage(); ${script}`, ...a)
  }

  setStorage(area, values) {
    const serialised = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, JSON.stringify(v)]))
    return this.inControl(`await browser.storage[args[0]].set(args[1])`, area, serialised)
  }

  async getStorage(area, key) {
    const raw = await this.inControl(`return (await browser.storage[args[0]].get(args[1]))[args[1]]`, area, key)
    return raw === undefined || raw === null ? undefined : JSON.parse(raw)
  }

  removeStorage(area, key) {
    return this.inControl(`await browser.storage[args[0]].remove(args[1])`, area, key)
  }

  calls() {
    return this.bg(`return bg.__calls`)
  }

  chatCalls() {
    return this.calls().then((c) => c.filter((x) => x.url.endsWith("/chat/completions")))
  }

  /** Installs a fault: fn(url, body) source returning a bg-realm Response, or null to pass through. */
  fault(fnSource) {
    return this.bg(`bg.__fault = ${fnSource}`)
  }

  async waitFor(fn, timeout = 10000, label = "condition") {
    const end = Date.now() + timeout
    let lastErr
    while (Date.now() < end) {
      try {
        const v = await fn()
        if (v) return v
      } catch (e) {
        lastErr = e
      }
      await this.d.sleep(150)
    }
    throw new Error(`Timed out waiting for ${label}${lastErr ? ` (${lastErr.message})` : ""}`)
  }

  // ---- regular DOM

  $(css) {
    return this.d.findElement(By.css(css))
  }

  /** Replaces a field's value by selecting everything and typing, like a user. */
  async retype(el, text) {
    await el.click()
    await this.d.actions().keyDown(Key.CONTROL).sendKeys("a").keyUp(Key.CONTROL).sendKeys(Key.BACK_SPACE).perform()
    await el.sendKeys(text)
  }

  async bodyText() {
    return this.d.executeScript("return document.body.innerText")
  }

  async waitText(match, timeout = 10000) {
    const test = (t) => (match instanceof RegExp ? match.test(t) : t.includes(match))
    return this.waitFor(async () => test(await this.bodyText()), timeout, `text ${match}`)
  }

  async button(text) {
    return this.waitFor(async () => {
      const els = await this.d.findElements(By.xpath(`//button[contains(normalize-space(.), ${JSON.stringify(text)})]`))
      for (const el of els) if (await el.isDisplayed()) return el
    }, 10000, `button "${text}"`)
  }

  // ---- content script (inside the plasmo-csui shadow root)

  async shadowAll(css) {
    const hosts = await this.d.findElements(By.css("plasmo-csui"))
    const found = []
    for (const host of hosts) {
      const root = await host.getShadowRoot().catch(() => null)
      if (root) found.push(...(await root.findElements(By.css(css))))
    }
    return found
  }

  async shadow(css, timeout = 10000) {
    return this.waitFor(async () => (await this.shadowAll(css))[0], timeout, `shadow ${css}`)
  }

  async shadowCount(css) {
    return (await this.shadowAll(css)).length
  }

  async openSite() {
    await this.d.switchTo().window(this.siteHandle)
    await this.d.get(SITE)
    await this.waitFor(async () => (await this.d.findElements(By.css("plasmo-csui"))).length > 0, 10000, "content script")
  }

  async selectField(css) {
    const el = await this.$(css)
    await el.click()
    await this.d.actions().keyDown(Key.CONTROL).sendKeys("a").keyUp(Key.CONTROL).perform()
    await this.d.executeScript(`arguments[0].dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))`, el)
  }

  async selectText(css) {
    await this.d.executeScript(`
      const el = document.querySelector(arguments[0])
      el.closest("[contenteditable]")?.focus()
      const r = document.createRange(); r.selectNodeContents(el)
      const s = getSelection(); s.removeAllRanges(); s.addRange(r)
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))`, css)
  }

  async runFix() {
    await (await this.shadow(".polite-trigger")).click()
    const box = await this.shadow(".polite-result-box", 30000)
    return (await box.getText()).trim()
  }

  async shadowError() {
    return (await this.shadow(".polite-error", 30000)).getText()
  }

  async shadowButton(text) {
    return this.waitFor(async () => {
      for (const b of await this.shadowAll("button")) if ((await b.getText()).includes(text)) return b
    }, 10000, `shadow button "${text}"`)
  }
}

// ------------------------------------------------------------------ assertions

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a !== e) throw new Error(`${msg}: expected ${e}, got ${a}`)
}
const LEAKS = [
  /^(Correção|Texto corrigido|Aqui está|Segue|Here is|Here's|Corrected text|Translation)\s*:/i,
  /<\/?think>/i, /\bRacioc[ií]nio\b/i, /^```/, /^["“].*["”]$/s
]
function clean(result, original) {
  assert(result.trim(), "result should not be empty")
  assert(result.trim() !== original.trim(), "result should differ from the broken input")
  for (const p of LEAKS) assert(!p.test(result), `result leaks model chatter (${p}): ${result}`)
}

// ------------------------------------------------------------------ tests

const tests = []
const test = (title, fn) => tests.push({ title, fn })

test("1. Packaging and boot › [1.3] add-on installs as a temporary extension", async (s) => {
  eq(await s.inControl(`return browser.runtime.id`), ADDON_ID, "runtime id")
})

test("1. Packaging and boot › [1.4] background starts", async (s) => {
  eq(await s.bg(`return typeof bg.fetch`), "function", "background page")
})

test("1. Packaging and boot › [1.5] manifest fields", async (s) => {
  const m = await s.inControl(`return browser.runtime.getManifest()`)
  eq(m.name, "Polite", "name")
  eq(m.manifest_version, 3, "manifest_version")
  eq(m.commands?.["fix-selection"]?.suggested_key?.default, "Alt+C", "command")
  assert(m.permissions.includes("storage"), "storage permission")
  assert(m.host_permissions.includes("https://api.groq.com/*"), "host permission")
  const granted = await s.inControl(`return browser.permissions.contains({ origins: ["https://api.groq.com/*", "<all_urls>"] })`)
  assert(granted, "host permissions not granted at install (Firefox MV3 makes them optional)")
})

test("1. Packaging and boot › [1.6] icons resolve", async (s) => {
  const missing = await s.inControl(`
    const icons = browser.runtime.getManifest().icons
    const bad = []
    for (const f of Object.values(icons)) if (!(await fetch(browser.runtime.getURL(f))).ok) bad.push(f)
    return bad`)
  eq(missing, [], "missing icons")
})

test("2. Popup › [2.1] popup renders the key form", async (s) => {
  await s.removeStorage("local", "groq_api_key")
  await s.openExtTab("/popup.html")
  await s.waitFor(() => s.$('input[placeholder="gsk_..."]'))
  await s.button("Salvar Chave")
})

test("2. Popup › [2.2] saving the real key validates and stores it", async (s) => {
  await s.removeStorage("local", "groq_api_key")
  await s.openExtTab("/popup.html")
  await (await s.waitFor(() => s.$('input[placeholder="gsk_..."]'))).sendKeys(KEY)
  await (await s.button("Salvar Chave")).click()
  await s.waitText("API Key válida e salva com sucesso!", 20000)
  eq(await s.getStorage("local", "groq_api_key"), KEY, "stored key")
  assert(await s.getStorage("sync", "groq_model"), "model stored")
})

test("2. Popup › [2.3] empty and invalid keys are rejected", async (s) => {
  await s.removeStorage("local", "groq_api_key")
  await s.openExtTab("/popup.html")
  await (await s.button("Salvar Chave")).click()
  await s.waitText("Insira uma API Key válida.")
  await (await s.$('input[placeholder="gsk_..."]')).sendKeys(BAD_KEY)
  await (await s.button("Salvar Chave")).click()
  await s.waitText(/Chave de API (inválida|não autorizada)/, 20000)
  eq(await s.getStorage("local", "groq_api_key"), undefined, "key must not be stored")
})

test("2. Popup › [2.4] saved key shows connected state on reopen", async (s) => {
  await s.openExtTab("/popup.html")
  await s.waitText("Pronto para uso")
  await s.waitText("openai/gpt-oss-20b")
  assert(!(await s.bodyText()).includes(KEY), "key visible in plain text")
})

test("2. Popup › [2.5] remove key clears storage", async (s) => {
  await s.openExtTab("/popup.html")
  await (await s.button("Remover")).click()
  await (await s.button("Sim")).click()
  await s.waitFor(() => s.$('input[placeholder="gsk_..."]'))
  eq(await s.getStorage("local", "groq_api_key"), undefined, "stored key")
})

test("2. Popup › [2.6] settings button opens options page", async (s) => {
  await s.openExtTab("/popup.html")
  const before = await s.d.getAllWindowHandles()
  const btns = await s.d.findElements(By.xpath(`//button[contains(., "Configurações")]`))
  await btns.at(-1).click()
  const h = await s.waitFor(async () => (await s.d.getAllWindowHandles()).find((x) => !before.includes(x)), 5000, "new tab")
  await s.d.switchTo().window(h)
  await s.waitFor(async () => (await s.d.getCurrentUrl()).includes("/options.html"), 5000, "options url")
})

test("2. Popup › [2.7] playground button opens the test tab", async (s) => {
  await s.openExtTab("/popup.html")
  const before = await s.d.getAllWindowHandles()
  await (await s.button("Playground")).click()
  const h = await s.waitFor(async () => (await s.d.getAllWindowHandles()).find((x) => !before.includes(x)), 5000, "new tab")
  await s.d.switchTo().window(h)
  await s.waitFor(async () => (await s.d.getCurrentUrl()).includes("/tabs/test.html"), 5000, "test url")
})

test("2. Popup › [2.8] get-key link opens the Groq console", async (s) => {
  await s.removeStorage("local", "groq_api_key")
  await s.openExtTab("/popup.html")
  const before = await s.d.getAllWindowHandles()
  await (await s.d.findElement(By.xpath(`//a[contains(., "Criar grátis no Groq Console")]`))).click()
  const h = await s.waitFor(async () => (await s.d.getAllWindowHandles()).find((x) => !before.includes(x)), 5000, "new tab")
  await s.d.switchTo().window(h)
  await s.waitFor(async () => (await s.d.getCurrentUrl()).includes("console.groq.com"), 15000, "groq console url")
})

test("3. Options page › [3.1] all panels render", async (s) => {
  await s.openExtTab("/options.html")
  for (const t of ["Autenticação & Chave da API Groq", "Modelo Ativo", "Lista de Exclusão", "Histórico de Correções"]) await s.waitText(t)
})

test("3. Options page › [3.2] test connection with the real key", async (s) => {
  await s.openExtTab("/options.html")
  await (await s.button("Testar Conexão")).click()
  await s.waitText(/Conexão bem sucedida com a Groq! Modelo operacional utilizado: \S+/, 20000)
})

test("3. Options page › [3.3] test connection with an invalid key", async (s) => {
  await s.openExtTab("/options.html")
  const input = await s.waitFor(() => s.$('input[placeholder="gsk_..."]'))
  await s.retype(input, BAD_KEY)
  await (await s.button("Testar Conexão")).click()
  await s.waitText(/Chave de API (inválida|não autorizada)/, 20000)
})

test("3. Options page › [3.4] remove key", async (s) => {
  await s.openExtTab("/options.html")
  await (await s.button("Remover Chave")).click()
  await (await s.button("Sim, remover")).click()
  await s.waitFor(async () => (await s.getStorage("local", "groq_api_key")) === undefined, 5000, "key removed")
})

test("3. Options page › [3.5][3.6] discover account models", async (s) => {
  await s.openExtTab("/options.html")
  await (await s.button("Descobrir Modelos da Conta")).click()
  await s.waitText(/\d+ modelos ativos encontrados/, 20000)
  const cached = JSON.parse(await s.getStorage("sync", "groq_available_models"))
  assert(cached.length > 0, "no cached models")
  for (const id of cached) assert(!/whisper|tts|guard|embed|orpheus/i.test(id), `non-chat model listed: ${id}`)
})

test("3. Options page › [3.5b] every recommended model exists on the account", async (s) => {
  await s.openExtTab("/options.html")
  await (await s.button("Descobrir Modelos da Conta")).click()
  await s.waitText(/\d+ modelos ativos encontrados/, 20000)
  const cached = JSON.parse(await s.getStorage("sync", "groq_available_models"))
  const recommended = await s.d.executeScript(`return [...document.querySelectorAll(".ant-radio-wrapper input")].map(e => e.value)`)
  const missing = recommended.filter((m) => !cached.includes(m))
  eq(missing, [], "recommended models missing from the account")
})

test("3. Options page › [3.7][3.16] model choice persists after save + reload", async (s) => {
  await s.openExtTab("/options.html")
  await (await s.waitFor(() => s.d.findElement(By.xpath(`//label[contains(@class,"ant-radio-wrapper")][contains(., "120B")]`)))).click()
  await (await s.button("Salvar Preferências")).click()
  await s.waitText("Configurações salvas com sucesso!")
  eq(await s.getStorage("sync", "groq_model"), "openai/gpt-oss-120b", "stored model")
  await s.d.navigate().refresh()
  await s.waitFor(async () => (await s.$(".ant-radio-wrapper-checked").then((e) => e.getText()).catch(() => "")).includes("120B"), 5000, "checked 120B")
})

test("3. Options page › [3.8] deprecated model migrates on next request", async (s) => {
  await s.setStorage("sync", { groq_model: "gemma2-9b-it" })
  await s.openSite()
  await s.selectField("#campo-simples")
  clean(await s.runFix(), BROKEN_PT)
  eq((await s.chatCalls())[0].body.model, "openai/gpt-oss-20b", "model sent")
  eq(await s.getStorage("sync", "groq_model"), "openai/gpt-oss-20b", "stored model")
})

test("3. Options page › [3.9][3.10] add and remove ignored domain", async (s) => {
  await s.openExtTab("/options.html")
  const input = await s.waitFor(() => s.$('input[placeholder="Ex: figma.com ou github.dev"]'))
  await input.sendKeys("https://www.Example.com/some/path")
  await (await s.button("Adicionar")).click()
  await s.waitText("www.example.com")
  eq(JSON.parse(await s.getStorage("sync", "ignored_domains")), ["www.example.com"], "stored domains")
  await (await s.$(".ant-tag .ant-tag-close-icon")).click()
  await s.waitFor(async () => JSON.parse(await s.getStorage("sync", "ignored_domains")).length === 0, 5000, "domain removed")
})

test("3. Options page › [3.11] invalid and duplicate domains are rejected", async (s) => {
  await s.openExtTab("/options.html")
  const input = await s.waitFor(() => s.$('input[placeholder="Ex: figma.com ou github.dev"]'))
  await input.sendKeys("not a domain")
  await (await s.button("Adicionar")).click()
  await s.waitText("Digite um domínio válido, ex: figma.com")
  await s.retype(input, "figma.com")
  await (await s.button("Adicionar")).click()
  await input.sendKeys("figma.com")
  await (await s.button("Adicionar")).click()
  await s.waitText("Este domínio já está na lista.")
})

test("3. Options page › [3.12][3.14] history updates live after a correction", async (s) => {
  const opts = await s.openExtTab("/options.html")
  await s.waitText("Nenhum histórico registrado ainda")
  await s.openSite()
  await s.selectField("#campo-simples")
  const result = await s.runFix()
  await s.d.switchTo().window(opts)
  await s.waitText(BROKEN_PT)
  await s.waitText(result)
})

test("3. Options page › [3.13] history is capped at 30 entries, newest first", async (s) => {
  const old = Array.from({ length: 30 }, (_, i) => ({ id: `old-${i}`, timestamp: i, original: `o${i}`, corrected: `c${i}`, mode: "Corrigir", modelUsed: "x" }))
  await s.setStorage("local", { groq_correction_history: old })
  await s.openSite()
  await s.selectField("#campo-simples")
  await s.runFix()
  await s.waitFor(async () => (await s.getStorage("local", "groq_correction_history"))?.[0]?.original === BROKEN_PT, 5000, "history entry")
  const h = await s.getStorage("local", "groq_correction_history")
  eq(h.length, 30, "history length")
  eq(h.at(-1).id, "old-28", "oldest kept")
})

test("3. Options page › [3.15] clear history", async (s) => {
  await s.setStorage("local", { groq_correction_history: [{ id: "1", timestamp: 1, original: "a", corrected: "b", mode: "Corrigir", modelUsed: "x" }] })
  await s.openExtTab("/options.html")
  await (await s.button("Limpar Tudo")).click()
  await (await s.button("Sim, limpar")).click()
  await s.waitText("Nenhum histórico registrado ainda")
  eq(await s.getStorage("local", "groq_correction_history"), [], "history")
})

test("4. Trigger and selection › [4.1] content script injects", async (s) => {
  await s.openSite()
  assert(await s.d.executeScript(`return !!document.querySelector("plasmo-csui").shadowRoot`), "no shadow root")
})

for (const [id, label, css] of [["4.2", "<input>", "#campo-simples"], ["4.3", "<textarea>", "#area-texto"]]) {
  test(`4. Trigger and selection › [${id}] trigger on ${label}`, async (s) => {
    await s.openSite()
    await s.selectField(css)
    await s.shadow(".polite-trigger")
  })
}

test("4. Trigger and selection › [4.4] trigger on contenteditable", async (s) => {
  await s.openSite()
  await s.selectText(".content-editable p:nth-child(2)")
  await s.shadow(".polite-trigger")
})

test("4. Trigger and selection › [4.5] trigger on static text", async (s) => {
  await s.openSite()
  await s.selectText(".field-group p[style]")
  await s.shadow(".polite-trigger")
})

test("4. Trigger and selection › [4.6] short / whitespace selections are ignored", async (s) => {
  await s.openSite()
  const input = await s.$("#campo-simples")
  await input.click()
  await s.d.executeScript(`arguments[0].setSelectionRange(0, 1); arguments[0].dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))`, input)
  await s.d.sleep(400)
  eq(await s.shadowCount(".polite-trigger"), 0, "trigger for 1 char")
  await s.d.executeScript(`arguments[0].value = "a        b"; arguments[0].setSelectionRange(1, 9); arguments[0].dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))`, input)
  await s.d.sleep(400)
  eq(await s.shadowCount(".polite-trigger"), 0, "trigger for whitespace")
})

test("4. Trigger and selection › [4.7] password / email / number inputs are ignored", async (s) => {
  await s.openSite()
  await s.d.executeScript(`for (const t of ["password", "email", "number"]) {
    const el = document.createElement("input"); el.type = t; el.id = "f-" + t
    el.value = t === "number" ? "123456" : t === "email" ? "eu@exemplo.com" : "segredo123"
    document.body.appendChild(el) }`)
  const shown = []
  for (const t of ["password", "email", "number"]) {
    await (await s.$("h1")).click()
    await s.selectField(`#f-${t}`)
    await s.d.sleep(400)
    if (await s.shadowCount(".polite-trigger")) shown.push(t)
  }
  eq(shown, [], "trigger shown for")
})

test("4. Trigger and selection › [4.8] trigger stays inside the viewport near the edge", async (s) => {
  await s.openSite()
  await s.d.executeScript(`const el = document.createElement("input"); el.id = "edge"; el.value = "Texto com erro perto da borda"
    el.style.cssText = "position:fixed;right:0;bottom:0;width:120px"; document.body.appendChild(el)`)
  await s.selectField("#edge")
  const r = await (await s.shadow(".polite-trigger")).getRect()
  const vp = await s.d.executeScript("return [innerWidth, innerHeight]")
  assert(r.x >= 0 && r.y >= 0 && r.x + r.width <= vp[0] && r.y + r.height <= vp[1], `trigger outside viewport: ${JSON.stringify(r)} vs ${vp}`)
})

test("4. Trigger and selection › [4.9] clicking elsewhere closes the card", async (s) => {
  await s.openSite()
  await s.selectField("#campo-simples")
  await s.runFix()
  await (await s.$("h1")).click()
  await s.waitFor(async () => (await s.shadowCount(".polite-card")) === 0, 3000, "card closed")
})

test("4. Trigger and selection › [4.10] ignored domain hides the trigger, live", async (s) => {
  await s.openSite()
  await s.selectField("#campo-simples")
  await s.shadow(".polite-trigger")
  await s.setStorage("sync", { ignored_domains: JSON.stringify(["polite.test"]) })
  await s.waitFor(async () => (await s.shadowCount(".polite-trigger")) === 0, 5000, "trigger hidden")
  await s.selectField("#area-texto")
  await s.d.sleep(400)
  eq(await s.shadowCount(".polite-trigger"), 0, "trigger after re-select")
})

test("4. Trigger and selection › [4.11] extension styles stay inside the shadow root", async (s) => {
  await s.openSite()
  await s.selectField("#campo-simples")
  await s.shadow(".polite-trigger")
  const leaked = await s.d.executeScript(`return [...document.querySelectorAll("style,link[rel=stylesheet]")]
    .filter(el => /polite-|moz-extension:/.test(el.textContent + (el.href || ""))).length`)
  eq(leaked, 0, "leaked stylesheets")
  eq(await s.d.executeScript(`return getComputedStyle(document.body).backgroundColor`), "rgb(20, 20, 20)", "body background")
})

test("5. Corrections with the real API › [5.1-5.6] input: fix, clean output, same language, replace + events", async (s) => {
  await s.openSite()
  await s.d.executeScript(`window.__events = []; const el = document.querySelector("#campo-simples")
    el.addEventListener("input", () => __events.push("input")); el.addEventListener("change", () => __events.push("change"))`)
  await s.selectField("#campo-simples")
  await (await s.shadow(".polite-trigger")).click()
  await s.shadow(".polite-loading", 5000)
  const result = (await (await s.shadow(".polite-result-box", 30000)).getText()).trim()
  clean(result, BROKEN_PT)
  assert(/\b(vou|padaria|amanhã)\b/i.test(result), `should stay in Portuguese: ${result}`)
  eq((await s.chatCalls()).length, 1, "chat requests")
  await (await s.shadowButton("Substituir")).click()
  await s.waitFor(async () => (await (await s.$("#campo-simples")).getAttribute("value")) === result
    || (await s.d.executeScript(`return document.querySelector("#campo-simples").value`)) === result, 5000, "field replaced")
  assert((await s.d.executeScript("return window.__events")).includes("input"), "no input event")
})

test("5. Corrections with the real API › [5.5] textarea: replaces only the selected range", async (s) => {
  await s.openSite()
  const full = await s.d.executeScript(`return document.querySelector("#area-texto").value`)
  const first = full.slice(0, full.indexOf(".") + 1)
  await (await s.$("#area-texto")).click()
  await s.d.executeScript(`const el = document.querySelector("#area-texto"); el.setSelectionRange(0, arguments[0]);
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))`, first.length)
  const result = await s.runFix()
  clean(result, first)
  await (await s.shadowButton("Substituir")).click()
  await s.waitFor(async () => (await s.d.executeScript(`return document.querySelector("#area-texto").value`)) === result + full.slice(first.length), 5000, "range replaced")
})

test("5. Corrections with the real API › [5.5c] contenteditable: replaces the selected paragraph", async (s) => {
  await s.openSite()
  const before = (await s.d.executeScript(`return document.querySelector(".content-editable p:nth-child(2)").innerText`)).trim()
  await s.selectText(".content-editable p:nth-child(2)")
  const result = await s.runFix()
  clean(result, before)
  await (await s.shadowButton("Substituir")).click()
  await s.waitFor(async () => {
    const t = await s.d.executeScript(`return document.querySelector(".content-editable").innerText`)
    return t.includes(result) && !t.includes("erroz") && t.includes("Notion")
  }, 5000, "paragraph replaced")
})

test("5. Corrections with the real API › [5.7] Enter applies the replacement", async (s) => {
  await s.openSite()
  await s.selectField("#campo-simples")
  const result = await s.runFix()
  await s.d.actions().sendKeys(Key.ENTER).perform()
  await s.waitFor(async () => (await s.d.executeScript(`return document.querySelector("#campo-simples").value`)) === result, 5000, "Enter replaced")
})

test("5. Corrections with the real API › [5.8] Escape closes without changing the field", async (s) => {
  await s.openSite()
  await s.selectField("#campo-simples")
  await s.runFix()
  await s.d.actions().sendKeys(Key.ESCAPE).perform()
  await s.waitFor(async () => (await s.shadowCount(".polite-card")) === 0, 3000, "card closed")
  eq(await s.d.executeScript(`return document.querySelector("#campo-simples").value`), BROKEN_PT, "field value")
})

test("5. Corrections with the real API › [5.9] copy puts the result on the clipboard", async (s) => {
  await s.openSite()
  await s.selectField("#campo-simples")
  const result = await s.runFix()
  await (await s.shadowButton("Copiar")).click()
  await s.shadowButton("Copiado!")
  await s.d.actions().sendKeys(Key.ESCAPE).perform()
  await s.d.executeScript(`const t = document.createElement("textarea"); t.id = "paste-target"; document.body.appendChild(t)`)
  await (await s.$("#paste-target")).click()
  await s.d.actions().keyDown(Key.CONTROL).sendKeys("v").keyUp(Key.CONTROL).perform()
  await s.waitFor(async () => (await s.d.executeScript(`return document.querySelector("#paste-target").value`)) === result, 5000, "pasted text")
})

test("5. Corrections with the real API › [5.10] diff tab highlights changes", async (s) => {
  await s.openSite()
  await s.selectField("#campo-simples")
  await s.runFix()
  await (await s.shadowAll(".polite-tab-button"))[1].click()
  await s.shadow(".polite-diff-added")
  await s.shadow(".polite-diff-removed")
  assert(/\d/.test(await (await s.shadow(".polite-diff-stat")).getText()), "diff stats")
})

test("5. Corrections with the real API › [5.11][5.12][5.13] translate to English, then Spanish", async (s) => {
  await s.openSite()
  await s.selectField("#campo-simples")
  await s.runFix()
  await (await s.shadowButton("Traduzir")).click()
  await s.waitFor(async () => /\b(I|bakery|tomorrow|going)\b/i.test(await (await s.shadow(".polite-result-box", 30000)).getText()), 30000, "English translation")
  const select = await s.shadow(".polite-lang-select")
  await select.findElement(By.css('option[value="Espanhol"]')).click()
  await s.waitFor(async () => /\b(voy|panadería|mañana|pan)\b/i.test(await (await s.shadow(".polite-result-box", 30000)).getText()), 30000, "Spanish translation")
  eq(await s.getStorage("sync", "translation_target_lang"), "Espanhol", "stored language")
  await s.waitFor(async () => (await s.getStorage("local", "groq_correction_history"))?.[0]?.mode === "Traduzir (Espanhol)", 5000, "history mode")
})

test("5. Corrections with the real API › [5.14] Alt+C with a selection triggers a correction", async (s) => {
  await s.openSite()
  await s.selectField("#campo-simples")
  await s.d.actions().keyDown(Key.ALT).sendKeys("c").keyUp(Key.ALT).perform()
  await s.shadow(".polite-result-box", 30000)
  eq((await s.chatCalls()).length, 1, "requests per shortcut press")
  eq(await s.d.executeScript(`return document.querySelector("#campo-simples").value`), BROKEN_PT, "Alt+C typed into the field")
})

test("5. Corrections with the real API › [5.15] Alt+C on a focused field without selection corrects the whole field", async (s) => {
  await s.openSite()
  await (await s.$("#campo-simples")).click()
  await s.d.actions().sendKeys(Key.END).perform()
  await s.d.actions().keyDown(Key.ALT).sendKeys("c").keyUp(Key.ALT).perform()
  await s.shadow(".polite-result-box", 30000)
  assert((await s.chatCalls())[0].body.messages[1].content.includes(BROKEN_PT), "whole field not sent")
})

test("5. Corrections with the real API › [5.16] card can be dragged by its header", async (s) => {
  await s.openSite()
  await s.selectField("#campo-simples")
  await s.runFix()
  const before = await (await s.shadow(".polite-popover")).getRect()
  const header = await s.shadow(".polite-card-header")
  const vp = await s.d.executeScript("return [innerWidth, innerHeight]")
  const dx = before.x > vp[0] / 2 ? -120 : 120, dy = before.y > vp[1] / 2 ? -120 : 120
  await s.d.actions().move({ origin: header }).press().move({ origin: header, x: dx, y: dy, duration: 300 }).release().perform()
  const after = await (await s.shadow(".polite-popover")).getRect()
  assert(Math.abs(after.x - before.x) > 50 && Math.abs(after.y - before.y) > 50, `card did not move: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`)
})

test("5. Corrections with the real API › [5.17] a slow earlier request never overwrites a newer one", async (s) => {
  await s.fault(`(() => { let n = 0; return async (url) => {
    if (!url.endsWith("/chat/completions")) return null
    const call = ++n
    if (call === 1) await new Promise(r => setTimeout(r, 4000))
    return new bg.Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: call === 1 ? "OLD" : "NEW" } }] }), { status: 200, headers: { "content-type": "application/json" } })
  } })()`)
  await s.openSite()
  await s.selectField("#campo-simples")
  await (await s.shadow(".polite-trigger")).click()
  await s.shadow(".polite-loading", 5000)
  await s.d.actions().sendKeys(Key.ESCAPE).perform()
  await s.selectField("#area-texto")
  await (await s.shadow(".polite-trigger")).click()
  await s.waitFor(async () => (await (await s.shadow(".polite-result-box", 10000)).getText()) === "NEW", 10000, "newer result")
  await s.d.sleep(4500)
  eq(await (await s.shadow(".polite-result-box")).getText(), "NEW", "stale result overwrote newer one")
})

const errorTests = [
  ["6.1", "no API key", async (s) => s.removeStorage("local", "groq_api_key"), "API Key da Groq não configurada"],
  ["6.2", "invalid key (real API)", async (s) => s.setStorage("local", { groq_api_key: BAD_KEY }), /Chave de API (inválida|não autorizada)/],
  ["6.4", "Groq unreachable", async (s) => s.fault(`async (url) => url.endsWith("/chat/completions") ? Promise.reject(new bg.TypeError("NetworkError when attempting to fetch resource.")) : null`), "Não foi possível conectar à Groq"],
  ["6.5", "rate limited", async (s) => s.fault(`async (url) => url.endsWith("/chat/completions") ? new bg.Response(JSON.stringify({ error: { message: "Rate limit reached for model openai/gpt-oss-20b. Please try again in 2s." } }), { status: 429 }) : null`), "Limite de requisições"],
  ["6.6", "truncated response", async (s) => s.fault(`async (url) => url.endsWith("/chat/completions") ? new bg.Response(JSON.stringify({ choices: [{ finish_reason: "length", message: { content: "Eu vou" } }] }), { status: 200 }) : null`), "foi cortada"],
  ["6.7", "empty response", async (s) => s.fault(`async (url) => url.endsWith("/chat/completions") ? new bg.Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "   " } }] }), { status: 200 }) : null`), "resposta vazia"]
]
for (const [id, name, setup, expected] of errorTests) {
  test(`6. Error handling › [${id}] ${name}`, async (s) => {
    await setup(s)
    await s.openSite()
    await s.selectField("#campo-simples")
    await (await s.shadow(".polite-trigger")).click()
    const text = await s.shadowError()
    assert(expected instanceof RegExp ? expected.test(text) : text.includes(expected), `error text: ${text}`)
  })
}

test("6. Error handling › [6.3] offline", async (s) => {
  await s.openSite()
  await s.selectField("#campo-simples")
  await s.d.setContext(firefox.Context.CHROME)
  await s.d.executeScript(`Services.io.offline = true`)
  await s.d.setContext(firefox.Context.CONTENT)
  try {
    await (await s.shadow(".polite-trigger")).click()
    const text = await s.shadowError()
    assert(text.includes("Sem conexão com a internet"), `error text: ${text}`)
  } finally {
    await s.d.setContext(firefox.Context.CHROME)
    await s.d.executeScript(`Services.io.offline = false`)
    await s.d.setContext(firefox.Context.CONTENT)
  }
})

test("6. Error handling › [6.8] unavailable model falls back automatically (real API)", async (s) => {
  await s.setStorage("sync", { groq_model: "polite/model-that-does-not-exist" })
  await s.openSite()
  await s.selectField("#campo-simples")
  clean(await s.runFix(), BROKEN_PT)
  const models = (await s.chatCalls()).map((c) => c.body.model)
  eq(models[0], "polite/model-that-does-not-exist", "first model")
  eq(models.at(-1), "openai/gpt-oss-20b", "fallback model")
  eq(await s.getStorage("sync", "groq_model"), "openai/gpt-oss-20b", "stored model")
})

test("6. Error handling › [6.9] extension reloaded while the page is open", async (s) => {
  await s.openSite()
  await s.inControl(`setTimeout(() => browser.runtime.reload(), 50)`)
  await s.d.sleep(2500)
  await s.d.switchTo().window(s.siteHandle)
  await s.selectField("#campo-simples")
  // After a reload Firefox may tear down the old content script entirely;
  // either the new script handles it or the old one shows the reload message.
  await (await s.shadow(".polite-trigger")).click()
  const box = await s.waitFor(async () => (await s.shadowAll(".polite-error, .polite-result-box"))[0], 30000, "error or result")
  const cls = await box.getAttribute("class")
  if (cls.includes("polite-error")) {
    const text = await box.getText()
    assert(text.includes("A extensão foi atualizada"), `error text: ${text}`)
  }
})

test("7. Built-in test page › [7.1][7.2] playground correction works", async (s) => {
  await s.openExtTab("/tabs/test.html")
  const input = await s.waitFor(() => s.$("input[type=text]"))
  eq(await input.getAttribute("value"), BROKEN_PT, "initial value")
  await s.selectField("input[type=text]")
  await (await s.waitFor(() => s.$(".polite-trigger"))).click()
  const result = (await (await s.waitFor(() => s.$(".polite-result-box"), 30000)).getText()).trim()
  clean(result, BROKEN_PT)
  await (await s.button("Substituir")).click()
  await s.waitFor(async () => (await s.d.executeScript(`return document.querySelector("input[type=text]").value`)) === result, 5000, "playground replaced")
})

test("[1.7] no console errors on a normal session", async (s) => {
  await s.openExtTab("/options.html")
  await s.openSite()
  await s.d.executeScript(`window.__pageErrors = []; addEventListener("error", e => __pageErrors.push(e.message))`)
  await s.selectField("#campo-simples")
  await s.runFix()
  await (await s.shadowButton("Substituir")).click()
  await s.d.sleep(500)
  const errors = [...(await s.bg(`return bg.__errors`)), ...(await s.d.executeScript("return window.__pageErrors"))]
  eq(errors, [], "console errors")
})

// ------------------------------------------------------------------ runner

const selected = tests.filter((t) => !grep || t.title.includes(grep))
const results = []
console.log(`Running ${selected.length} Firefox tests (${headed ? "headed" : "headless"}) against ${ADDON_DIR}`)

for (const t of selected) {
  const started = Date.now()
  let s
  let status = "passed", error
  try {
    s = await Session.start()
    await Promise.race([
      t.fn(s),
      new Promise((_, rej) => setTimeout(() => rej(new Error("Test timeout of 90000ms exceeded")), 90000))
    ])
  } catch (e) {
    status = "failed"
    if (process.env.FF_DIAG && s) {
      try {
        const url = await s.d.getCurrentUrl()
        const card = await Promise.all((await s.shadowAll(".polite-popover")).map((x) => x.getText())).catch(() => [])
        const body = (await s.bodyText()).slice(0, 400)
        console.log(`      diag url=${url}\n      diag card=${JSON.stringify(card)}\n      diag body=${JSON.stringify(body)}`)
        const vals = await s.d.executeScript(`return [...document.querySelectorAll("input,textarea")].map(e => (e.placeholder || e.id) + "=" + e.value.length + ":" + (e.type === "password" || e.value.startsWith("gsk_") ? "[masked]" : e.value.slice(0, 12)))`)
        console.log(`      diag fields=${JSON.stringify(vals)}`)
      } catch {}
    }
    error = e.message.split("\n")[0].replace(/Bearer\s+[A-Za-z0-9_-]+/g, "Bearer [redacted]").split(KEY).join("[redacted]")
  } finally {
    await s?.quit()
  }
  results.push({ title: t.title, status, error, durationMs: Date.now() - started })
  console.log(`${status === "passed" ? "  ✓" : "  ✘"} [firefox] ${t.title}${error ? `\n      ${error}` : ""}`)
}

server.close()
mkdirSync(path.dirname(outFile), { recursive: true })
writeFileSync(outFile, JSON.stringify({ browser: "firefox", version: null, results }, null, 2))
const failed = results.filter((r) => r.status === "failed").length
console.log(`\n${results.length - failed} passed, ${failed} failed → ${path.relative(ROOT, outFile)}`)
process.exit(failed ? 1 : 0)
