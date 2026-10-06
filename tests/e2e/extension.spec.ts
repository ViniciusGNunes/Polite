import { expect, mockGroq, TEST_PAGE_URL, test } from "./fixtures"

const ORIGINAL = "Eu vai para a padaria comprar pao amanhã de tarde."
const CORRECTED = "Eu vou para a padaria comprar pão amanhã à tarde."

test.describe("extension boot", () => {
  test("background service worker starts with the right manifest", async ({ serviceWorker }) => {
    const manifest = await serviceWorker.evaluate(() => chrome.runtime.getManifest())
    expect(manifest.name).toBe("Polite")
    expect(manifest.manifest_version).toBe(3)
    expect(manifest.commands?.["fix-selection"]).toBeTruthy()
  })

  test("popup renders the API key form", async ({ page, extensionId }) => {
    await page.goto(`chrome-extension://${extensionId}/popup.html`)
    await expect(page.getByPlaceholder("gsk_...")).toBeVisible()
  })

  test("options page renders", async ({ page, extensionId }) => {
    await page.goto(`chrome-extension://${extensionId}/options.html`)
    await expect(page.getByPlaceholder("gsk_...")).toBeVisible()
    await expect(page.getByPlaceholder("Ex: figma.com ou github.dev")).toBeVisible()
  })
})

test.describe("content script", () => {
  test.beforeEach(async ({ setStorage }) => {
    await setStorage("local", { groq_api_key: "gsk_test_key" })
    await setStorage("sync", { groq_model: "openai/gpt-oss-20b" })
  })

  test("corrects and replaces selected text in an input", async ({ context, page }) => {
    const requests = await mockGroq(context, CORRECTED)
    await page.goto(TEST_PAGE_URL)

    const input = page.locator("#campo-simples")
    await input.click()
    await input.press("ControlOrMeta+a")
    await input.dispatchEvent("mouseup")

    const trigger = page.locator(".polite-trigger")
    await expect(trigger).toBeVisible()
    await trigger.click()

    await expect(page.locator(".polite-result-box")).toContainText(CORRECTED)
    expect(requests).toHaveLength(1)
    expect(requests[0].model).toBe("openai/gpt-oss-20b")
    expect(requests[0].messages[1].content).toContain(ORIGINAL)

    await page.getByRole("button", { name: /Substituir/ }).click()
    await expect(input).toHaveValue(CORRECTED)
  })

  test("shows an error when no API key is configured", async ({ page, serviceWorker }) => {
    await serviceWorker.evaluate(() => chrome.storage.local.clear())
    await page.goto(TEST_PAGE_URL)

    const input = page.locator("#campo-simples")
    await input.click()
    await input.press("ControlOrMeta+a")
    await input.dispatchEvent("mouseup")
    await page.locator(".polite-trigger").click()

    await expect(page.locator(".polite-error")).toContainText("API Key da Groq não configurada")
  })

  test("stays hidden on ignored domains", async ({ page, setStorage }) => {
    await setStorage("sync", { ignored_domains: ["polite.test"] })
    await page.goto(TEST_PAGE_URL)

    const input = page.locator("#campo-simples")
    await input.click()
    await input.press("ControlOrMeta+a")
    await input.dispatchEvent("mouseup")

    // Give the 70ms selection debounce time to run before asserting absence.
    await page.waitForTimeout(500)
    await expect(page.locator(".polite-trigger")).toHaveCount(0)
  })
})
