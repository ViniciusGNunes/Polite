#!/usr/bin/env node
const { spawnSync } = require("child_process")
const fs = require("fs")
const path = require("path")

const buildDir = path.join(__dirname, "..", "build")
const srcDir = path.join(buildDir, "polite-prod")
const zipPath = path.join(buildDir, "polite-prod.zip")

const buildResult = spawnSync(
  process.execPath,
  [path.join(__dirname, "run-and-mirror.js"), "build"],
  { stdio: "inherit" }
)
if (buildResult.error || buildResult.status !== 0) {
  console.error("Build failed.")
  process.exit(buildResult.status ?? 1)
}

if (!fs.existsSync(srcDir)) {
  console.error(`build/polite-prod not found after build — aborting.`)
  process.exit(1)
}

fs.rmSync(zipPath, { force: true })

let result
if (process.platform === "win32") {
  result = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path '${srcDir}\\*' -DestinationPath '${zipPath}' -Force`
    ],
    { stdio: "inherit" }
  )
} else {
  result = spawnSync("zip", ["-r", zipPath, "."], {
    cwd: srcDir,
    stdio: "inherit"
  })
}

if (result.error || result.status !== 0) {
  console.error("Packaging failed.")
  process.exit(result.status ?? 1)
}

console.log(`Packaged: ${zipPath}`)
