#!/usr/bin/env node
const { spawn } = require("child_process")
const fs = require("fs")
const path = require("path")

const mode = process.argv[2]
const tag = mode === "build" ? "prod" : "dev"
const rootDir = path.join(__dirname, "..")
const scratchDir = path.join(rootDir, ".plasmo-out")
const buildDir = path.join(rootDir, "build")
const srcDir = path.join(scratchDir, `chrome-mv3-${tag}`)
const destDir = path.join(buildDir, `polite-${tag}`)

function mirror() {
  if (!fs.existsSync(srcDir)) return
  fs.rmSync(destDir, { recursive: true, force: true })
  fs.cpSync(srcDir, destDir, { recursive: true })
}

function sweepStrayFolders() {
  if (!fs.existsSync(buildDir)) return
  for (const entry of fs.readdirSync(buildDir)) {
    if (entry.startsWith("chrome-mv3-")) {
      fs.rmSync(path.join(buildDir, entry), { recursive: true, force: true })
    }
  }
}

const child = spawn(
  "npx",
  ["plasmo", mode, `--build-path=${scratchDir}`],
  { stdio: "inherit", shell: true }
)

let watcher = null
let debounceTimer = null

const armInterval = setInterval(() => {
  sweepStrayFolders()
  if (watcher || !fs.existsSync(srcDir)) return
  mirror()
  watcher = fs.watch(srcDir, { recursive: true }, () => {
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      mirror()
      sweepStrayFolders()
    }, 300)
  })
}, 500)

function cleanup(code) {
  clearInterval(armInterval)
  clearTimeout(debounceTimer)
  if (watcher) watcher.close()
  mirror()
  sweepStrayFolders()
  fs.rmSync(scratchDir, { recursive: true, force: true })
  process.exit(code ?? 0)
}

child.on("exit", cleanup)
process.on("SIGINT", () => child.kill("SIGINT"))
process.on("SIGTERM", () => child.kill("SIGTERM"))
