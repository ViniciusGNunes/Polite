import { readFileSync } from "node:fs"
import path from "node:path"
import { test as base, chromium, type BrowserContext, type Locator, type Page, type Worker } from "@playwright/test"

export const EXTENSION_PATH = path.resolve(__dirname, "../../build/polite-prod")
export const TEST_PAGE_URL = "http://polite.test/"
const TEST_PAGE_HTML = readFileSync(path.resolve(__dirname, "../../test.html"), "utf8")

export const GROQ_API_KEY = process.env.GROQ_API_KEY?.trim() || ""

export function redact(text: string) {
  let out = text.replace(/Bearer\s+[A-Za-z0-9_-]+/g, "Bearer [redacted]")
  if (GROQ_API_KEY) out = out.split(GROQ_API_KEY).join("[redacted]")
  return out
}

// Groq free tier allows ~30 requests/min per model; keep a gap between real calls
// so rate limiting is never mistaken for an extension bug.
const MIN_GAP_MS = 2500
let lastGroqCall = 0

export type GroqCall = { url: string; body: any; status?: number }

type Fixtures = {
  context: BrowserContext
  serviceWorker: Worker
  extensionId: string
  /** Writes values the same way @plasmohq/storage does (JSON-serialised). */
  setStorage: (area: "local" | "sync", values: Record<string, unknown>) => Promise<void>
  /** Reads a value written by @plasmohq/storage (JSON-parsed). */
  getStorage: (area: "local" | "sync", key: string) => Promise<any>
  /** Every request the extension made to api.groq.com during the test. */
  groqCalls: GroqCall[]
  /** Console errors / uncaught exceptions from any extension or test page. */
  consoleErrors: string[]
}

export const test = base.extend<Fixtures>({
  groqCalls: async ({}, use) => {
    await use([])
  },

  consoleErrors: async ({}, use, testInfo) => {
    const errors: string[] = []
    await use(errors)
    if (errors.length) {
      await testInfo.attach("console-errors", { body: errors.join("\n"), contentType: "text/plain" })
    }
  },

  context: async ({ groqCalls, consoleErrors }, use, testInfo) => {
    const executablePath = testInfo.project.use.launchOptions?.executablePath
    const context = await chromium.launchPersistentContext("", {
      // Playwright's bundled Chromium can run extensions headless; branded
      // browsers are more reliable headed.
      channel: executablePath ? undefined : "chromium",
      executablePath,
      headless: !executablePath && !process.env.HEADED,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        "--no-first-run",
        "--no-default-browser-check"
      ]
    })

    // Serve the repo's test.html on a fake origin so the content script injects.
    await context.route(`${TEST_PAGE_URL}**`, (route) =>
      route.fulfill({ contentType: "text/html", body: TEST_PAGE_HTML })
    )

    // Pass-through monitor for every Groq request (throttled). Tests can add
    // their own context.route() afterwards to mock specific responses; later
    // routes take precedence.
    await context.route("https://api.groq.com/**", async (route) => {
      const wait = lastGroqCall + MIN_GAP_MS - Date.now()
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      lastGroqCall = Date.now()
      const call: GroqCall = { url: route.request().url(), body: route.request().postDataJSON() }
      groqCalls.push(call)
      let response
      try {
        response = await route.fetch()
      } catch (err) {
        // Playwright's call log includes request headers; never let the API key reach logs.
        throw new Error(redact(String((err as Error).message).split("\n")[0]))
      }
      call.status = response.status()
      if (call.status === 429) {
        testInfo.annotations.push({ type: "rate-limited", description: call.url })
      }
      await route.fulfill({ response })
    })

    const track = (where: string) => (msg: { type(): string; text(): string }) => {
      if (msg.type() === "error") consoleErrors.push(`[${where}] ${msg.text()}`)
    }
    const watchPage = (page: Page) => {
      page.on("console", track(page.url() || "page"))
      page.on("pageerror", (err) => consoleErrors.push(`[pageerror ${page.url()}] ${err.message}`))
    }
    context.pages().forEach(watchPage)
    context.on("page", watchPage)
    const watchWorker = (w: Worker) => w.on("console", track("background"))
    context.serviceWorkers().forEach(watchWorker)
    context.on("serviceworker", watchWorker)

    await use(context)
    await context.close()
  },

  serviceWorker: async ({ context }, use) => {
    let [worker] = context.serviceWorkers()
    if (!worker) worker = await context.waitForEvent("serviceworker")
    await use(worker)
  },

  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host)
  },

  setStorage: async ({ serviceWorker }, use) => {
    await use(async (area, values) => {
      const serialised = Object.fromEntries(
        Object.entries(values).map(([k, v]) => [k, JSON.stringify(v)])
      )
      await serviceWorker.evaluate(
        ([a, data]) => chrome.storage[a].set(data),
        [area, serialised] as const
      )
    })
  },

  getStorage: async ({ serviceWorker }, use) => {
    await use(async (area, key) => {
      const raw = await serviceWorker.evaluate(
        async ([a, k]) => (await chrome.storage[a].get(k))[k],
        [area, key] as const
      )
      return raw === undefined ? undefined : JSON.parse(raw as string)
    })
  }
})

export const expect = test.expect

/** Mocks the Groq chat completion endpoint and returns the request bodies it saw. */
export async function mockGroq(context: BrowserContext, correctedText: string) {
  const requests: any[] = []
  await context.route("https://api.groq.com/openai/v1/chat/completions", async (route) => {
    requests.push(route.request().postDataJSON())
    await route.fulfill({
      json: {
        choices: [{ finish_reason: "stop", message: { role: "assistant", content: correctedText } }]
      }
    })
  })
  return requests
}

/** Selects the whole value of an input/textarea the way a user would. */
export async function selectField(field: Locator) {
  await field.click()
  await field.press("ControlOrMeta+a")
  await field.dispatchEvent("mouseup")
}

/** Selects the text of an element with a DOM Range (contenteditable / static text). */
export async function selectText(page: Page, selector: string) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel)!
    const editable = el.closest("[contenteditable]") as HTMLElement | null
    editable?.focus()
    const range = document.createRange()
    range.selectNodeContents(el)
    const s = window.getSelection()!
    s.removeAllRanges()
    s.addRange(range)
  }, selector)
  await page.locator(selector).dispatchEvent("mouseup")
}
