import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { defineConfig, type Project } from "@playwright/test"
import "dotenv/config"

// Extensions only load in Chromium-based browsers under Playwright.
// Firefox is covered separately by `npm run test:firefox` (web-ext lint).
// Branded browsers are picked up automatically when installed; override
// their paths with EDGE_PATH / BRAVE_PATH / CHROME_PATH.
const optionalBrowsers: { name: string; paths: (string | undefined)[] }[] = [
  {
    name: "edge",
    paths: [process.env.EDGE_PATH, "/usr/bin/microsoft-edge-stable", "/usr/bin/microsoft-edge",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]
  },
  {
    name: "brave",
    paths: [process.env.BRAVE_PATH, "/usr/bin/brave", "/usr/bin/brave-browser",
      "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"]
  },
  {
    name: "opera",
    paths: [process.env.OPERA_PATH, "/usr/bin/opera",
      "C:\\Program Files\\Opera\\opera.exe",
      "/Applications/Opera.app/Contents/MacOS/Opera"]
  },
  {
    // Google Chrome 137+ ignores --load-extension, so use Chrome for Testing
    // (https://googlechromelabs.github.io/chrome-for-testing/) or set CHROME_PATH.
    name: "chrome",
    paths: [process.env.CHROME_PATH,
      `${homedir()}/.cache/chrome-for-testing/chrome-linux64/chrome`]
  }
]

const projects: Project[] = [{ name: "chromium", use: {} }]

for (const browser of optionalBrowsers) {
  const found = browser.paths.find((p) => p && existsSync(p))
  if (found) projects.push({ name: browser.name, use: { launchOptions: { executablePath: found } } })
}

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }], ["json", { outputFile: "test-results/results.json" }]],
  use: { trace: "retain-on-failure" },
  projects
})
