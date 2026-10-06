#!/usr/bin/env node
// Builds a markdown pass/fail matrix (check id × browser) from a Playwright JSON
// report plus optional Firefox runner JSON files.
//
//   node tests/tools/matrix.mjs <playwright.json> [firefox.json ...]
import "dotenv/config"
import { readFileSync } from "node:fs"

const KEY = process.env.GROQ_API_KEY?.trim()
const redact = (t) => {
  let out = String(t).replace(/Bearer\s+[A-Za-z0-9_-]+/g, "Bearer [redacted]")
  return KEY ? out.split(KEY).join("[redacted]") : out
}

const BROWSERS = ["edge", "chrome", "firefox", "opera", "brave"]
const ICON = { passed: "✅", failed: "❌", timedOut: "❌", skipped: "—", interrupted: "⚠️", flaky: "🟡" }

const rows = new Map() // id -> { title, cells: { browser: { status, error } } }

function idOf(title) {
  const m = title.match(/^(\[[^\]]+\])+/)
  return m ? m[0] : title
}

function add(title, browser, status, error) {
  const id = idOf(title)
  if (!rows.has(id)) rows.set(id, { title: title.replace(/^(\[[^\]]+\])+\s*/, ""), cells: {} })
  rows.get(id).cells[browser] = { status, error }
}

function walk(suite) {
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests) {
      const last = t.results.at(-1)
      const status = t.status === "flaky" ? "flaky" : last?.status ?? "skipped"
      const error = redact(last?.errors?.[0]?.message?.split("\n")[0] ?? "")
      add(spec.title, t.projectName, status, error)
    }
  }
  for (const s of suite.suites ?? []) walk(s)
}

const [pwFile, ...ffFiles] = process.argv.slice(2)
if (pwFile) {
  const report = JSON.parse(readFileSync(pwFile, "utf8"))
  for (const s of report.suites) walk(s)
}
for (const f of ffFiles) {
  const report = JSON.parse(readFileSync(f, "utf8"))
  for (const r of report.results) add(r.title.split(" › ").at(-1), "firefox", r.status, r.error)
}

const sortKey = (id) => id.match(/\d+(\.\d+)?/g)?.map((n) => n.split(".").map((x) => x.padStart(3, "0")).join(".")).join("|") ?? id
const ids = [...rows.keys()].sort((a, b) => sortKey(a).localeCompare(sortKey(b)))

const used = BROWSERS.filter((b) => ids.some((id) => rows.get(id).cells[b]))
const out = []
out.push(`| Check | ${used.map((b) => b[0].toUpperCase() + b.slice(1)).join(" | ")} |`)
out.push(`|---|${used.map(() => ":-:").join("|")}|`)
for (const id of ids) {
  const r = rows.get(id)
  out.push(`| ${id} ${r.title} | ${used.map((b) => ICON[r.cells[b]?.status] ?? " ").join(" | ")} |`)
}
const totals = used.map((b) => {
  const cells = ids.map((id) => rows.get(id).cells[b]).filter(Boolean)
  return `${cells.filter((c) => c.status === "passed").length}/${cells.filter((c) => c.status !== "skipped").length}`
})
out.push(`| **Passed** | ${totals.join(" | ")} |`)
console.log(out.join("\n"))

const failures = []
for (const id of ids) for (const b of used) {
  const c = rows.get(id).cells[b]
  if (c && ["failed", "timedOut", "interrupted"].includes(c.status)) failures.push(`- ${b} ${id}: ${(c.error ?? "").replace(/\u001b\[[0-9;]*m/g, "").slice(0, 200)}`)
}
if (failures.length) console.log("\nFailures:\n" + failures.join("\n"))
